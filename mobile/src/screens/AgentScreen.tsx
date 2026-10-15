import { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  RefreshCw,
  Send,
} from 'lucide-react-native';
import { useSession } from '@/lib/session-context';
import { useSnapshot } from '@/hooks/useSnapshot';
import { usePoll } from '@/hooks/usePoll';
import { useHomeBack } from '@/hooks/useHomeBack';
import { KEYS, OUTPUT, PROMPT, SEND_TEXT } from '@/lib/graphql';
import { errorMessage } from '@/lib/errors';
import type { Output } from '@/lib/types';
import {
  Button,
  c,
  ErrorSheet,
  IconButton,
  Loading,
  mono,
  Notice,
  s,
  Screen,
  Status,
} from '@/components/ui';

const keyButtons = [
  { label: 'Esc', key: 'esc' },
  { label: 'Tab', key: 'tab' },
  { label: '↑', key: 'up' },
  { label: '↓', key: 'down' },
  { label: '←', key: 'left' },
  { label: '→', key: 'right' },
  { label: 'Enter ↵', key: 'enter' },
  { label: 'Ctrl+C', key: 'ctrl+c' },
  { label: 'y', key: 'y' },
  { label: 'n', key: 'n' },
];
export function AgentScreen({ paneId, raw }: { paneId: string; raw: boolean }) {
  useHomeBack();
  const { client } = useSession();
  const snapshot = useSnapshot();
  const agent = snapshot.data?.agents.find((item) => item.paneId === paneId);
  const pane = snapshot.data?.panes.find((item) => item.id === paneId);
  const [source, setSource] = useState<'RECENT' | 'VISIBLE'>('RECENT');
  const [draft, setDraft] = useState('');
  const [typeText, setTypeText] = useState(raw);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sent, setSent] = useState('');
  const [follow, setFollow] = useState(true);
  const scroll = useRef<ScrollView>(null);
  const followRef = useRef(true);
  const sending = useRef(false);
  const load = useCallback(async () => {
    if (!client) throw new Error('Not connected.');
    const result = await client.query<{ output: Output }>({
      query: OUTPUT,
      variables: { target: paneId, source, raw },
    });
    if (!result.data) throw new Error('No output returned.');
    return result.data.output;
  }, [client, paneId, source, raw]);
  const output = usePoll(load, 1500);
  const act = async (operation: () => Promise<unknown>, after?: () => void) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setSent('');
    try {
      await operation();
      after?.();
    } catch (reason) {
      setActionError(errorMessage(reason, true));
    } finally {
      sending.current = false;
      setBusy(false);
      output.refresh();
      snapshot.refresh();
    }
  };
  const send = () => {
    if (!client || !draft.trim()) return;
    const submitted = draft;
    void act(
      () =>
        client.mutate({
          mutation: typeText ? SEND_TEXT : PROMPT,
          variables: typeText
            ? { paneId, text: submitted }
            : { target: paneId, text: submitted },
        }),
      () => {
        setDraft((value) => (value === submitted ? '' : value));
        setSent(
          typeText
            ? 'Text sent. Use Enter to submit it in the terminal.'
            : 'Prompt delivered to Herdr.',
        );
      },
    );
  };
  const sendKey = (key: string) => {
    if (!client) return;
    void act(() =>
      client.mutate({
        mutation: KEYS,
        variables: { target: paneId, keys: [key], raw: raw || typeText },
      }),
    );
  };
  const jump = () => {
    followRef.current = true;
    setFollow(true);
    scroll.current?.scrollToEnd({ animated: true });
  };
  const name =
    agent?.name ??
    agent?.title ??
    pane?.label ??
    pane?.title ??
    agent?.kind ??
    'Terminal';
  const blocked = !raw && agent?.status === 'blocked';
  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 8,
            paddingBottom: 14,
            gap: 12,
          }}
        >
          <View style={s.between}>
            <IconButton label="Back to agents" onPress={() => router.back()}>
              <ArrowLeft size={21} color={c.text} />
            </IconButton>
            <View style={{ flex: 1, gap: 4 }}>
              <Text numberOfLines={1} style={[s.heading, { fontSize: 18 }]}>
                {name}
              </Text>
              <Text
                numberOfLines={1}
                style={[s.muted, { fontFamily: mono, fontSize: 10 }]}
              >
                {agent?.kind ?? 'terminal'} / {paneId}
              </Text>
            </View>
            <IconButton
              label="Refresh terminal"
              onPress={() => {
                output.refresh();
                snapshot.refresh();
              }}
            >
              <RefreshCw size={18} color={c.accent} />
            </IconButton>
          </View>
          <View style={s.between}>
            <Status status={agent?.status ?? pane?.status ?? 'unknown'} />
            <Text
              numberOfLines={1}
              style={[
                s.muted,
                { fontSize: 10, maxWidth: '65%', fontFamily: mono },
              ]}
            >
              {agent?.cwd ?? pane?.cwd ?? ''}
            </Text>
          </View>
          <View style={[s.row, { gap: 8 }]}>
            <Button
              title="Recent output"
              variant={source === 'RECENT' ? 'primary' : 'secondary'}
              onPress={() => setSource('RECENT')}
              style={{ minHeight: 42, paddingVertical: 9, flex: 1 }}
            />
            <Button
              title="Visible screen"
              variant={source === 'VISIBLE' ? 'primary' : 'secondary'}
              onPress={() => setSource('VISIBLE')}
              style={{ minHeight: 42, paddingVertical: 9, flex: 1 }}
            />
          </View>
          {!!output.error && (
            <Notice message={errorMessage(output.error)} danger />
          )}
          {blocked && (
            <Notice message="This agent needs input. Read its question below, then use Type text and the terminal keys to respond." />
          )}
        </View>
        <View
          style={{
            flex: 1,
            backgroundColor: '#0B100C',
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: c.line,
          }}
        >
          <View
            style={[s.between, { paddingHorizontal: 18, paddingVertical: 10 }]}
          >
            <Text style={[s.eyebrow, { fontSize: 9, letterSpacing: 1.3 }]}>
              TERMINAL OUTPUT
            </Text>
            <Text style={[s.muted, { fontFamily: mono, fontSize: 9 }]}>
              {output.error
                ? 'OFFLINE · CACHED'
                : output.data
                  ? new Date(output.data.fetchedAt).toLocaleTimeString()
                  : 'SYNCING'}
            </Text>
          </View>
          {output.loading && !output.data ? (
            <Loading label="Reading the terminal…" />
          ) : (
            <ScrollView
              ref={scroll}
              contentContainerStyle={{
                padding: 16,
                paddingTop: 4,
                paddingBottom: 30,
              }}
              onContentSizeChange={() => {
                if (followRef.current)
                  scroll.current?.scrollToEnd({ animated: false });
              }}
              scrollEventThrottle={100}
              onScroll={(event) => {
                const { contentOffset, contentSize, layoutMeasurement } =
                  event.nativeEvent;
                const atBottom =
                  contentOffset.y + layoutMeasurement.height >=
                  contentSize.height - 60;
                followRef.current = atBottom;
                setFollow(atBottom);
              }}
            >
              <Text
                selectable
                style={{
                  color: '#DBE5D6',
                  fontFamily: mono,
                  fontSize: 12,
                  lineHeight: 19,
                }}
              >
                {output.data?.text || 'No output yet.'}
              </Text>
            </ScrollView>
          )}
          {!follow && (
            <View style={{ position: 'absolute', bottom: 12, right: 14 }}>
              <Button
                title="Latest"
                variant="secondary"
                icon={<ArrowDown color={c.accent} size={15} />}
                onPress={jump}
              />
            </View>
          )}
        </View>
        <View style={{ paddingVertical: 10, gap: 10 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, gap: 7 }}
          >
            {keyButtons.map((item) => (
              <Button
                key={item.key}
                title={item.label}
                variant={item.key === 'ctrl+c' ? 'danger' : 'secondary'}
                disabled={busy || !!output.error || !output.data}
                onPress={() => sendKey(item.key)}
                style={{ paddingHorizontal: 15, borderRadius: 9 }}
              />
            ))}
          </ScrollView>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {!raw && (
              <View style={s.row}>
                <Button
                  title="Prompt"
                  variant={!typeText ? 'primary' : 'ghost'}
                  onPress={() => {
                    setTypeText(false);
                    setSent('');
                  }}
                  style={{ minHeight: 38, paddingVertical: 8 }}
                />
                <Button
                  title="Type text"
                  variant={typeText ? 'primary' : 'ghost'}
                  onPress={() => {
                    setTypeText(true);
                    setSent('');
                  }}
                  style={{ minHeight: 38, paddingVertical: 8 }}
                />
                <View style={{ flex: 1 }} />
                <ArrowUpRight size={15} color={c.muted} />
              </View>
            )}
            <View
              style={{
                backgroundColor: c.panel,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: c.line,
                padding: 10,
                gap: 8,
              }}
            >
              <TextInput
                accessibilityLabel={typeText ? 'Terminal text' : 'Agent prompt'}
                placeholder={
                  typeText
                    ? 'Type into this terminal…'
                    : 'What should this agent do next?'
                }
                placeholderTextColor={c.muted}
                multiline
                value={draft}
                onChangeText={setDraft}
                editable={!busy}
                selectionColor={c.accent}
                style={{
                  color: c.text,
                  minHeight: 42,
                  maxHeight: 120,
                  fontSize: 14,
                  padding: 5,
                  textAlignVertical: 'top',
                }}
              />
              <View style={s.between}>
                <Text style={[s.muted, { fontSize: 10, flex: 1 }]}>
                  {typeText
                    ? 'Types literally · use Enter to submit'
                    : 'Sends your prompt + Enter'}
                </Text>
                <Button
                  title={typeText ? 'Type' : 'Send'}
                  onPress={send}
                  busy={busy}
                  disabled={
                    !draft.trim() ||
                    !!output.error ||
                    !output.data ||
                    (blocked && !typeText)
                  }
                  icon={typeText ? undefined : <Send size={14} color={c.ink} />}
                  style={{ minHeight: 40, paddingVertical: 9 }}
                />
              </View>
            </View>
            {!!sent && (
              <Text
                accessibilityLiveRegion="polite"
                style={[s.muted, { color: c.accent, fontSize: 11 }]}
              >
                {sent}
              </Text>
            )}
          </View>
        </View>
        <ErrorSheet
          message={actionError}
          onClose={() => setActionError(null)}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
