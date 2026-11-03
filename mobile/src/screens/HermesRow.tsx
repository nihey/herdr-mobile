import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '@/lib/session-context';
import { usePoll } from '@/hooks/usePoll';
import { HERMES_SUMMARY } from '@/lib/graphql';
import { summaryLine } from '@/lib/hermes';
import { isOutdated } from '@/lib/sessions';
import type { Hermes } from '@/lib/types';
import { c, mono, Pulse, s, tint } from '@/components/ui';

type Summary = Pick<Hermes, 'status' | 'reason' | 'working' | 'messages'>;

/**
 * Hermes pinned above the agents. Polls on its own so a bridge without
 * Hermes (or an older one) never affects the agent list.
 */
export function HermesRow() {
  const { client, activeMachine } = useSession();
  const load = useCallback(async () => {
    if (!client) throw new Error('Not connected.');
    const result = await client.query<{ hermes: Summary }>({
      query: HERMES_SUMMARY,
    });
    if (!result.data) throw new Error('No summary returned.');
    return result.data.hermes;
  }, [client]);
  const summary = usePoll(load, 5000);
  const outdated = !!summary.error && isOutdated(summary.error);
  if (!summary.data && !outdated) return null;
  const line = outdated
    ? 'update the bridge on this computer to use hermes'
    : summaryLine(summary.data as Summary);
  const working = !outdated && !!summary.data?.working;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Hermes, coordinates your agents. ${line}`}
      disabled={outdated}
      onPress={() =>
        router.push({
          pathname: '/hermes',
          params: { machineId: activeMachine?.id },
        })
      }
      style={({ pressed }) => [
        s.item,
        {
          backgroundColor: tint(c.accent, 0.1),
          borderLeftColor: c.accent,
          opacity: outdated ? 0.6 : 1,
        },
        pressed && s.selected,
      ]}
    >
      <View style={[s.row, { gap: 8 }]}>
        <Text style={[s.body, { color: c.accent, fontWeight: '700', flex: 1 }]}>
          ✦ hermes
        </Text>
        {working && <Pulse color={c.amber} />}
      </View>
      <Text
        numberOfLines={1}
        style={{
          color: c.muted,
          fontFamily: mono,
          fontSize: 12,
          lineHeight: 17,
        }}
      >
        {line}
      </Text>
    </Pressable>
  );
}
