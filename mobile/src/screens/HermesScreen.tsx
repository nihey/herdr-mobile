import { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { ArrowLeft, Send, Square } from 'lucide-react-native';
import { useSession } from '@/lib/session-context';
import { useSnapshot } from '@/hooks/useSnapshot';
import { usePoll } from '@/hooks/usePoll';
import { useHomeBack } from '@/hooks/useHomeBack';
import { useDictation } from '@/hooks/useDictation';
import { HERMES, HERMES_NEW, HERMES_SEND, HERMES_STOP } from '@/lib/graphql';
import { errorMessage } from '@/lib/errors';
import { isOutdated } from '@/lib/sessions';
import { chipLabel, REPORT_ADDRESS, reportUrl } from '@/lib/hermes';
import { languageInfo } from '@/lib/dictation';
import type { Agent, Hermes, HermesMessage } from '@/lib/types';
import {
  Button,
  c,
  ErrorSheet,
  IconButton,
  Loading,
  mono,
  Notice,
  Pulse,
  radius,
  s,
  Screen,
  Sheet,
} from '@/components/ui';
import {
  DictationControl,
  SpeechModelSheet,
} from '@/components/DictationControl';

const UNCERTAIN =
  'Delivery is uncertain. Check the conversation before sending again; Hermes may already have your message.';
const OUTDATED = 'update the bridge on this computer to use hermes.';

function Bubble({
  message,
  agents,
  live,
  onOpen,
  onReport,
}: {
  message: HermesMessage;
  agents: Agent[] | undefined;
  live: boolean;
  onOpen: (paneId: string) => void;
  onReport: (message: HermesMessage) => void;
}) {
  const mine = message.role === 'USER';
  return (
    <View style={{ gap: 6, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      {!mine && message.chips.length > 0 && (
        <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
          {message.chips.map((chip, index) => {
            const agent = agents?.find((a) => a.paneId === chip.paneId);
            const label = chipLabel(chip, agents ? agent : undefined);
            return (
              <Pressable
                key={`${chip.paneId}-${index}`}
                accessibilityRole={agent ? 'button' : 'text'}
                accessibilityLabel={agent ? `Open ${label}` : label}
                disabled={!agent}
                onPress={() => onOpen(chip.paneId)}
                style={({ pressed }) => ({
                  borderWidth: 1,
                  borderColor: c.line,
                  backgroundColor: c.bg,
                  borderRadius: radius,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: agent ? c.accent : c.dim,
                    fontFamily: mono,
                    fontSize: 11,
                    lineHeight: 16,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <Pressable
        disabled={mine || !message.text}
        onLongPress={() => onReport(message)}
        accessibilityHint={mine ? undefined : 'Long-press to report this reply'}
        style={{
          maxWidth: '86%',
          backgroundColor: mine ? c.elevated : c.panel,
          borderWidth: mine ? 0 : 1,
          borderColor: c.line,
          borderRadius: 8,
          borderBottomRightRadius: mine ? 2 : 8,
          borderBottomLeftRadius: mine ? 8 : 2,
          paddingHorizontal: 10,
          paddingVertical: 8,
        }}
      >
        {message.text ? (
          <Text selectable style={[s.body, { fontSize: 13, lineHeight: 19 }]}>
            {message.text}
          </Text>
        ) : live ? (
          <View style={[s.row, { gap: 6, minHeight: 19 }]}>
            <Pulse color={c.amber} />
            <Text style={s.muted}>working…</Text>
          </View>
        ) : (
          <Text style={s.muted}>no answer.</Text>
        )}
      </Pressable>
      {message.stopped && <Text style={s.eyebrow}>stopped</Text>}
    </View>
  );
}

export function HermesScreen() {
  useHomeBack();
  const { client, activeMachine } = useSession();
  const snapshot = useSnapshot();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [report, setReport] = useState<HermesMessage | null>(null);
  const [interval, setPollInterval] = useState(4000);
  const scroll = useRef<ScrollView>(null);
  const following = useRef(true);

  const load = useCallback(async () => {
    if (!client) throw new Error('Not connected.');
    const result = await client.query<{ hermes: Hermes }>({ query: HERMES });
    if (!result.data) throw new Error('No conversation returned.');
    setPollInterval(result.data.hermes.working ? 1000 : 4000);
    return result.data.hermes;
  }, [client]);
  const conversation = usePoll(load, interval);
  const dictation = useDictation({ onText: setDraft, onError: setActionError });
  const hermes = conversation.data;
  const outdated = !!conversation.error && isOutdated(conversation.error);
  const ready = hermes?.status === 'READY' && !conversation.error;
  const working = !!hermes?.working;

  const mutate = async (
    operation: () => Promise<unknown>,
    after?: () => void,
  ) => {
    if (!client || busy) return;
    setBusy(true);
    try {
      await operation();
      after?.();
    } catch (reason) {
      // A refusal from the bridge is certain; a lost connection is not.
      setActionError(
        CombinedGraphQLErrors.is(reason) ? errorMessage(reason) : UNCERTAIN,
      );
    } finally {
      setBusy(false);
      conversation.refresh();
    }
  };
  const send = () => {
    if (!client || !draft.trim()) return;
    // Send exactly what is on screen; a phrase still being recognized is dropped.
    dictation.cancel();
    const submitted = draft;
    following.current = true;
    void mutate(
      () =>
        client.mutate({
          mutation: HERMES_SEND,
          variables: { text: submitted },
        }),
      () => setDraft((value) => (value === submitted ? '' : value)),
    );
  };
  const stop = () => {
    if (!client) return;
    void mutate(() => client.mutate({ mutation: HERMES_STOP }));
  };
  const startOver = () => {
    if (!client) return;
    setConfirmNew(false);
    void mutate(() => client.mutate({ mutation: HERMES_NEW }));
  };
  const openAgent = (paneId: string) =>
    router.push({
      pathname: '/agent/[paneId]',
      params: { paneId, machineId: activeMachine?.id },
    });
  const sendReport = async (message: HermesMessage) => {
    setReport(null);
    try {
      await Linking.openURL(reportUrl(message.text, REPORT_ADDRESS));
    } catch {
      setActionError(
        `No email app could open the report. Write to ${REPORT_ADDRESS}.`,
      );
    }
  };

  const messages = hermes?.messages ?? [];
  const subtitle = ['coordinates your agents', activeMachine?.name]
    .filter(Boolean)
    .join(' · ');
  const notice = outdated
    ? OUTDATED
    : conversation.error
      ? errorMessage(conversation.error)
      : hermes?.status === 'UNAVAILABLE'
        ? (hermes.reason ?? 'hermes is unavailable.')
        : hermes?.status === 'STARTING'
          ? 'starting hermes on this computer…'
          : null;

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
            <Text style={[s.heading, { fontSize: 17, color: c.accent }]}>
              ✦ hermes
            </Text>
            <Text numberOfLines={1} style={[s.eyebrow, { fontSize: 10 }]}>
              {subtitle}
            </Text>
            {!!hermes?.modelNote && (
              <Text
                numberOfLines={2}
                style={[s.eyebrow, { color: c.amber, fontSize: 10 }]}
              >
                {hermes.modelNote}
              </Text>
            )}
          </View>
          <Button
            title="new"
            accessibilityLabel="Start a new conversation with Hermes"
            variant="secondary"
            disabled={!ready || working || busy || !messages.length}
            onPress={() => setConfirmNew(true)}
            style={{ minHeight: 38, paddingVertical: 6, paddingHorizontal: 12 }}
          />
        </View>
        <View style={s.divider} />
        {conversation.loading && !hermes && !conversation.error ? (
          <Loading label="opening hermes…" />
        ) : (
          <ScrollView
            ref={scroll}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 14, gap: 12, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            onScroll={({ nativeEvent }) => {
              const { contentOffset, contentSize, layoutMeasurement } =
                nativeEvent;
              following.current =
                contentOffset.y + layoutMeasurement.height >=
                contentSize.height - 40;
            }}
            scrollEventThrottle={100}
            onContentSizeChange={() => {
              if (following.current)
                scroll.current?.scrollToEnd({ animated: false });
            }}
          >
            {!!notice && (
              <Notice
                message={notice}
                danger={outdated || !!conversation.error}
              />
            )}
            {!messages.length && ready && (
              <Text style={[s.muted, { textAlign: 'center', marginTop: 24 }]}>
                ask how your agents are doing, tell one what to do next, or
                start a new one.
              </Text>
            )}
            {messages.map((message, index) => (
              <Bubble
                key={message.id}
                message={message}
                agents={snapshot.data?.agents}
                live={working && index === messages.length - 1}
                onOpen={openAgent}
                onReport={setReport}
              />
            ))}
          </ScrollView>
        )}
        <View style={s.divider} />
        <View style={{ padding: 10, gap: 6 }}>
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
              ● Listening in {languageInfo(dictation.language).name} · tap ■ to
              stop
            </Text>
          ) : (
            !!dictation.notice && (
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
            )
          )}
          <View style={[s.row, { gap: 8, alignItems: 'flex-end' }]}>
            <TextInput
              accessibilityLabel="Message to Hermes"
              placeholder="ask or tell hermes…"
              placeholderTextColor={c.dim}
              multiline
              value={draft}
              onChangeText={setDraft}
              editable={!dictation.listening}
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
                void dictation.start(draft);
              }}
              onSwitchLanguage={dictation.switchLanguage}
            />
            {working ? (
              <IconButton
                label="Stop Hermes"
                onPress={stop}
                busy={busy}
                size={42}
              >
                <Square size={15} color={c.red} />
              </IconButton>
            ) : (
              <IconButton
                label="Send to Hermes"
                onPress={send}
                primary
                busy={busy}
                disabled={!draft.trim() || !ready}
                size={42}
              >
                <Send size={17} color={c.ink} />
              </IconButton>
            )}
          </View>
        </View>
        <Sheet
          title="new conversation"
          visible={confirmNew}
          onClose={() => setConfirmNew(false)}
        >
          <Text style={s.body}>
            Hermes starts fresh. This conversation is no longer shown here; your
            agents are not touched.
          </Text>
          <Button title="start fresh" onPress={startOver} />
        </Sheet>
        <Sheet
          title="this reply"
          visible={!!report}
          onClose={() => setReport(null)}
        >
          <Text numberOfLines={6} style={s.muted}>
            {report?.text}
          </Text>
          <Button
            title="report this reply"
            variant="secondary"
            onPress={() => report && void sendReport(report)}
          />
          <Text style={s.eyebrow}>
            opens an email draft to {REPORT_ADDRESS}; nothing is sent until you
            send it.
          </Text>
        </Sheet>
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
