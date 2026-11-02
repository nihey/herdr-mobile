import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
import {
  Check,
  ChevronRight,
  FolderOpen,
  Pencil,
  TerminalSquare,
} from 'lucide-react-native';
import { useSession } from '@/lib/session-context';
import { useDictation } from '@/hooks/useDictation';
import { NEW_SESSION_OPTIONS, PROMPT, START_SESSION } from '@/lib/graphql';
import { errorMessage } from '@/lib/errors';
import { handOff } from '@/lib/handoff';
import { languageInfo } from '@/lib/dictation';
import {
  kindChoices,
  shortPath,
  suggestName,
  validAgentName,
} from '@/lib/sessions';
import type { Agent, Project, StartedSession } from '@/lib/types';
import {
  Button,
  c,
  Field,
  Loading,
  mono,
  Notice,
  s,
  Sheet,
} from '@/components/ui';
import {
  DictationControl,
  SpeechModelSheet,
} from '@/components/DictationControl';

const outdatedBridge =
  'This bridge is too old to start sessions. On your computer, rebuild and restart the Herd Remote bridge, then try again.';

function isOutdated(reason: unknown) {
  return (
    CombinedGraphQLErrors.is(reason) &&
    reason.errors.some((e) =>
      /^(Cannot query field|Unknown (argument|type))/.test(e.message),
    )
  );
}

/** The pane Herdr opened before the agent failed, and the daemon's code. */
function openedPane(reason: unknown) {
  if (!CombinedGraphQLErrors.is(reason)) return null;
  for (const error of reason.errors)
    if (typeof error.extensions?.paneId === 'string')
      return {
        paneId: error.extensions.paneId,
        code: String(error.extensions.code ?? ''),
      };
  return null;
}

function startError(reason: unknown) {
  if (isOutdated(reason)) return outdatedBridge;
  if (
    CombinedGraphQLErrors.is(reason) ||
    (ServerError.is(reason) && reason.statusCode === 401)
  )
    return errorMessage(reason);
  return 'Delivery is uncertain. Refresh your agents before trying again; the session may already be starting on your computer.';
}

export function NewSessionSheet({
  agents,
  initialWorkspaceId,
  onClose,
  onOpen,
}: {
  agents: Agent[];
  initialWorkspaceId: string | null;
  onClose: () => void;
  /** Open a terminal; `raw` when no agent runs in it. */
  onOpen: (paneId: string, raw: boolean) => void;
}) {
  const { client, activeMachine } = useSession();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [supported, setSupported] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
  const [picking, setPicking] = useState(!initialWorkspaceId);
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [customName, setCustomName] = useState<string | null>(null);
  // The generated name used by the last attempt, kept for any retry.
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'starting' | 'sending'>('starting');
  const [error, setError] = useState('');
  const [orphan, setOrphan] = useState<string | null>(null);
  const alive = useRef(true);
  // Starting opens a tab, so guard double taps synchronously.
  const submitting = useRef(false);
  const dictation = useDictation({ onText: setTask, onError: setError });

  const load = useCallback(() => {
    if (!client) return;
    client
      .query<{ agentKinds: string[]; session: { workspaces: Project[] } }>({
        query: NEW_SESSION_OPTIONS,
      })
      .then((result) => {
        if (!alive.current) return;
        if (!result.data) throw new Error('No projects returned.');
        setProjects(result.data.session.workspaces);
        setSupported(result.data.agentKinds);
        setLoadError('');
      })
      .catch((reason: unknown) => {
        if (alive.current)
          setLoadError(
            isOutdated(reason) ? outdatedBridge : errorMessage(reason),
          );
      });
  }, [client]);
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const project = projects?.find((p) => p.id === workspaceId) ?? null;
  // A preselected project that has since closed falls back to the list.
  const showPicker = picking || !project;
  const choices = useMemo(
    () => kindChoices(agents, workspaceId ?? '', supported),
    [agents, workspaceId, supported],
  );
  const chosenKind = kind || choices.primary[0] || '';
  const taken = agents.map((a) => a.name);
  const name = customName ?? submittedName ?? suggestName(chosenKind, taken);
  const duplicate = taken.includes(name);
  const visible = (projects ?? []).filter((p) =>
    [p.label, p.cwd]
      .join(' ')
      .toLowerCase()
      .includes(filter.trim().toLowerCase()),
  );

  const choose = (id: string) => {
    if (id !== workspaceId) {
      setKind('');
      setShowMore(false);
      setSubmittedName(null);
    }
    setWorkspaceId(id);
    setPicking(false);
    setError('');
    setOrphan(null);
  };

  const start = async () => {
    if (!client || !project || submitting.current) return;
    submitting.current = true;
    dictation.cancel();
    // Keep this name for any retry: if the first attempt did start, Herdr
    // rejects the duplicate instead of opening a second tab.
    setSubmittedName(name);
    const firstTask = task.trim() ? task : '';
    setBusy(true);
    setPhase('starting');
    setError('');
    setOrphan(null);
    let started: StartedSession;
    try {
      const result = await client.mutate<{ startSession: StartedSession }>({
        mutation: START_SESSION,
        variables: { workspaceId: project.id, kind: chosenKind, name },
      });
      if (!result.data) throw new Error('No session returned.');
      started = result.data.startSession;
    } catch (reason) {
      const opened = openedPane(reason);
      if (opened?.code === 'agent_not_ready') {
        // Started, but stopped at a question (such as a trust prompt).
        handOff(`${activeMachine?.id}/${opened.paneId}`, {
          draft: firstTask,
          notice: `The agent started but is asking something before it is ready. Read the terminal and answer it first.${
            firstTask ? ' Your first task is in the box and was not sent.' : ''
          }`,
        });
        onOpen(opened.paneId, false);
        return;
      }
      submitting.current = false;
      if (alive.current) {
        setOrphan(opened?.paneId ?? null);
        setError(startError(reason));
        setBusy(false);
      }
      return;
    }
    const key = `${activeMachine?.id}/${started.paneId}`;
    if (firstTask && !started.ready) {
      handOff(key, {
        draft: firstTask,
        notice:
          'The agent is still starting, so your first task was not sent. It is in the box: send it once the agent shows as idle.',
      });
    } else if (firstTask) {
      if (alive.current) setPhase('sending');
      try {
        await client.mutate({
          mutation: PROMPT,
          variables: { target: started.paneId, text: firstTask },
        });
      } catch (reason) {
        // Never resent automatically: restore it as the terminal's draft.
        handOff(key, {
          draft: firstTask,
          notice: `The session started, but the first task may not have reached it.${
            CombinedGraphQLErrors.is(reason) ? ` ${errorMessage(reason)}` : ''
          } Read the terminal before sending it again.`,
        });
      }
    }
    onOpen(started.paneId, false);
  };

  return (
    <Sheet
      visible
      title={showPicker ? 'Choose a project' : 'New session'}
      onClose={() => {
        if (busy) return;
        if (showPicker && project) setPicking(false);
        else onClose();
      }}
    >
      {!!loadError && <Notice message={loadError} danger />}
      {!projects && !loadError && (
        <View style={{ height: 120 }}>
          <Loading label="Finding your projects…" />
        </View>
      )}
      {projects && showPicker && (
        <>
          <Text style={s.muted}>
            Projects open in Herdr on {activeMachine?.name ?? 'your computer'}.
            The new agent gets its own tab.
          </Text>
          {projects.length > 6 && (
            <Field
              placeholder="Find a project"
              value={filter}
              onChangeText={setFilter}
            />
          )}
          <View style={{ gap: 8 }}>
            {visible.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${item.label}`}
                accessibilityState={{ selected: item.id === workspaceId }}
                onPress={() => choose(item.id)}
                style={({ pressed }) => [
                  s.row,
                  {
                    padding: 14,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: item.id === workspaceId ? c.accent : c.line,
                    backgroundColor: c.bg,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <FolderOpen size={18} color={c.accent} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    style={[s.body, { fontWeight: '600' }]}
                  >
                    {item.label}
                  </Text>
                  {!!item.cwd && (
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="middle"
                      style={[s.muted, { fontFamily: mono, fontSize: 11 }]}
                    >
                      {shortPath(item.cwd)}
                    </Text>
                  )}
                </View>
                {item.id === workspaceId ? (
                  <Check size={18} color={c.accent} />
                ) : (
                  <ChevronRight size={18} color={c.muted} />
                )}
              </Pressable>
            ))}
            {!visible.length && (
              <Text style={s.muted}>
                {projects.length
                  ? 'No open project matches.'
                  : 'No projects are open in Herdr. Open one on your computer first.'}
              </Text>
            )}
          </View>
        </>
      )}
      {projects && !showPicker && project && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Project ${project.label}. Change project`}
            disabled={busy}
            onPress={() => {
              setPicking(true);
              load();
            }}
            style={[
              s.row,
              {
                padding: 14,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: c.line,
                backgroundColor: c.bg,
              },
            ]}
          >
            <FolderOpen size={18} color={c.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={1} style={[s.body, { fontWeight: '600' }]}>
                {project.label}
              </Text>
              {!!project.cwd && (
                <Text
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={[s.muted, { fontFamily: mono, fontSize: 11 }]}
                >
                  {shortPath(project.cwd)}
                </Text>
              )}
            </View>
            <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600' }}>
              Change
            </Text>
          </Pressable>

          <View style={{ gap: 10 }}>
            <Text style={s.eyebrow}>AGENT</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[...choices.primary, ...(showMore ? choices.more : [])].map(
                (item) => (
                  <Button
                    key={item}
                    title={item}
                    accessibilityLabel={`Agent ${item}`}
                    variant={chosenKind === item ? 'primary' : 'secondary'}
                    disabled={busy}
                    onPress={() => {
                      setKind(item);
                      setSubmittedName(null);
                    }}
                    style={chip}
                  />
                ),
              )}
              {!!choices.more.length && (
                <Button
                  title={showMore ? 'Fewer' : 'More…'}
                  variant="ghost"
                  disabled={busy}
                  onPress={() => setShowMore((value) => !value)}
                  style={chip}
                />
              )}
            </View>
          </View>

          {customName === null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Agent name ${name}. Edit name`}
              disabled={busy}
              onPress={() => setCustomName(name)}
              style={[s.row, { gap: 8, minHeight: 32 }]}
            >
              <Text style={s.muted}>Name</Text>
              <Text style={[s.body, { fontFamily: mono, fontSize: 13 }]}>
                {name}
              </Text>
              <Pencil size={14} color={c.muted} />
            </Pressable>
          ) : (
            <Field
              label="Agent name"
              value={customName}
              onChangeText={(value) => setCustomName(value.toLowerCase())}
              editable={!busy}
              maxLength={32}
              autoFocus
            />
          )}
          {customName !== null && !validAgentName(customName) && (
            <Text style={{ color: c.amber, fontSize: 12 }}>
              Start with a letter; use lowercase letters, digits, - or _.
            </Text>
          )}
          {/* After a failed start Herdr may still hold the name; the error explains. */}
          {duplicate && !busy && !error && (
            <Text style={{ color: c.amber, fontSize: 12 }}>
              Another agent is already named {name}. Choose a different name.
            </Text>
          )}

          <View style={{ gap: 10 }}>
            <Text style={s.eyebrow}>FIRST TASK · OPTIONAL</Text>
            <View style={[s.row, { gap: 8, alignItems: 'flex-end' }]}>
              <TextInput
                accessibilityLabel="First task"
                placeholder="What should it work on?"
                placeholderTextColor={c.muted}
                multiline
                value={task}
                onChangeText={setTask}
                editable={!busy && !dictation.listening}
                selectionColor={c.accent}
                style={{
                  flex: 1,
                  color: c.text,
                  backgroundColor: c.bg,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: c.line,
                  minHeight: 64,
                  maxHeight: 140,
                  fontSize: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  textAlignVertical: 'top',
                }}
              />
              <DictationControl
                language={dictation.language}
                listening={dictation.listening}
                disabled={busy}
                onToggle={() => {
                  if (dictation.listening) dictation.stop();
                  else void dictation.start(task);
                }}
                onSwitchLanguage={dictation.switchLanguage}
              />
            </View>
            {dictation.listening ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: c.red, fontSize: 12 }}
              >
                ● Listening in {languageInfo(dictation.language).name} · tap ■
                to stop
              </Text>
            ) : (
              !!dictation.notice && (
                <Text style={{ color: c.amber, fontSize: 12 }}>
                  {dictation.notice}
                </Text>
              )
            )}
          </View>

          <Text style={s.muted}>
            Opens a new tab in {project.label} on your computer and starts{' '}
            {chosenKind || 'the agent'} there. Your other agents keep running
            untouched.
          </Text>
          {!!error && <Notice message={error} danger />}
          {!!orphan && (
            <Button
              title="Open the new terminal"
              variant="secondary"
              icon={<TerminalSquare size={16} color={c.text} />}
              onPress={() => {
                // Keep the typed task; the shell's Type mode sends no Enter.
                if (task.trim())
                  handOff(`${activeMachine?.id}/${orphan}`, {
                    draft: task,
                    notice: '',
                  });
                onOpen(orphan, true);
              }}
            />
          )}
          <Button
            title={
              !busy
                ? 'Start session'
                : phase === 'sending'
                  ? 'Sending first task…'
                  : `Starting ${chosenKind}…`
            }
            busy={busy}
            disabled={
              !validAgentName(name) ||
              !validAgentName(chosenKind) ||
              duplicate ||
              !!loadError
            }
            onPress={() => void start()}
          />
          {busy && phase === 'starting' && (
            <Text style={{ color: c.amber, fontSize: 12 }}>
              Waiting for {chosenKind} to be ready. This can take about 40
              seconds.
            </Text>
          )}
        </>
      )}
      <SpeechModelSheet
        language={dictation.missing}
        onDownload={() => void dictation.download()}
        onClose={dictation.dismissMissing}
      />
    </Sheet>
  );
}

const chip = {
  minHeight: 38,
  paddingVertical: 7,
  paddingHorizontal: 13,
  borderRadius: 10,
};
