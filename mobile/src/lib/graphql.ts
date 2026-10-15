import { ApolloClient, InMemoryCache, HttpLink, gql } from '@apollo/client';
import type { Connection } from './connection';

export function createClient(connection: Connection) {
  return new ApolloClient({
    cache: new InMemoryCache(),
    link: new HttpLink({
      uri: `${connection.url}/graphql`,
      headers: { authorization: `Bearer ${connection.token}` },
      fetch: async (uri, options) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);
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
