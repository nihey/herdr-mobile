import { useSession } from '@/lib/session-context';
import { Loading, Screen } from '@/components/ui';
import { ConnectScreen } from '@/screens/ConnectScreen';
import { AgentsScreen } from '@/screens/AgentsScreen';

export default function Home() {
  const { ready, connection } = useSession();
  if (!ready)
    return (
      <Screen>
        <Loading label="Opening Herdr…" />
      </Screen>
    );
  return connection ? <AgentsScreen /> : <ConnectScreen />;
}
