import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { GraphQLError } from 'graphql';
import { createSchema } from 'graphql-yoga';
import { HerdrError } from './socket.js';
import type { DiscoveredMachine } from './discovery.js';

export type RequestHerdr = (
  method: string,
  params?: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<Record<string, unknown>>;
type RecordValue = Record<string, unknown>;
const badInput = (message: string): never => {
  throw new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
};
function target(value: string) {
  if (
    !value.trim() ||
    value.length > 128 ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
    badInput('Choose a valid agent or pane.');
  return value;
}
function text(value: string) {
  if (!value.trim() || Buffer.byteLength(value) > 64 * 1024)
    badInput('Enter text shorter than 64 KiB.');
  return value;
}
const keysAllowed = new Set([
  'enter',
  'esc',
  'tab',
  'shift+tab',
  'up',
  'down',
  'left',
  'right',
  'ctrl+c',
  'ctrl+d',
  'backspace',
  'space',
  'y',
  'n',
]);
const field = (key: string) => (parent: RecordValue) => parent[key];
/** The workspace that holds terminals and sessions started in the home folder. */
export const HOME_WORKSPACE_LABEL = 'phone';
const namePattern = /^[a-z][a-z0-9_-]{0,31}$/;
function agentName(value: string) {
  if (!namePattern.test(value))
    badInput(
      'Use a unique lowercase name, up to 32 letters, digits, underscores or hyphens.',
    );
  return value;
}
function agentKind(value: string) {
  if (!namePattern.test(value)) badInput('Choose a valid agent kind.');
  return value;
}
type Snapshot = {
  workspaces?: RecordValue[];
  panes?: RecordValue[];
  agents?: RecordValue[];
} & RecordValue;
const nonEmpty = (value: unknown) =>
  typeof value === 'string' && value ? value : null;
const missingTab = () =>
  new GraphQLError('Herdr did not report the new tab.', {
    extensions: { code: 'BRIDGE_ERROR' },
  });
/** A project's folder: the shell directory of the workspace's first pane. */
function projectCwd(snapshot: Snapshot, workspaceId: unknown) {
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
const defaultStartTiming: StartTiming = {
  pollMs: 100,
  settleMs: 400,
  shellTimeoutMs: 8000,
  exitGraceMs: 2000,
  totalMs: 38000,
};

export function buildSchema(
  request: RequestHerdr,
  discover?: () => Promise<DiscoveredMachine[]>,
  timing: StartTiming = defaultStartTiming,
  homeDir: string = homedir(),
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
  return createSchema({
    typeDefs: /* GraphQL */ `
      enum OutputSource {
        RECENT
        VISIBLE
      }
      type Workspace {
        id: ID!
        label: String!
        status: String!
        cwd: String
      }
      type Tab {
        id: ID!
        workspaceId: ID!
        label: String!
      }
      type Agent {
        paneId: ID!
        workspaceId: ID!
        tabId: ID!
        name: String
        kind: String
        title: String
        cwd: String
        status: String!
        interactiveReady: Boolean
      }
      type Pane {
        id: ID!
        workspaceId: ID!
        tabId: ID!
        label: String
        title: String
        cwd: String
        kind: String
        status: String!
      }
      type Session {
        version: String!
        protocol: Int!
        workspaces: [Workspace!]!
        tabs: [Tab!]!
        agents: [Agent!]!
        panes: [Pane!]!
      }
      type Output {
        text: String!
        fetchedAt: String!
      }
      type ActionResult {
        ok: Boolean!
      }
      type StartedSession {
        paneId: ID!
        tabId: ID!
        workspaceId: ID!
        name: String!
        kind: String!
        "False when the agent had not finished starting within the time limit."
        ready: Boolean!
      }
      type StartedTerminal {
        paneId: ID!
        tabId: ID!
        workspaceId: ID!
        "True once the shell sat alone at its prompt; false if that is unknown."
        ready: Boolean!
      }
      type DiscoveredMachine {
        id: ID!
        name: String!
        dnsName: String
        os: String
        addresses: [String!]!
        online: Boolean!
        self: Boolean!
      }
      type Query {
        discoveredMachines: [DiscoveredMachine!]!
        session: Session!
        agentKinds: [String!]!
        "The bridge user's home folder, where home terminals open."
        homeFolder: String
        output(
          target: ID!
          source: OutputSource = RECENT
          lines: Int = 200
          raw: Boolean = false
        ): Output!
      }
      type Mutation {
        prompt(target: ID!, text: String!): ActionResult!
        sendKeys(
          target: ID!
          keys: [String!]!
          raw: Boolean = false
        ): ActionResult!
        sendText(paneId: ID!, text: String!): ActionResult!
        startAgent(paneId: ID!, name: String!, kind: String!): ActionResult!
        "Without a workspace, starts in the home workspace."
        startSession(
          workspaceId: ID
          kind: String!
          name: String!
        ): StartedSession!
        "A plain shell in a new tab. Without a workspace, in the home workspace."
        startTerminal(workspaceId: ID): StartedTerminal!
      }
    `,
    resolvers: {
      Query: {
        discoveredMachines: async () => {
          if (!discover)
            throw new GraphQLError(
              'Discovery is not available on this bridge. Update and restart it, or add a machine manually.',
              { extensions: { code: 'TAILSCALE_UNAVAILABLE' } },
            );
          try {
            return await discover();
          } catch (error) {
            throw new GraphQLError(
              error instanceof HerdrError
                ? error.message
                : 'Could not discover devices. Check Tailscale on this computer, or add a machine manually.',
              { extensions: { code: 'TAILSCALE_UNAVAILABLE' } },
            );
          }
        },
        session: async () => {
          const result = await call('session.snapshot');
          const snapshot = result.snapshot as Snapshot;
          return {
            ...snapshot,
            workspaces: (snapshot.workspaces ?? []).map((workspace) => ({
              ...workspace,
              cwd: projectCwd(snapshot, workspace.workspace_id),
            })),
          };
        },
        agentKinds: async () => {
          // Only feeds the optional "More" list; never block starting a session.
          const result = await request('server.agent_manifests').catch(
            () => ({}) as RecordValue,
          );
          const manifests = Array.isArray(result.manifests)
            ? (result.manifests as unknown[])
            : [];
          const kinds = manifests
            .map((item) => (item as RecordValue | null)?.agent)
            .filter(
              (kind): kind is string =>
                typeof kind === 'string' && namePattern.test(kind),
            );
          return [...new Set(kinds)];
        },
        homeFolder: () => homeDir,
        output: async (
          _: unknown,
          args: { target: string; source: string; lines: number; raw: boolean },
        ) => {
          target(args.target);
          if (args.lines < 1 || args.lines > 1000)
            badInput('Choose between 1 and 1000 lines.');
          const read = (source: 'visible' | 'recent_unwrapped') =>
            call(args.raw ? 'pane.read' : 'agent.read', {
              [args.raw ? 'pane_id' : 'target']: args.target,
              source,
              lines: args.lines,
              format: 'text',
              strip_ansi: true,
            });
          // Full-screen apps (the alternate screen, e.g. Claude's TUI) keep no
          // scrollback. Herdr can only collect their history by scrolling the
          // app with mouse-wheel events, which moves it on the user's desktop
          // when idle and is refused while working. Everything they have is on
          // screen, so read the screen instead.
          let source: 'visible' | 'recent_unwrapped' =
            args.source === 'VISIBLE' || (await noScrollback(args.target))
              ? 'visible'
              : 'recent_unwrapped';
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
          const text = (result.read as { text: string }).text;
          return { text, fetchedAt: new Date().toISOString() };
        },
      },
      Mutation: {
        prompt: async (_: unknown, args: { target: string; text: string }) => {
          await call('agent.prompt', {
            target: target(args.target),
            text: text(args.text),
          });
          return { ok: true };
        },
        sendText: async (
          _: unknown,
          args: { paneId: string; text: string },
        ) => {
          await call('pane.send_text', {
            pane_id: target(args.paneId),
            text: text(args.text),
          });
          return { ok: true };
        },
        sendKeys: async (
          _: unknown,
          args: { target: string; keys: string[]; raw: boolean },
        ) => {
          target(args.target);
          if (
            args.keys.length < 1 ||
            args.keys.length > 16 ||
            args.keys.some((k) => !keysAllowed.has(k))
          )
            badInput('Choose a supported terminal key.');
          await call(args.raw ? 'pane.send_keys' : 'agent.send_keys', {
            [args.raw ? 'pane_id' : 'target']: args.target,
            keys: args.keys,
          });
          return { ok: true };
        },
        startAgent: async (
          _: unknown,
          args: { paneId: string; name: string; kind: string },
        ) => {
          target(args.paneId);
          agentName(args.name);
          agentKind(args.kind);
          await call(
            'agent.start',
            {
              pane_id: args.paneId,
              name: args.name,
              kind: args.kind,
              timeout_ms: 30000,
            },
            40000,
          );
          return { ok: true };
        },
        startSession: async (
          _: unknown,
          args: { workspaceId?: string | null; name: string; kind: string },
        ) => {
          const workspaceId = args.workspaceId ?? null;
          if (workspaceId !== null) target(workspaceId);
          agentName(args.name);
          agentKind(args.kind);
          const startedAt = Date.now();
          const snapshot = (await call('session.snapshot'))
            .snapshot as Snapshot;
          if (
            workspaceId !== null &&
            !snapshot.workspaces?.some((w) => w.workspace_id === workspaceId)
          )
            badInput(
              'That project is no longer open in Herdr. Refresh and choose another.',
            );
          if (snapshot.agents?.some((a) => a.name === args.name))
            badInput(
              `Another agent is already named ${args.name}. Choose a different name.`,
            );
          // A new tab leaves every existing pane alone and does not move the
          // desktop view. Never retried: a failure here may still have opened it.
          const place = await placement(snapshot, workspaceId);
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
        },
        startTerminal: async (
          _: unknown,
          args: { workspaceId?: string | null },
        ) => {
          const workspaceId = args.workspaceId ?? null;
          if (workspaceId !== null) target(workspaceId);
          const snapshot = (await call('session.snapshot'))
            .snapshot as Snapshot;
          const place = await placement(snapshot, workspaceId);
          const { paneId, tabId } = await openTab(place, 'terminal');
          // Read-only: the app types the first command itself, only when ready.
          const ready = (await waitForShell(paneId)) === true;
          return { paneId, tabId, workspaceId: place.workspaceId, ready };
        },
      },
      Workspace: { id: field('workspace_id'), status: field('agent_status') },
      Tab: { id: field('tab_id'), workspaceId: field('workspace_id') },
      Agent: {
        paneId: field('pane_id'),
        workspaceId: field('workspace_id'),
        tabId: field('tab_id'),
        kind: field('agent'),
        cwd: (p: RecordValue) => p.foreground_cwd ?? p.cwd,
        status: field('agent_status'),
        interactiveReady: field('interactive_ready'),
        title: (p: RecordValue) => p.title ?? p.terminal_title_stripped,
      },
      Pane: {
        id: field('pane_id'),
        workspaceId: field('workspace_id'),
        tabId: field('tab_id'),
        kind: field('agent'),
        status: field('agent_status'),
        title: (p: RecordValue) => p.title ?? p.terminal_title_stripped,
      },
    },
  });
}
