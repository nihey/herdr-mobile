import { homedir } from 'node:os';
import { GraphQLError } from 'graphql';
import { createSchema } from 'graphql-yoga';
import { HerdrError } from './socket.js';
import type { DiscoveredMachine } from './discovery.js';
import { CoordinatorError, type Coordinator } from './hermes/coordinator.js';
import type { StartHerdr } from './launch.js';
import { listFolders } from './folders.js';
import {
  createActions,
  defaultStartTiming,
  namePattern,
  projectCwd,
  target,
  text,
  agentName,
  agentKind,
  badInput,
  type RecordValue,
  type RequestHerdr,
  type StartTiming,
} from './actions.js';

export {
  HOME_WORKSPACE_LABEL,
  type RequestHerdr,
  type StartTiming,
} from './actions.js';
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

export function buildSchema(
  request: RequestHerdr,
  discover?: () => Promise<DiscoveredMachine[]>,
  timing: StartTiming = defaultStartTiming,
  homeDir: string = homedir(),
  hermes?: Coordinator,
  startHerdr?: StartHerdr,
) {
  const actions = createActions(request, timing, homeDir);
  const hermesError = (error: unknown) =>
    error instanceof CoordinatorError
      ? new GraphQLError(error.message, { extensions: { code: error.code } })
      : error;
  const { call } = actions;
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
      type HerdrStart {
        "False when Herdr was already running, so nothing was started."
        started: Boolean!
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
      enum HermesStatus {
        OFF
        STARTING
        READY
        UNAVAILABLE
      }
      enum HermesRole {
        USER
        HERMES
      }
      enum HermesChipKind {
        READ
        SENT
        STARTED
      }
      "An agent Hermes read, messaged or started, as the bridge recorded it."
      type HermesChip {
        kind: HermesChipKind!
        paneId: ID!
        title: String
        "The change may or may not have happened (uncertain delivery, failed start)."
        uncertain: Boolean!
      }
      type HermesMessage {
        id: ID!
        role: HermesRole!
        text: String!
        chips: [HermesChip!]!
        stopped: Boolean!
        at: String!
      }
      "The Hermes coordinator conversation on this computer."
      type Hermes {
        status: HermesStatus!
        reason: String
        model: String
        modelNote: String
        working: Boolean!
        messages(last: Int = 100): [HermesMessage!]!
      }
      "A folder on this computer, by name only (the bridge never reads files)."
      type Folder {
        name: String!
        path: String!
      }
      type FolderListing {
        "The real path of the listed folder."
        path: String!
        "Null at the root folder."
        parent: String
        "Subfolders by name, hidden ones (starting with a dot) last."
        folders: [Folder!]!
        "More subfolders than are listed."
        truncated: Boolean!
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
        "Subfolders of a folder (~ and ~/... are the home folder; default: home)."
        folders(path: String): FolderListing!
        "start: false (the home summary) never starts Hermes."
        hermes(start: Boolean = true): Hermes!
        output(
          target: ID!
          source: OutputSource = RECENT
          lines: Int = 200
          raw: Boolean = false
        ): Output!
      }
      type Mutation {
        "Starts the Herdr server when it is not running, e.g. after a crash. Never stops or restarts it."
        startHerdr: HerdrStart!
        prompt(target: ID!, text: String!): ActionResult!
        sendKeys(
          target: ID!
          keys: [String!]!
          raw: Boolean = false
        ): ActionResult!
        sendText(paneId: ID!, text: String!): ActionResult!
        startAgent(paneId: ID!, name: String!, kind: String!): ActionResult!
        "Without a workspace or folder, starts in the home workspace. A folder opens in the project open there, else in a new workspace."
        startSession(
          workspaceId: ID
          folder: String
          kind: String!
          name: String!
        ): StartedSession!
        "A plain shell in a new tab. Without a workspace or folder, in the home workspace; a folder works as in startSession."
        startTerminal(workspaceId: ID, folder: String): StartedTerminal!
        "One message to Hermes; refused while it is still answering. Never retried."
        hermesSend(text: String!): ActionResult!
        hermesStop: ActionResult!
        "Starts a fresh Hermes conversation."
        hermesNew: ActionResult!
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
          const snapshot = await actions.snapshot();
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
        folders: (_: unknown, args: { path?: string | null }) =>
          listFolders(args.path ?? null, homeDir),
        hermes: (_: unknown, args: { start: boolean }) =>
          hermes?.conversation({ start: args.start }) ?? {
            status: 'unavailable',
            reason: 'Hermes is not set up on this bridge.',
            model: null,
            modelNote: null,
            working: false,
            messages: [],
          },
        output: async (
          _: unknown,
          args: {
            target: string;
            source: 'RECENT' | 'VISIBLE';
            lines: number;
            raw: boolean;
          },
        ) => ({
          text: await actions.readOutput(args.target, args),
          fetchedAt: new Date().toISOString(),
        }),
      },
      Mutation: {
        startHerdr: async () => {
          if (!startHerdr)
            throw new GraphQLError(
              'This bridge cannot start Herdr. Start it on the computer.',
              { extensions: { code: 'herdr_start_unsupported' } },
            );
          try {
            return await startHerdr();
          } catch (error) {
            if (error instanceof HerdrError)
              throw new GraphQLError(error.message, {
                extensions: { code: error.code },
              });
            throw new GraphQLError('The bridge could not start Herdr.', {
              extensions: { code: 'BRIDGE_ERROR' },
            });
          }
        },
        prompt: async (_: unknown, args: { target: string; text: string }) => {
          await actions.prompt(args.target, args.text);
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
          args: {
            workspaceId?: string | null;
            folder?: string | null;
            name: string;
            kind: string;
          },
        ) =>
          actions.startSession({
            workspaceId: args.workspaceId ?? null,
            folder: args.folder ?? null,
            name: args.name,
            kind: args.kind,
          }),
        startTerminal: async (
          _: unknown,
          args: { workspaceId?: string | null; folder?: string | null },
        ) =>
          actions.startTerminal(args.workspaceId ?? null, args.folder ?? null),
        hermesSend: (_: unknown, args: { text: string }) => {
          if (!args.text.trim() || Buffer.byteLength(args.text) > 16 * 1024)
            badInput('Enter a message shorter than 16 KiB.');
          if (!hermes)
            throw new GraphQLError('Hermes is not set up on this bridge.', {
              extensions: { code: 'hermes_unavailable' },
            });
          try {
            hermes.send(args.text);
          } catch (error) {
            throw hermesError(error);
          }
          return { ok: true };
        },
        hermesStop: () => {
          hermes?.stop();
          return { ok: true };
        },
        hermesNew: async () => {
          if (!hermes)
            throw new GraphQLError('Hermes is not set up on this bridge.', {
              extensions: { code: 'hermes_unavailable' },
            });
          try {
            await hermes.reset();
          } catch (error) {
            throw hermesError(error);
          }
          return { ok: true };
        },
      },
      Hermes: {
        status: (h: { status: string }) => h.status.toUpperCase(),
        messages: (h: { messages: unknown[] }, args: { last: number }) => {
          if (args.last < 1 || args.last > 200)
            badInput('Choose between 1 and 200 messages.');
          return h.messages.slice(-args.last);
        },
      },
      HermesMessage: { role: (m: { role: string }) => m.role.toUpperCase() },
      HermesChip: {
        kind: (c: { kind: string }) => c.kind.toUpperCase(),
        uncertain: (c: { uncertain?: boolean }) => c.uncertain === true,
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
