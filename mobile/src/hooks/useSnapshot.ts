import { useCallback } from 'react';
import { SESSION } from '@/lib/graphql';
import { useSession } from '@/lib/session-context';
import type { Session } from '@/lib/types';
import { syncAgentWidget } from '@/widget/update';
import { usePoll } from './usePoll';

export function useSnapshot() {
  const { client, activeMachine } = useSession();
  // Primitives: the summary object is new on every render.
  const machineId = activeMachine?.id;
  const machineName = activeMachine?.name;
  const load = useCallback(async () => {
    if (!client) throw new Error('Connect to Herdr first.');
    const result = await client.query<{ session: Session }>({ query: SESSION });
    if (!result.data) throw new Error('No session returned.');
    // The home screen widget follows the app's polls at no extra cost.
    if (machineId && machineName)
      syncAgentWidget(
        { id: machineId, name: machineName },
        result.data.session,
      );
    return result.data.session;
  }, [client, machineId, machineName]);
  return usePoll(load, 3000);
}
