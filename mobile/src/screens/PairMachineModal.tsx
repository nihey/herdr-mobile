import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '@/lib/session-context';
import { errorMessage } from '@/lib/errors';
import { Button, Field, Notice, s, Sheet } from '@/components/ui';

export function PairMachineModal({
  initialName,
  initialUrl,
  onClose,
}: {
  initialName: string;
  initialUrl: string;
  onClose: () => void;
}) {
  const { connect, busy } = useSession();
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const pair = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setError('');
    try {
      await connect(url, token, name);
      onClose();
      router.replace('/');
    } catch (reason) {
      setError(
        reason instanceof Error &&
          !reason.message.includes('status code') &&
          !reason.message.includes('fetch')
          ? reason.message
          : errorMessage(reason),
      );
    } finally {
      submitting.current = false;
    }
  };
  return (
    <Sheet
      title="Add a machine"
      visible
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Text style={s.muted}>
        Herdr and its Mobile bridge must be running on this machine. Get its
        token locally with npm run pairing -w bridge.
      </Text>
      <Field
        label="Machine name"
        placeholder="e.g. Work laptop"
        value={name}
        onChangeText={setName}
        maxLength={64}
        editable={!busy}
      />
      <Field
        label="Bridge address"
        placeholder="http://100.x.x.x:8787"
        value={url}
        onChangeText={setUrl}
        keyboardType="url"
        maxLength={384}
        editable={!busy}
      />
      <Field
        label="Pairing token"
        placeholder="Token from this machine’s bridge"
        value={token}
        onChangeText={setToken}
        secureTextEntry
        maxLength={512}
        editable={!busy}
        autoComplete="off"
      />
      {!!error && <Notice message={error} danger />}
      <Button
        title="Verify and add machine"
        busy={busy}
        disabled={!name.trim() || !url.trim() || !token.trim()}
        onPress={() => void pair()}
      />
      <Text style={s.muted}>
        Pairing checks this bridge before saving. This machine will become your
        active connection.
      </Text>
    </Sheet>
  );
}
