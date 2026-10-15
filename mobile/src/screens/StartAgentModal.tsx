import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '@/lib/session-context';
import { START } from '@/lib/graphql';
import type { Pane, Workspace } from '@/lib/types';
import { errorMessage } from '@/lib/errors';
import { Button, c, Field, Notice, s, Sheet } from '@/components/ui';

const kinds = ['codex', 'claude', 'gemini', 'opencode', 'cursor', 'copilot'];
export function StartAgentModal({
  pane,
  workspaces,
  onClose,
  onStarted,
}: {
  pane: Pane | null;
  workspaces: Workspace[];
  onClose: () => void;
  onStarted: () => void;
}) {
  const { client } = useSession();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('codex');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = async () => {
    if (!client || !pane) return;
    setBusy(true);
    setError('');
    try {
      await client.mutate({
        mutation: START,
        variables: { paneId: pane.id, kind, name: name.trim() },
      });
      onStarted();
    } catch (reason) {
      setError(errorMessage(reason, true));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible={!!pane}
      title="Start an agent"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <View style={s.card}>
        <Text style={s.body}>
          {workspaces.find((w) => w.id === pane?.workspaceId)?.label} ·{' '}
          {pane?.id}
        </Text>
        <Text style={s.muted}>{pane?.cwd ?? 'Shell working directory'}</Text>
      </View>
      <Field
        label="Agent name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. mobile-helper"
        editable={!busy}
        maxLength={32}
      />
      <Text style={s.muted}>Agent kind</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {kinds.map((item) => (
          <Button
            key={item}
            title={item}
            variant={kind === item ? 'primary' : 'secondary'}
            disabled={busy}
            onPress={() => setKind(item)}
          />
        ))}
      </View>
      <Field
        label="Or enter another Herdr agent kind"
        value={kind}
        onChangeText={setKind}
        editable={!busy}
      />
      <Text style={s.muted}>
        The selected agent CLI must already be installed on your computer. Herdr
        checks that this pane is available before starting.
      </Text>
      {!!error && <Notice message={error} danger />}
      <Button
        title={busy ? 'Waiting for agent readiness…' : 'Start agent'}
        onPress={() => void start()}
        busy={busy}
        disabled={!/^[a-z][a-z0-9_-]{0,31}$/.test(name.trim()) || !kind.trim()}
      />
      {busy && (
        <Text style={{ color: c.amber, fontSize: 12 }}>
          Startup can take up to 30 seconds.
        </Text>
      )}
    </Sheet>
  );
}
