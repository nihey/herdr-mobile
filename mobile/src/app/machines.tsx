import { useSession } from '@/lib/session-context';
import { Loading, Screen } from '@/components/ui';
import { MachinesScreen } from '@/screens/MachinesScreen';

export default function MachinesRoute() {
  const { ready, activeMachine } = useSession();
  if (!ready)
    return (
      <Screen>
        <Loading label="Loading saved machines…" />
      </Screen>
    );
  return <MachinesScreen key={activeMachine?.id ?? 'none'} />;
}
