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

export function buildSchema(
  request: RequestHerdr,
  discover?: () => Promise<DiscoveredMachine[]>,
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
          return result.snapshot;
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
          if (!/^[a-z][a-z0-9_-]{0,31}$/.test(args.name))
            badInput(
              'Use a unique lowercase name, up to 32 letters, digits, underscores or hyphens.',
            );
          if (!/^[a-z][a-z0-9_-]{0,31}$/.test(args.kind))
            badInput('Choose a valid agent kind.');
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
