import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApolloProvider } from '@apollo/client/react';
import * as SecureStore from 'expo-secure-store';
import { createClient, SESSION } from './graphql';
import { normalizeConnection, type Connection } from './connection';
import {
  MachineStore,
  type MachineState,
  type MachineSummary,
} from './machines';
import type { Session } from './types';

type Client = ReturnType<typeof createClient>;
type Context = {
  ready: boolean;
  busy: boolean;
  storageError: string | null;
  connection: Connection | null;
  client: Client | null;
  machines: MachineSummary[];
  activeMachine: MachineSummary | null;
  connect: (url: string, token: string, name?: string) => Promise<void>;
  activate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  forget: () => Promise<void>;
  reload: () => Promise<void>;
};
const SessionContext = createContext<Context | null>(null);
const storageMessage =
  'Could not load saved machines from secure storage. Retry before changing your connections.';

export function SessionProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new MachineStore(SecureStore), []);
  const [state, setState] = useState<MachineState>({
    machines: [],
    activeId: null,
  });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const writing = useRef(false);
  const active = state.machines.find((m) => m.id === state.activeId) ?? null;
  const client = useMemo(
    () => (active ? createClient(active) : null),
    [active],
  );
  const currentClient = useRef(client);
  currentClient.current = client;
  useEffect(() => {
    let cancelled = false;
    void store
      .load()
      .then((loaded) => {
        if (!cancelled) {
          setState(loaded);
          setStorageError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setStorageError(storageMessage);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [store]);
  useEffect(
    () => () => {
      client?.stop();
    },
    [client],
  );

  async function change(operation: () => Promise<MachineState>) {
    if (writing.current)
      throw new Error('A machine change is already in progress. Please wait.');
    writing.current = true;
    setBusy(true);
    try {
      const next = await operation();
      currentClient.current?.stop();
      setState(next);
      setStorageError(null);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const summaries = state.machines.map(({ id, name, url }) => ({
    id,
    name,
    url,
  }));
  const value: Context = {
    ready,
    busy,
    storageError,
    connection: active ? { url: active.url, token: active.token } : null,
    activeMachine: summaries.find((m) => m.id === state.activeId) ?? null,
    machines: summaries,
    client,
    connect: async (url, token, name) =>
      change(async () => {
        const settings = normalizeConnection(url, token);
        const probe = createClient(settings);
        try {
          await probe.query<{ session: Session }>({ query: SESSION });
          return await store.add(
            name?.trim() || new URL(settings.url).hostname.slice(0, 64),
            settings.url,
            settings.token,
          );
        } finally {
          probe.stop();
        }
      }),
    activate: (id) => change(() => store.activate(id)),
    remove: (id) => change(() => store.remove(id)),
    forget: () =>
      change(() => (active ? store.remove(active.id) : store.load())),
    reload: () => change(() => store.load()),
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
