import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  effectiveMode,
  initialMode,
  newLineCount,
  nextMode,
  paneHasAgent,
  runFailureNotice,
  type ComposerMode,
} from '@/lib/terminal';
import { clearHandoff, peekHandoff } from '@/lib/handoff';
import { shortPath } from '@/lib/sessions';
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
  radius,
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
  { label: 'recent', value: 'RECENT' },
  { label: 'screen', value: 'VISIBLE' },
];
// One line that scrolls sideways; it never wraps.
const keys = [
  { label: 'esc', name: 'Escape', key: 'esc' },
  { label: 'tab', name: 'Tab', key: 'tab' },
  { label: '↑', name: 'Up arrow', key: 'up' },
  { label: '↓', name: 'Down arrow', key: 'down' },
  { label: '←', name: 'Left arrow', key: 'left' },
  { label: '→', name: 'Right arrow', key: 'right' },
  { label: 'enter', name: 'Enter', key: 'enter' },
  { label: '^C', name: 'Ctrl+C', key: 'ctrl+c' },
  { label: 'y', name: 'y', key: 'y' },
  { label: 'n', name: 'n', key: 'n' },
];

const modeNames: Record<ComposerMode, string> = {
  prompt: 'prompt',
  run: 'run command',
  type: 'type text',
};
const inputNames: Record<ComposerMode, string> = {
  prompt: 'Agent prompt',
  run: 'Command',
  type: 'Terminal text',
};
const placeholders: Record<ComposerMode, string> = {
  prompt: 'prompt · sends enter',
  run: '$ command · runs with enter',
  type: 'text · no enter',
};
const sendNames: Record<ComposerMode, string> = {
  prompt: 'Send prompt',
  run: 'Run command',
  type: 'Type text into terminal',
};

function timeSinceLabel(date: string | undefined): string {
  if (!date) return '';
  const delta = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (delta < 5) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  return `${Math.floor(delta / 60)}m ago`;
}

export function AgentScreen({ paneId, raw }: { paneId: string; raw: boolean }) {
  useHomeBack();
  const { client, activeMachine } = useSession();
  // A first task from New session that may not have arrived comes back as
  // the draft, with a notice to check the terminal before resending.
  const handoffKey = `${activeMachine?.id}/${paneId}`;
  const [handoff] = useState(() => peekHandoff(handoffKey));
  useEffect(() => clearHandoff(handoffKey), [handoffKey]);
  const snapshot = useSnapshot();
  const agent = snapshot.data?.agents.find((item) => item.paneId === paneId);
  const pane = snapshot.data?.panes.find((item) => item.id === paneId);
  // An agent started by hand in a plain shell gets the agent controls; until
  // the first snapshot, the route says which kind of pane this is.
  const hasAgent = paneHasAgent(!!snapshot.data, !!agent, raw);

  const [source, setSource] = useState<Source>('RECENT');
  const [draft, setDraft] = useState(handoff?.draft ?? '');
  // Plain shells start in Run, agents in Prompt; Type never presses Enter.
  const [mode, setMode] = useState<ComposerMode>(() =>
    initialMode(raw, handoff?.mode),
  );
  const composer = effectiveMode(mode, hasAgent);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(
    handoff?.notice ?? null,
  );
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
    const sendMode = composer;
    let enterFailed = false;
    void act(
      async () => {
        if (sendMode === 'prompt') {
          await client.mutate({
            mutation: PROMPT,
            variables: { target: paneId, text: submitted },
          });
          return;
        }
        await client.mutate({
          mutation: SEND_TEXT,
          variables: { paneId, text: submitted },
        });
        if (sendMode !== 'run') return;
        // The text is in the terminal now; a failed Enter is never retried.
        try {
          await client.mutate({
            mutation: KEYS,
            variables: { target: paneId, keys: ['enter'], raw: true },
          });
        } catch {
          enterFailed = true;
        }
      },
      () => {
        setDraft((value) => (value === submitted ? '' : value));
        if (enterFailed) setActionError(runFailureNotice(true));
        else
          setSent(
            sendMode === 'run'
              ? 'command sent.'
              : sendMode === 'type'
                ? 'text sent. tap enter to submit it.'
                : 'prompt delivered.',
          );
      },
    );
  };

  const sendKey = (key: string) => {
    if (!client) return;
    void act(() =>
      client.mutate({
        mutation: KEYS,
        variables: {
          target: paneId,
          keys: [key],
          raw: !hasAgent || composer === 'type',
        },
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
    'terminal';
  const details = [
    agent?.kind ?? 'terminal',
    shortPath(agent?.cwd ?? pane?.cwd),
  ]
    .filter(Boolean)
    .join(' · ');
  const blocked = hasAgent && agent?.status === 'blocked';
  const offline = !!output.error || !output.data;
  const lineCount = shown ? shown.split('\n').length : 0;
  const jumpLabel =
    frozen === null || frozen === latest
      ? 'latest'
      : pending === null
        ? 'new output'
        : pending > 0
          ? `${pending} new line${pending === 1 ? '' : 's'}`
          : 'latest';

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
              {agent ? (
                <Status status={agent.status} pulse />
              ) : hasAgent ? (
                <Status status="unknown" />
              ) : (
                // A plain shell has no agent status to show.
                <Text style={[s.muted, { color: c.accent }]}>$</Text>
              )}
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
            backgroundColor: c.bg,
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
                    paddingHorizontal: 10,
                  }}
                />
              ))}
            </View>
            <View style={[s.row, { gap: 8 }]}>
              <Text
                numberOfLines={1}
                style={[s.eyebrow, { fontSize: 10, lineHeight: 13 }]}
              >
                {output.error
                  ? 'offline · cached'
                  : output.data
                    ? timeSinceLabel(output.data.fetchedAt)
                    : 'syncing'}
              </Text>
              <LiveBadge active={following && agent?.status === 'working'} />
              <LiveBadge active={!following} label="paused" tone="paused" />
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
                  color: c.term,
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
                accessibilityLabel={`Send ${item.name}`}
                variant={item.key === 'ctrl+c' ? 'danger' : 'secondary'}
                disabled={busy || offline}
                onPress={() => sendKey(item.key)}
                style={{
                  minHeight: 36,
                  minWidth: 40,
                  paddingVertical: 6,
                  paddingHorizontal: 11,
                }}
              />
            ))}
          </ScrollView>
          <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 6 }}>
            {blocked && composer !== 'type' && (
              <Text
                numberOfLines={1}
                style={{
                  color: c.red,
                  fontFamily: mono,
                  fontSize: 11,
                  lineHeight: 15,
                }}
              >
                ● needs input · answer with type or the keys above.
              </Text>
            )}
            {dictation.listening ? (
              <Text
                accessibilityLiveRegion="polite"
                numberOfLines={1}
                style={{
                  color: c.red,
                  fontFamily: mono,
                  fontSize: 11,
                  lineHeight: 15,
                }}
              >
                ● Listening in {languageInfo(dictation.language).name} · tap ■
                to stop
              </Text>
            ) : dictation.notice ? (
              <Text
                accessibilityLiveRegion="polite"
                numberOfLines={2}
                style={{
                  color: c.amber,
                  fontFamily: mono,
                  fontSize: 11,
                  lineHeight: 15,
                }}
              >
                {dictation.notice}
              </Text>
            ) : (
              !!sent && (
                <Text
                  accessibilityLiveRegion="polite"
                  numberOfLines={1}
                  style={{
                    color: c.accent,
                    fontFamily: mono,
                    fontSize: 11,
                    lineHeight: 15,
                  }}
                >
                  {sent}
                </Text>
              )
            )}
            <View style={[s.row, { gap: 8, alignItems: 'flex-end' }]}>
              <Button
                title={composer}
                accessibilityLabel={`Mode: ${modeNames[composer]}. Switch to ${modeNames[nextMode(composer, hasAgent)]}`}
                variant="secondary"
                onPress={() => {
                  setMode(nextMode(composer, hasAgent));
                  setSent('');
                }}
                style={{
                  minHeight: 42,
                  minWidth: 64,
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                }}
              />
              <TextInput
                accessibilityLabel={inputNames[composer]}
                placeholder={placeholders[composer]}
                placeholderTextColor={c.dim}
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
                  fontFamily: mono,
                  backgroundColor: c.panel,
                  borderRadius: radius,
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
                label={sendNames[composer]}
                onPress={send}
                primary
                busy={busy}
                disabled={
                  !draft.trim() || offline || (blocked && composer === 'prompt')
                }
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
