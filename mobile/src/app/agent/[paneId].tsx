import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/lib/session-context';
import { AgentScreen } from '@/screens/AgentScreen';
import { Loading, Screen } from '@/components/ui';

export default function AgentRoute() {
  const { paneId, raw, machineId } = useLocalSearchParams<{
    paneId: string;
    raw?: string;
    machineId?: string;
  }>();
  const { ready, connection, activeMachine } = useSession();
  if (!ready)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (!connection || !paneId || machineId !== activeMachine?.id)
    return <Redirect href="/" />;
  return (
    <AgentScreen
      key={`${activeMachine?.id}/${paneId}/${raw}`}
      paneId={paneId}
      raw={raw === '1'}
    />
  );
}
