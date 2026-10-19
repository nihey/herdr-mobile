import { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { ArrowDown, ArrowLeft, RefreshCw, Send } from 'lucide-react-native';
import { useSession } from '@/lib/session-context';
import { useSnapshot } from '@/hooks/useSnapshot';
import { usePoll } from '@/hooks/usePoll';
import { useHomeBack } from '@/hooks/useHomeBack';
import { useDictation } from '@/hooks/useDictation';
import { KEYS, OUTPUT, PROMPT, SEND_TEXT } from '@/lib/graphql';
import { errorMessage } from '@/lib/errors';
import { newLineCount } from '@/lib/terminal';
import { languageInfo } from '@/lib/dictation';
import type { Output } from '@/lib/types';
import {
  Button,
  c,
  ErrorSheet,
  IconButton,
  LiveBadge,
  Loading,
  mono,
  Notice,
  s,
  Screen,
  Status,
} from '@/components/ui';
import {
  DictationControl,
  SpeechModelSheet,
} from '@/components/DictationControl';

type Source = 'RECENT' | 'VISIBLE';

const sources: { label: string; value: Source }[] = [
  { label: 'Recent', value: 'RECENT' },
  { label: 'Screen', value: 'VISIBLE' },
];
const keys = [
  { label: 'Esc', key: 'esc' },
  { label: 'Tab', key: 'tab' },
  { label: '↑', key: 'up' },
  { label: '↓', key: 'down' },
  { label: 'Enter ↵', key: 'enter' },
  { label: 'Ctrl+C', key: 'ctrl+c' },
  { label: 'y', key: 'y' },
  { label: 'n', key: 'n' },
  { label: '←', key: 'left' },
  { label: '→', key: 'right' },
];

function timeSinceLabel(date: string | undefined): string {
  if (!date) return '';
  const delta = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (delta < 5) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  return `${Math.floor(delta / 60)}m ago`;
}

export function AgentScreen({ paneId, raw }: { paneId: string; raw: boolean }) {
  useHomeBack();
  const { client } = useSession();
  const snapshot = useSnapshot();
  const agent = snapshot.data?.agents.find((item) => item.paneId === paneId);
  const pane = snapshot.data?.panes.find((item) => item.id === paneId);

  const [source, setSource] = useState<Source>('RECENT');
  const [draft, setDraft] = useState('');
  const [typeText, setTypeText] = useState(raw);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sent, setSent] = useState('');
  // Output shown while the reader is scrolled up; null follows the live output.
  const [frozen, setFrozen] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const followRef = useRef(true);
  const sending = useRef(false);

  const pollInterval = useMemo(() => {
    if (agent?.status === 'working') return 500;
    if (agent?.status === 'blocked') return 1200;
    return 1500;
  }, [agent?.status]);

  const load = useCallback(async () => {
    if (!client) throw new Error('Not connected.');
    const result = await client.query<{ output: Output }>({
      query: OUTPUT,
      variables: { target: paneId, source, raw },
    });
    if (!result.data) throw new Error('No output returned.');
    return result.data.output;
  }, [client, paneId, source, raw]);

  const output = usePoll(load, pollInterval);
  const dictation = useDictation({ onText: setDraft, onError: setActionError });
  const latest = output.data?.text ?? '';
  const shown = frozen ?? latest;
  const following = frozen === null;
  const pending = useMemo(
    () => (frozen === null ? 0 : newLineCount(frozen, latest)),
    [frozen, latest],
  );

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
    // Send exactly what is on screen; a phrase still being recognized is dropped.
    dictation.cancel();
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

  // Programmatic scrolls are never animated, so the only scroll events that
  // land away from the bottom come from the reader.
  const follow = () => {
    followRef.current = true;
    setFrozen(null);
    scroll.current?.scrollToEnd({ animated: false });
  };

  const switchSource = (next: Source) => {
    if (next === source) return;
    followRef.current = true;
    setFrozen(null);
    setSource(next);
  };

  const name =
    agent?.name ??
    agent?.title ??
    pane?.label ??
    pane?.title ??
    agent?.kind ??
    'Terminal';
  const details = [agent?.kind ?? 'terminal', agent?.cwd ?? pane?.cwd]
    .filter(Boolean)
    .join(' · ');
  const blocked = !raw && agent?.status === 'blocked';
  const offline = !!output.error || !output.data;
  const lineCount = shown ? shown.split('\n').length : 0;
  const jumpLabel =
    frozen === null || frozen === latest
      ? 'Latest'
      : pending === null
        ? 'New output'
        : pending > 0
          ? `${pending} new line${pending === 1 ? '' : 's'}`
          : 'Latest';

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View
          style={[
            s.between,
            {
              paddingHorizontal: 12,
              paddingTop: 4,
              paddingBottom: 10,
              gap: 10,
            },
          ]}
        >
          <IconButton
            label="Back to agents"
            onPress={() => router.back()}
            size={42}
          >
            <ArrowLeft size={20} color={c.text} />
          </IconButton>
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={1} style={[s.heading, { fontSize: 17 }]}>
              {name}
            </Text>
            <View style={[s.row, { gap: 6 }]}>
              <Status
                status={agent?.status ?? pane?.status ?? 'unknown'}
                pulse
              />
              <Text
                numberOfLines={1}
                style={[
                  s.muted,
                  { flex: 1, fontFamily: mono, fontSize: 10, lineHeight: 14 },
                ]}
              >
                · {details}
              </Text>
            </View>
          </View>
          <IconButton
            label="Refresh terminal"
            onPress={() => {
              output.refresh();
              snapshot.refresh();
            }}
            size={42}
          >
            <RefreshCw size={18} color={c.accent} />
          </IconButton>
        </View>
        {!!output.error && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
            <Notice message={errorMessage(output.error)} danger />
          </View>
        )}
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
            style={[s.between, { paddingHorizontal: 12, paddingVertical: 7 }]}
          >
            <View style={[s.row, { gap: 5 }]}>
              {sources.map((item) => (
                <Button
                  key={item.value}
                  title={item.label}
                  accessibilityLabel={`${item.label} output`}
                  variant={source === item.value ? 'primary' : 'secondary'}
                  onPress={() => switchSource(item.value)}
                  style={{
                    minHeight: 30,
                    paddingVertical: 4,
                    paddingHorizontal: 11,
                    borderRadius: 8,
                  }}
                />
              ))}
            </View>
            <View style={[s.row, { gap: 8 }]}>
              <Text
                numberOfLines={1}
                style={[
                  s.muted,
                  { fontFamily: mono, fontSize: 9, lineHeight: 12 },
                ]}
              >
                {output.error
                  ? 'OFFLINE · CACHED'
                  : output.data
                    ? timeSinceLabel(output.data.fetchedAt)
                    : 'SYNCING'}
              </Text>
              <LiveBadge active={following && agent?.status === 'working'} />
              <LiveBadge active={!following} label="PAUSED" tone="paused" />
            </View>
          </View>
          {output.loading && !output.data ? (
            <Loading label="Reading the terminal…" />
          ) : (
            <ScrollView
              ref={scroll}
              contentContainerStyle={{
                padding: 14,
                paddingTop: 2,
                // Room for the jump pill so it never covers the last lines.
                paddingBottom: following ? 24 : 64,
              }}
              onLayout={() => {
                if (followRef.current)
                  scroll.current?.scrollToEnd({ animated: false });
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
                  contentSize.height - 80;
                if (atBottom === followRef.current) return;
                followRef.current = atBottom;
                setFrozen(atBottom ? null : shown);
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
                {shown || 'No output yet.'}
              </Text>
              {lineCount > 0 && (
                <Text
                  style={{
                    color: c.muted,
                    fontFamily: mono,
                    fontSize: 10,
                    marginTop: 12,
                  }}
                >
                  — {lineCount} line{lineCount === 1 ? '' : 's'} —
                </Text>
              )}
            </ScrollView>
          )}
          {!following && (
            <View
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                bottom: 12,
                left: 0,
                right: 0,
                alignItems: 'center',
              }}
            >
              <Button
                title={jumpLabel}
                accessibilityLabel={`Jump to latest output: ${jumpLabel}`}
                icon={<ArrowDown color={c.ink} size={15} />}
                onPress={follow}
                style={{
                  minHeight: 36,
                  paddingVertical: 7,
                  paddingHorizontal: 14,
                  borderRadius: 18,
                }}
              />
            </View>
          )}
        </View>
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              gap: 6,
            }}
          >
            {keys.map((item) => (
              <Button
                key={item.key}
                title={item.label}
                variant={item.key === 'ctrl+c' ? 'danger' : 'secondary'}
                disabled={busy || offline}
                onPress={() => sendKey(item.key)}
                style={{
                  minHeight: 36,
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 9,
                }}
              />
            ))}
          </ScrollView>
          <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 6 }}>
            {blocked && !typeText && (
              <Text
                numberOfLines={1}
                style={{ color: c.amber, fontSize: 11, lineHeight: 15 }}
              >
                Needs input · answer with Type or the keys above.
              </Text>
            )}
            {dictation.listening ? (
              <Text
                accessibilityLiveRegion="polite"
                numberOfLines={1}
                style={{ color: c.red, fontSize: 11, lineHeight: 15 }}
              >
                ● Listening in {languageInfo(dictation.language).name} · tap ■
                to stop
              </Text>
            ) : dictation.notice ? (
              <Text
                accessibilityLiveRegion="polite"
                numberOfLines={2}
                style={{ color: c.amber, fontSize: 11, lineHeight: 15 }}
              >
                {dictation.notice}
              </Text>
            ) : (
              !!sent && (
                <Text
                  accessibilityLiveRegion="polite"
                  numberOfLines={1}
                  style={{ color: c.accent, fontSize: 11, lineHeight: 15 }}
                >
                  {sent}
                </Text>
              )
            )}
            <View style={[s.row, { gap: 8, alignItems: 'flex-end' }]}>
              {!raw && (
                <Button
                  title={typeText ? 'Type' : 'Prompt'}
                  accessibilityLabel={
                    typeText
                      ? 'Mode: type text. Switch to prompt'
                      : 'Mode: prompt. Switch to type text'
                  }
                  variant="secondary"
                  onPress={() => {
                    setTypeText((value) => !value);
                    setSent('');
                  }}
                  style={{
                    minHeight: 42,
                    minWidth: 76,
                    paddingVertical: 8,
                    paddingHorizontal: 11,
                  }}
                />
              )}
              <TextInput
                accessibilityLabel={typeText ? 'Terminal text' : 'Agent prompt'}
                placeholder={
                  typeText ? 'Text · no Enter' : 'Prompt · sends Enter'
                }
                placeholderTextColor={c.muted}
                multiline
                value={draft}
                onChangeText={(value) => {
                  setDraft(value);
                  setSent('');
                }}
                editable={!busy && !dictation.listening}
                selectionColor={c.accent}
                style={{
                  flex: 1,
                  color: c.text,
                  backgroundColor: c.panel,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: c.line,
                  minHeight: 42,
                  maxHeight: 110,
                  fontSize: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  textAlignVertical: 'center',
                }}
              />
              <DictationControl
                language={dictation.language}
                listening={dictation.listening}
                disabled={busy}
                onToggle={() => {
                  if (dictation.listening) {
                    dictation.stop();
                    return;
                  }
                  setSent('');
                  void dictation.start(draft);
                }}
                onSwitchLanguage={dictation.switchLanguage}
              />
              <IconButton
                label={typeText ? 'Type text into terminal' : 'Send prompt'}
                onPress={send}
                primary
                busy={busy}
                disabled={!draft.trim() || offline || (blocked && !typeText)}
                size={42}
              >
                <Send size={17} color={c.ink} />
              </IconButton>
            </View>
          </View>
        </View>
        <ErrorSheet
          message={actionError}
          onClose={() => setActionError(null)}
        />
        <SpeechModelSheet
          language={dictation.missing}
          onDownload={() => void dictation.download()}
          onClose={dictation.dismissMissing}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
