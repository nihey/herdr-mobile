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
  /**
   * A new tab's shell runs its startup scripts first, and Herdr only starts an
   * agent once the shell idles alone at its prompt. Wait for that (read-only)
   * instead of retrying agent.start; on timeout agent.start reports the state.
   */
  async function waitForShell(paneId: string) {
    const deadline = Date.now() + timing.shellTimeoutMs;
    let idleSince: number | null = null;
    while (Date.now() < deadline) {
      const alone = await shellAlone(paneId);
      // Optional check: agent.start reports the pane's real state.
      if (alone === null) return;
      if (!alone) idleSince = null;
      else {
        idleSince ??= Date.now();
        if (Date.now() - idleSince >= timing.settleMs) return;
      }
      await delay(timing.pollMs);
    }
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
        startSession(
          workspaceId: ID!
          kind: String!
          name: String!
        ): StartedSession!
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
        output: async (
          _: unknown,
          args: { target: string; source: string; lines: number; raw: boolean },
        ) => {
          target(args.target);
          if (args.lines < 1 || args.lines > 1000)
            badInput('Choose between 1 and 1000 lines.');
          const result = await call(args.raw ? 'pane.read' : 'agent.read', {
            [args.raw ? 'pane_id' : 'target']: args.target,
            source: args.source === 'VISIBLE' ? 'visible' : 'recent_unwrapped',
            lines: args.lines,
            format: 'text',
            strip_ansi: true,
          });
          const read = result.read as { text: string };
          return { text: read.text, fetchedAt: new Date().toISOString() };
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
          args: { workspaceId: string; name: string; kind: string },
        ) => {
          target(args.workspaceId);
          agentName(args.name);
          agentKind(args.kind);
          const startedAt = Date.now();
          const snapshot = (await call('session.snapshot'))
            .snapshot as Snapshot;
          if (
            !snapshot.workspaces?.some(
              (w) => w.workspace_id === args.workspaceId,
            )
          )
            badInput(
              'That project is no longer open in Herdr. Refresh and choose another.',
            );
          if (snapshot.agents?.some((a) => a.name === args.name))
            badInput(
              `Another agent is already named ${args.name}. Choose a different name.`,
            );
          const cwd = projectCwd(snapshot, args.workspaceId);
          // A new tab leaves every existing pane alone and does not move the
          // desktop view. Never retried: a failure here may still have opened it.
          const created = await call('tab.create', {
            workspace_id: args.workspaceId,
            label: args.name,
            focus: false,
            ...(cwd ? { cwd } : {}),
          });
          const paneId = nonEmpty((created.root_pane as RecordValue)?.pane_id);
          const tabId = nonEmpty((created.tab as RecordValue)?.tab_id);
          if (!paneId || !tabId)
            throw new GraphQLError('Herdr did not report the new tab.', {
              extensions: { code: 'BRIDGE_ERROR' },
            });
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
            workspaceId: args.workspaceId,
            name: args.name,
            kind: args.kind,
            ready: state === 'ready',
          };
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
