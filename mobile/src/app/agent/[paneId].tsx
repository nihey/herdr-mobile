import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/lib/session-context';
import { AgentScreen } from '@/screens/AgentScreen';
import { Loading, Screen } from '@/components/ui';

export default function AgentRoute() {
  const { paneId, raw } = useLocalSearchParams<{
    paneId: string;
    raw?: string;
  }>();
  const { ready, connection } = useSession();
  if (!ready)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (!connection || !paneId) return <Redirect href="/" />;
  return (
    <AgentScreen
      key={`${connection.url}/${paneId}/${raw}`}
      paneId={paneId}
      raw={raw === '1'}
    />
  );
}
