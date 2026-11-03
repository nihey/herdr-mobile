import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { ArrowRight, LockKeyhole } from 'lucide-react-native';
import { useSession } from '@/lib/session-context';
import { errorMessage } from '@/lib/errors';
import { Button, c, Field, Notice, s, Screen } from '@/components/ui';

export function ConnectScreen() {
  const { connect, storageError, reload } = useSession();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await connect(url, token);
    } catch (reason) {
      setError(
        reason instanceof Error &&
          !reason.message.includes('fetch') &&
          !reason.message.includes('status code')
          ? reason.message
          : errorMessage(reason),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      {/* Edge-to-edge Android does not resize for the keyboard, so pad on both
          platforms; the ScrollView then keeps the focused field in view. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[s.page, { flexGrow: 1, paddingTop: 28 }]}
        >
          <View style={{ gap: 4, marginBottom: 8 }}>
            <Text style={s.eyebrow}>unofficial herdr companion</Text>
            <Text style={s.title}>herd remote</Text>
          </View>
          <Text style={[s.body, { color: c.muted }]}>
            Your Herdr agents and terminals, from your phone. Connects to the
            bridge on your computer through your private tailnet.
          </Text>
          <Field
            label="bridge address"
            accessibilityLabel="Bridge address"
            placeholder="http://100.x.x.x:8787"
            keyboardType="url"
            value={url}
            onChangeText={setUrl}
            editable={!busy}
            autoComplete="off"
          />
          {storageError && (
            <>
              <Notice message={storageError} danger />
              <Button
                title="retry saved machines"
                variant="secondary"
                onPress={() => {
                  void reload().catch(() =>
                    setError(
                      'Secure storage is still unavailable. Please try again.',
                    ),
                  );
                }}
              />
            </>
          )}
          <Field
            label="pairing token"
            accessibilityLabel="Pairing token"
            placeholder="paste the token from your computer"
            value={token}
            onChangeText={setToken}
            secureTextEntry
            editable={!busy}
            autoComplete="off"
          />
          {!!error && <Notice message={error} danger />}
          <Button
            title="connect"
            accessibilityLabel="Connect to Herdr"
            onPress={() => void submit()}
            busy={busy}
            disabled={!url.trim() || !token.trim()}
            icon={<ArrowRight size={17} color={c.ink} />}
          />
          <View style={{ flex: 1, minHeight: 12 }} />
          <View style={[s.card, { backgroundColor: 'transparent' }]}>
            <Text style={[s.body, { fontWeight: '700' }]}>
              same tailnet. anywhere.
            </Text>
            <Text style={s.muted}>
              Turn on Tailscale on your phone and computer. Run the Herd Remote
              bridge on your computer, then enter its address and pairing token
              above.
            </Text>
            <View style={s.row}>
              <LockKeyhole size={13} color={c.dim} />
              <Text style={[s.eyebrow, { flex: 1 }]}>
                your token stays in this device’s secure storage.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
