import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/lib/session-context';
import { HermesScreen } from '@/screens/HermesScreen';
import { Loading, Screen } from '@/components/ui';

export default function HermesRoute() {
  const { machineId } = useLocalSearchParams<{ machineId?: string }>();
  const { ready, connection, activeMachine } = useSession();
  if (!ready)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  // A conversation belongs to one computer; never show another host's.
  if (!connection || machineId !== activeMachine?.id)
    return <Redirect href="/" />;
  return <HermesScreen key={activeMachine?.id} />;
}
