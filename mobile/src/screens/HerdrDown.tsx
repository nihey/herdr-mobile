import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Power } from 'lucide-react-native';
import { useSession } from '@/lib/session-context';
import { START_HERDR } from '@/lib/graphql';
import { startHerdrError } from '@/lib/herdr';
import { Button, c, Notice, s } from '@/components/ui';

/**
 * Starting Herdr from the home screen. Lives in AgentsScreen (keyed by
 * machine), so a start and its failure survive the poll's error changing
 * meanwhile. One mutation per tap, never automatic; the bridge never starts a
 * second Herdr, so tapping again is safe.
 */
export function useHerdrStart(error: unknown, onStarted: () => void) {
  const { client } = useSession();
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  // Agents loaded again: an old failure no longer applies.
  useEffect(() => {
    if (!error) setMessage('');
  }, [error]);
  const start = useCallback(async () => {
    if (!client || busy.current) return;
    busy.current = true;
    setStarting(true);
    setMessage('');
    try {
      await client.mutate<{ startHerdr: { started: boolean } }>({
        mutation: START_HERDR,
      });
      onStarted();
    } catch (reason) {
      setMessage(startHerdrError(reason));
    } finally {
      busy.current = false;
      setStarting(false);
    }
  }, [client, onStarted]);
  return { starting, message, start };
}

/** Shown instead of the connection error when Herdr is not running. */
export function HerdrDown({
  starting,
  message,
  start,
}: ReturnType<typeof useHerdrStart>) {
  const { activeMachine } = useSession();
  return (
    <View
      style={[s.card, { gap: 10, borderLeftColor: c.red, borderLeftWidth: 2 }]}
    >
      <Text style={s.heading}>herdr is not running</Text>
      <Text style={s.muted}>
        The bridge on {activeMachine?.name ?? 'this computer'} is up, but Herdr
        is not. Start it from here: Herdr reopens your saved workspaces and
        resumes the agents it can.
      </Text>
      <Button
        title={starting ? 'starting herdr…' : 'start herdr'}
        accessibilityLabel="Start Herdr on this computer"
        icon={<Power size={15} color={c.ink} />}
        busy={starting}
        onPress={() => void start()}
      />
      {!!message && <Notice message={message} danger />}
    </View>
  );
}
