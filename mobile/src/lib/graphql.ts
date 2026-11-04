import { ApolloClient, InMemoryCache, HttpLink, gql } from '@apollo/client';
import type { Connection } from './connection';

/** `timeout` bounds each request; the widget's task must end within 30 s. */
export function createClient(connection: Connection, timeout = 45000) {
  return new ApolloClient({
    cache: new InMemoryCache(),
    link: new HttpLink({
      uri: `${connection.url}/graphql`,
      headers: { authorization: `Bearer ${connection.token}` },
      fetch: async (uri, options) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const externalSignal = options?.signal;
        const abort = () => controller.abort();
        if (externalSignal?.aborted) controller.abort();
        externalSignal?.addEventListener('abort', abort);
        try {
          return await fetch(uri, { ...options, signal: controller.signal });
        } finally {
          clearTimeout(timer);
          externalSignal?.removeEventListener('abort', abort);
        }
      },
    }),
    defaultOptions: {
      query: { fetchPolicy: 'no-cache' },
      watchQuery: { fetchPolicy: 'no-cache' },
    },
  });
}
export const SESSION = gql`
  query Session {
    session {
      version
      protocol
      workspaces {
        id
        label
        status
      }
      tabs {
        id
        workspaceId
        label
      }
      agents {
        paneId
        workspaceId
        tabId
        name
        kind
        title
        cwd
        status
        interactiveReady
      }
      panes {
        id
        workspaceId
        tabId
        label
        title
        cwd
        kind
        status
      }
    }
  }
`;
// The home screen widget: only the fields it draws. Valid on a 0.4.0 bridge.
export const WIDGET_AGENTS = gql`
  query WidgetAgents {
    session {
      workspaces {
        id
        label
      }
      agents {
        paneId
        workspaceId
        name
        kind
        title
        status
      }
    }
  }
`;
export const OUTPUT = gql`
  query Output($target: ID!, $source: OutputSource!, $raw: Boolean!) {
    output(target: $target, source: $source, raw: $raw, lines: 300) {
      text
      fetchedAt
    }
  }
`;
export const DISCOVER_MACHINES = gql`
  query DiscoverMachines {
    discoveredMachines {
      id
      name
      dnsName
      os
      addresses
      online
      self
    }
  }
`;
export const PROMPT = gql`
  mutation Prompt($target: ID!, $text: String!) {
    prompt(target: $target, text: $text) {
      ok
    }
  }
`;
export const SEND_TEXT = gql`
  mutation SendText($paneId: ID!, $text: String!) {
    sendText(paneId: $paneId, text: $text) {
      ok
    }
  }
`;
export const KEYS = gql`
  mutation Keys($target: ID!, $keys: [String!]!, $raw: Boolean!) {
    sendKeys(target: $target, keys: $keys, raw: $raw) {
      ok
    }
  }
`;
export const START = gql`
  mutation StartAgent($paneId: ID!, $name: String!, $kind: String!) {
    startAgent(paneId: $paneId, name: $name, kind: $kind) {
      ok
    }
  }
`;
// Fetched only by the New session sheet, so an older bridge without these
// fields still serves the agent list.
export const NEW_SESSION_OPTIONS = gql`
  query NewSessionOptions {
    agentKinds
    session {
      workspaces {
        id
        label
        cwd
      }
    }
  }
`;
export const START_SESSION = gql`
  mutation StartSession($workspaceId: ID!, $kind: String!, $name: String!) {
    startSession(workspaceId: $workspaceId, kind: $kind, name: $name) {
      paneId
      tabId
      workspaceId
      name
      kind
      ready
    }
  }
`;
// Fetched on its own: a 0.4.0 bridge rejects it but still serves the sheet.
export const HOME_FOLDER = gql`
  query HomeFolder {
    homeFolder
  }
`;
export const START_TERMINAL = gql`
  mutation StartTerminal($workspaceId: ID) {
    startTerminal(workspaceId: $workspaceId) {
      paneId
      tabId
      workspaceId
      ready
    }
  }
`;
// A session in the home folder (no workspace). Kept apart from START_SESSION,
// whose non-null workspace still validates on a 0.4.0 bridge.
export const START_HOME_SESSION = gql`
  mutation StartHomeSession($kind: String!, $name: String!) {
    startSession(kind: $kind, name: $name) {
      paneId
      tabId
      workspaceId
      name
      kind
      ready
    }
  }
`;
// Hermes (bridge 0.6.0+). An older bridge rejects these; the app shows an
// update notice in the Hermes row instead.
export const HERMES = gql`
  query Hermes {
    hermes {
      status
      reason
      model
      modelNote
      working
      messages(last: 100) {
        id
        role
        text
        stopped
        at
        chips {
          kind
          paneId
          title
          uncertain
        }
      }
    }
  }
`;
// The home row never starts Hermes: only opening the chat does.
export const HERMES_SUMMARY = gql`
  query HermesSummary {
    hermes(start: false) {
      status
      reason
      modelNote
      working
      messages(last: 1) {
        id
        role
        text
      }
    }
  }
`;
export const HERMES_SEND = gql`
  mutation HermesSend($text: String!) {
    hermesSend(text: $text) {
      ok
    }
  }
`;
export const HERMES_STOP = gql`
  mutation HermesStop {
    hermesStop {
      ok
    }
  }
`;
export const HERMES_NEW = gql`
  mutation HermesNew {
    hermesNew {
      ok
    }
  }
`;
