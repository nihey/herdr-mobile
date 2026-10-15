import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApolloProvider } from '@apollo/client/react';
import * as SecureStore from 'expo-secure-store';
import { createClient, SESSION } from './graphql';
import { normalizeConnection, type Connection } from './connection';
import type { Session } from './types';

const STORAGE_KEY = 'herdr.connection.v1';
type Client = ReturnType<typeof createClient>;
type Context = {
  ready: boolean;
  connection: Connection | null;
  client: Client | null;
  connect: (url: string, token: string) => Promise<void>;
  forget: () => Promise<void>;
};
const SessionContext = createContext<Context | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const client = useMemo(
    () => (connection ? createClient(connection) : null),
    [connection],
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await SecureStore.getItemAsync(STORAGE_KEY);
        if (saved && !cancelled) {
          const value = JSON.parse(saved) as Connection;
          setConnection(normalizeConnection(value.url, value.token));
        }
      } catch {
        /* Corrupt or unavailable credentials return to pairing. */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(
    () => () => {
      client?.stop();
    },
    [client],
  );
  const value: Context = {
    ready,
    connection,
    client,
    connect: async (url, token) => {
      const settings = normalizeConnection(url, token);
      const probe = createClient(settings);
      try {
        await probe.query<{ session: Session }>({ query: SESSION });
        await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(settings));
        setConnection(settings);
      } finally {
        probe.stop();
      }
    },
    forget: async () => {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
      client?.stop();
      setConnection(null);
    },
  };
  return (
    <SessionContext.Provider value={value}>
      {client ? (
        <ApolloProvider client={client}>{children}</ApolloProvider>
      ) : (
        children
      )}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('SessionProvider is missing.');
  return context;
}
