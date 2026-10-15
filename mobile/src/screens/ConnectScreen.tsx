import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { ArrowRight, GitFork, LockKeyhole, Network } from 'lucide-react-native';
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[s.page, { flexGrow: 1, paddingTop: 40 }]}
        >
          <View style={[s.row, { marginBottom: 28 }]}>
            <View
              style={{
                width: 52,
                height: 52,
                backgroundColor: c.accent,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GitFork color={c.ink} size={28} />
            </View>
            <Text style={[s.heading, { fontSize: 25, letterSpacing: -1 }]}>
              herdr<Text style={{ color: c.muted }}> / mobile</Text>
            </Text>
          </View>
          <Text style={s.eyebrow}>YOUR AGENTS. WITH YOU.</Text>
          <Text style={[s.title, { fontSize: 46, lineHeight: 51 }]}>
            A little closer{'\n'}to your agents.
          </Text>
          <Text
            style={[
              s.muted,
              { fontSize: 16, lineHeight: 24, marginBottom: 10 },
            ]}
          >
            Pick up where your computer left off. Connect to Herdr through your
            private network.
          </Text>
          <Field
            label="Bridge address"
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
                title="Retry saved machines"
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
            label="Pairing token"
            placeholder="Paste the token from your computer"
            value={token}
            onChangeText={setToken}
            secureTextEntry
            editable={!busy}
            autoComplete="off"
          />
          {!!error && <Notice message={error} danger />}
          <Button
            title="Connect to Herdr"
            onPress={() => void submit()}
            busy={busy}
            disabled={!url.trim() || !token.trim()}
            icon={<ArrowRight size={18} color={c.ink} />}
          />
          <View style={{ flex: 1, minHeight: 12 }} />
          <View style={[s.card, { backgroundColor: 'transparent' }]}>
            <View style={s.row}>
              <Network size={19} color={c.accent} />
              <Text style={s.body}>Same tailnet. Anywhere.</Text>
            </View>
            <Text style={s.muted}>
              Turn on Tailscale on your phone and computer. Run the Herdr Mobile
              bridge on your computer, then enter its address and pairing token
              above.
            </Text>
            <View style={s.row}>
              <LockKeyhole size={14} color={c.muted} />
              <Text style={[s.muted, { fontSize: 11 }]}>
                Your token stays in this device’s secure storage.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
