import { setTimeout as delay } from 'node:timers/promises';
import { GraphQLError } from 'graphql';
import { HerdrError } from './socket.js';

/**
 * Herdr actions shared by the GraphQL resolvers and the Hermes coordinator's
 * tools, so both follow the same rules: opaque IDs, unfocused new tabs,
 * full-screen-safe reads and no retries.
 */
export type RequestHerdr = (
  method: string,
  params?: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<Record<string, unknown>>;
export type RecordValue = Record<string, unknown>;
export const badInput = (message: string): never => {
  throw new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
};
export function target(value: string) {
  if (
    !value.trim() ||
    value.length > 128 ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
    badInput('Choose a valid agent or pane.');
  return value;
}
export function text(value: string) {
  if (!value.trim() || Buffer.byteLength(value) > 64 * 1024)
    badInput('Enter text shorter than 64 KiB.');
  return value;
}
/** The workspace that holds terminals and sessions started in the home folder. */
export const HOME_WORKSPACE_LABEL = 'phone';
export const namePattern = /^[a-z][a-z0-9_-]{0,31}$/;
export function agentName(value: string) {
  if (!namePattern.test(value))
    badInput(
      'Use a unique lowercase name, up to 32 letters, digits, underscores or hyphens.',
    );
  return value;
}
export function agentKind(value: string) {
  if (!namePattern.test(value)) badInput('Choose a valid agent kind.');
  return value;
}
export type Snapshot = {
  workspaces?: RecordValue[];
  panes?: RecordValue[];
  agents?: RecordValue[];
} & RecordValue;
export const nonEmpty = (value: unknown) =>
  typeof value === 'string' && value ? value : null;
const missingTab = () =>
  new GraphQLError('Herdr did not report the new tab.', {
    extensions: { code: 'BRIDGE_ERROR' },
  });
/** A project's folder: the shell directory of the workspace's first pane. */
export function projectCwd(snapshot: Snapshot, workspaceId: unknown) {
  const pane = snapshot.panes?.find((p) => p.workspace_id === workspaceId);
  return pane ? (nonEmpty(pane.cwd) ?? nonEmpty(pane.foreground_cwd)) : null;
}

/**
 * startSession timing. The whole mutation stays under the app's 45-second
 * request timeout: a shell wait, agent.start, then a readiness wait for
 * whatever remains of `totalMs`.
 */
export type StartTiming = {
  pollMs: number;
  settleMs: number;
  shellTimeoutMs: number;
  /** How long the shell must be alone again before a launch counts as failed. */
  exitGraceMs: number;
  totalMs: number;
};
export const defaultStartTiming: StartTiming = {
  pollMs: 100,
  settleMs: 400,
  shellTimeoutMs: 8000,
  exitGraceMs: 2000,
  totalMs: 38000,
};
export type StartedSession = {
  paneId: string;
  tabId: string;
  workspaceId: string;
  name: string;
  kind: string;
  ready: boolean;
};
export type StartedTerminal = {
  paneId: string;
  tabId: string;
  workspaceId: string;
  ready: boolean;
};
export type HerdrActions = ReturnType<typeof createActions>;

export function createActions(
  request: RequestHerdr,
  timing: StartTiming,
  homeDir: string,
) {
  async function call(
    method: string,
    params?: RecordValue,
    timeoutMs?: number,
  ) {
    try {
      return await request(method, params, timeoutMs);
    } catch (error) {
      if (error instanceof HerdrError)
        throw new GraphQLError(error.message, {
          extensions: { code: error.code },
        });
      throw new GraphQLError('The bridge could not complete the request.', {
        extensions: { code: 'BRIDGE_ERROR' },
      });
    }
  }
  /** Whether the pane's shell is alone in the foreground; null if unknown. */
  async function shellAlone(paneId: string) {
    try {
      const result = await request('pane.process_info', { pane_id: paneId });
      const info = result.process_info as RecordValue | undefined;
      const foreground = info?.foreground_processes;
      // Platforms without process details cannot be checked.
      if (!Array.isArray(foreground) || !foreground.length) return null;
      return (
        foreground.length === 1 &&
        (foreground[0] as RecordValue).pid === info?.shell_pid
      );
    } catch {
      return null;
    }
  }
  /** Whether the pane has no scrollback (a fresh shell or a full-screen app). */
  async function noScrollback(paneId: string) {
    try {
      const result = await request('pane.get', { pane_id: paneId });
      const scroll = (result.pane as RecordValue | undefined)?.scroll as
        RecordValue | undefined;
      return scroll?.max_offset_from_bottom === 0;
    } catch {
      // Unknown (e.g. an agent name instead of a pane ID): read as asked.
      return false;
    }
  }
  /**
   * A new tab's shell runs its startup scripts first, and Herdr only starts an
   * agent once the shell idles alone at its prompt. Wait for that (read-only)
   * instead of retrying agent.start; on timeout agent.start reports the state.
   * True once settled at the prompt, false on timeout, null when the platform
   * cannot report the pane's processes.
   */
  async function waitForShell(paneId: string) {
    const deadline = Date.now() + timing.shellTimeoutMs;
    let idleSince: number | null = null;
    while (Date.now() < deadline) {
      const alone = await shellAlone(paneId);
      if (alone === null) return null;
      if (!alone) idleSince = null;
      else {
        idleSince ??= Date.now();
        if (Date.now() - idleSince >= timing.settleMs) return true;
      }
      await delay(timing.pollMs);
    }
    return false;
  }
  /**
   * Where a new tab goes: an open project in its folder, or (no workspace) the
   * home workspace in the home folder. The home workspace is found by label
   * alone: Herdr workspaces have no folder of their own and a shell's folder
   * changes with every cd. Creating it opens its first pane, which the caller
   * uses instead of a new tab. Never retried.
   */
  async function placement(snapshot: Snapshot, workspaceId: string | null) {
    if (workspaceId !== null) {
      if (!snapshot.workspaces?.some((w) => w.workspace_id === workspaceId))
        badInput(
          'That project is no longer open in Herdr. Refresh and choose another.',
        );
      return { workspaceId, cwd: projectCwd(snapshot, workspaceId) };
    }
    const home = snapshot.workspaces?.find(
      (w) => w.label === HOME_WORKSPACE_LABEL,
    );
    const homeId = nonEmpty(home?.workspace_id);
    if (homeId) return { workspaceId: homeId, cwd: homeDir };
    const created = await call('workspace.create', {
      label: HOME_WORKSPACE_LABEL,
      cwd: homeDir,
      focus: false,
    });
    const createdId = nonEmpty(
      (created.workspace as RecordValue | undefined)?.workspace_id,
    );
    const paneId = nonEmpty(
      (created.root_pane as RecordValue | undefined)?.pane_id,
    );
    const tabId = nonEmpty((created.tab as RecordValue | undefined)?.tab_id);
    if (!createdId || !paneId || !tabId) throw missingTab();
    return { workspaceId: createdId, cwd: homeDir, opened: { paneId, tabId } };
  }
  /** Open a new unfocused tab (every existing pane stays untouched). */
  async function openTab(
    place: Awaited<ReturnType<typeof placement>>,
    label: string,
  ) {
    if (place.opened) return place.opened;
    const created = await call('tab.create', {
      workspace_id: place.workspaceId,
      label,
      focus: false,
      ...(place.cwd ? { cwd: place.cwd } : {}),
    });
    const paneId = nonEmpty((created.root_pane as RecordValue)?.pane_id);
    const tabId = nonEmpty((created.tab as RecordValue)?.tab_id);
    if (!paneId || !tabId) throw missingTab();
    return { paneId, tabId };
  }
  /**
   * agent.start returns once the launch is queued, before the agent accepts
   * input, and a CLI that is missing or exits stays "launching" in Herdr until
   * its startup timeout. Poll (read-only) for readiness, a question, or the
   * shell being alone again, which means the agent process is gone.
   */
  async function waitForAgent(paneId: string, deadline: number) {
    const launchedAt = Date.now();
    let aloneSince: number | null = null;
    while (Date.now() < deadline) {
      try {
        const result = await request('agent.get', { target: paneId });
        const status = (result.agent as RecordValue | undefined)?.agent_status;
        if (status === 'blocked') return 'blocked';
        if (status === 'idle' || status === 'done') return 'ready';
      } catch (error) {
        if (error instanceof HerdrError && error.code === 'agent_not_found')
          return 'gone';
      }
      const alone = await shellAlone(paneId);
      if (!alone) aloneSince = null;
      else {
        aloneSince ??= Date.now();
        if (
          Date.now() - aloneSince >= timing.exitGraceMs &&
          Date.now() - launchedAt >= timing.exitGraceMs
        )
          return 'gone';
      }
      await delay(timing.pollMs * 3);
    }
    return 'starting';
  }
  async function snapshot() {
    return (await call('session.snapshot')).snapshot as Snapshot;
  }
  /**
   * Rows as the computer shows them (wrapped at the pane's width); the app
   * never re-wraps them, so a phone sees the same layout.
   */
  async function readOutput(
    paneOrAgent: string,
    options: { source: 'RECENT' | 'VISIBLE'; lines: number; raw: boolean },
  ) {
    target(paneOrAgent);
    if (options.lines < 1 || options.lines > 1000)
      badInput('Choose between 1 and 1000 lines.');
    const read = (source: 'visible' | 'recent') =>
      call(options.raw ? 'pane.read' : 'agent.read', {
        [options.raw ? 'pane_id' : 'target']: paneOrAgent,
        source,
        lines: options.lines,
        format: 'text',
        strip_ansi: true,
      });
    // Full-screen apps (the alternate screen, e.g. Claude's TUI) keep no
    // scrollback. Herdr can only collect their history by scrolling the
    // app with mouse-wheel events, which moves it on the user's desktop
    // when idle and is refused while working. Everything they have is on
    // screen, so read the screen instead.
    let source: 'visible' | 'recent' =
      options.source === 'VISIBLE' || (await noScrollback(paneOrAgent))
        ? 'visible'
        : 'recent';
    let result: RecordValue;
    try {
      result = await read(source);
    } catch (error) {
      // The pane switched to a full-screen app after the check.
      if (
        source === 'visible' ||
        !(error instanceof GraphQLError) ||
        error.extensions.code !== 'agent_not_idle'
      )
        throw error;
      source = 'visible';
      result = await read(source);
    }
    return (result.read as { text: string }).text;
  }
  async function prompt(agent: string, message: string) {
    await call('agent.prompt', { target: target(agent), text: text(message) });
  }
  async function startSession(args: {
    workspaceId: string | null;
    name: string;
    kind: string;
  }): Promise<StartedSession> {
    const workspaceId = args.workspaceId;
    if (workspaceId !== null) target(workspaceId);
    agentName(args.name);
    agentKind(args.kind);
    const startedAt = Date.now();
    const current = await snapshot();
    if (
      workspaceId !== null &&
      !current.workspaces?.some((w) => w.workspace_id === workspaceId)
    )
      badInput(
        'That project is no longer open in Herdr. Refresh and choose another.',
      );
    if (current.agents?.some((a) => a.name === args.name))
      badInput(
        `Another agent is already named ${args.name}. Choose a different name.`,
      );
    // A new tab leaves every existing pane alone and does not move the
    // desktop view. Never retried: a failure here may still have opened it.
    const place = await placement(current, workspaceId);
    const { paneId, tabId } = await openTab(place, args.name);
    await waitForShell(paneId);
    const failed = (error: unknown) => {
      const known = error instanceof HerdrError;
      const detail = known
        ? error.message
        : 'The bridge could not complete the request.';
      const code = known ? error.code : 'BRIDGE_ERROR';
      const lead =
        code === 'agent_not_ready'
          ? 'The agent started but is waiting for input.'
          : code === 'delivery_unknown' || code === 'timeout'
            ? 'A new tab opened, but the agent may not have started.'
            : 'A new tab opened, but the agent did not start.';
      return new GraphQLError(`${lead} ${detail}`, {
        extensions: { code, paneId, tabId },
      });
    };
    try {
      await request(
        'agent.start',
        {
          pane_id: paneId,
          name: args.name,
          kind: args.kind,
          timeout_ms: 25000,
        },
        30000,
      );
    } catch (error) {
      throw failed(error);
    }
    const state = await waitForAgent(paneId, startedAt + timing.totalMs);
    if (state === 'blocked')
      throw failed(
        new HerdrError(
          'agent_not_ready',
          'It stopped at a question during startup.',
        ),
      );
    if (state === 'gone')
      throw failed(
        new HerdrError(
          'agent_not_found',
          `${args.kind} exited right after launching. Check that its CLI is installed on this computer.`,
        ),
      );
    return {
      paneId,
      tabId,
      workspaceId: place.workspaceId,
      name: args.name,
      kind: args.kind,
      ready: state === 'ready',
    };
  }
  async function startTerminal(
    workspaceId: string | null,
  ): Promise<StartedTerminal> {
    if (workspaceId !== null) target(workspaceId);
    const place = await placement(await snapshot(), workspaceId);
    const { paneId, tabId } = await openTab(place, 'terminal');
    // Read-only: the app types the first command itself, only when ready.
    const ready = (await waitForShell(paneId)) === true;
    return { paneId, tabId, workspaceId: place.workspaceId, ready };
  }
  return {
    call,
    snapshot,
    readOutput,
    prompt,
    startSession,
    startTerminal,
  };
}
