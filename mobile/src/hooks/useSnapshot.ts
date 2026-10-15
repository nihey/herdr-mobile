import { useCallback } from 'react';
import { SESSION } from '@/lib/graphql';
import { useSession } from '@/lib/session-context';
import type { Session } from '@/lib/types';
import { usePoll } from './usePoll';

export function useSnapshot() {
  const { client } = useSession();
  const load = useCallback(async () => {
    if (!client) throw new Error('Connect to Herdr first.');
    const result = await client.query<{ session: Session }>({ query: SESSION });
    if (!result.data) throw new Error('No session returned.');
    return result.data.session;
  }, [client]);
  return usePoll(load, 3000);
}
