import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
import {
  Check,
  ChevronRight,
  FolderOpen,
  House,
  Pencil,
  TerminalSquare,
} from 'lucide-react-native';
import { useSession } from '@/lib/session-context';
import { useDictation } from '@/hooks/useDictation';
import {
  HOME_FOLDER,
  KEYS,
  NEW_SESSION_OPTIONS,
  PROMPT,
  SEND_TEXT,
  START_SESSION,
  START_TERMINAL,
} from '@/lib/graphql';
import { errorMessage } from '@/lib/errors';
import { handOff } from '@/lib/handoff';
import { languageInfo } from '@/lib/dictation';
import {
  HOME,
  isOutdated,
  kindChoices,
  listedProjects,
  shortPath,
  suggestName,
  terminalsSupported,
  validAgentName,
} from '@/lib/sessions';
import { runFailureNotice } from '@/lib/terminal';
import type {
  Agent,
  Project,
  StartedSession,
  StartedTerminal,
} from '@/lib/types';
import {
  Button,
  c,
  Field,
  Loading,
  mono,
  Notice,
  radius,
  s,
  Sheet,
} from '@/components/ui';
import {
  DictationControl,
  SpeechModelSheet,
} from '@/components/DictationControl';

/** The kind chip for a plain shell (no agent). */
const TERMINAL = 'terminal';

const outdatedBridge =
  'This bridge is too old for this. On your computer, rebuild and restart the Herd Remote bridge, then try again.';

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

function startError(reason: unknown, terminal: boolean) {
  if (isOutdated(reason)) return outdatedBridge;
  if (
    CombinedGraphQLErrors.is(reason) ||
    (ServerError.is(reason) && reason.statusCode === 401)
  )
    return errorMessage(reason);
  return terminal
    ? 'Delivery is uncertain. Refresh before trying again; the terminal may already be open on your computer.'
    : 'Delivery is uncertain. Refresh your agents before trying again; the session may already be starting on your computer.';
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
  const [homeFolder, setHomeFolder] = useState<string | null>(null);
  // False on a bridge older than 0.5.0 (no terminals or home sessions).
  const [canTerminal, setCanTerminal] = useState(true);
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
        setProjects(listedProjects(result.data.session.workspaces));
        setSupported(result.data.agentKinds);
        setLoadError('');
      })
      .catch((reason: unknown) => {
        if (alive.current)
          setLoadError(
            isOutdated(reason) ? outdatedBridge : errorMessage(reason),
          );
      });
    // Separate, so an older bridge still lists projects for agent sessions.
    client
      .query<{ homeFolder: string | null }>({ query: HOME_FOLDER })
      .then((result) => {
        if (!alive.current) return;
        setHomeFolder(result.data?.homeFolder ?? null);
        setCanTerminal(true);
      })
      .catch((reason: unknown) => {
        if (alive.current) setCanTerminal(terminalsSupported(reason));
      });
  }, [client]);
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const home: Project = { id: HOME, label: 'home folder', cwd: homeFolder };
  const project =
    workspaceId === HOME
      ? home
      : (projects?.find((p) => p.id === workspaceId) ?? null);
  // A preselected project that has since closed falls back to the list.
  const showPicker = picking || !project;
  const choices = useMemo(
    () =>
      kindChoices(
        agents,
        workspaceId && workspaceId !== HOME ? workspaceId : '',
        supported,
      ),
    [agents, workspaceId, supported],
  );
  const chosenKind = kind || choices.primary[0] || '';
  const terminal = chosenKind === TERMINAL;
  const taken = agents.map((a) => a.name);
  const name = customName ?? submittedName ?? suggestName(chosenKind, taken);
  const duplicate = !terminal && taken.includes(name);
  const unsupported = !canTerminal && (terminal || workspaceId === HOME);
  const visible = [home, ...(projects ?? [])].filter((p) =>
    [p.label, p.cwd]
      .join(' ')
      .toLowerCase()
      .includes(filter.trim().toLowerCase()),
  );
  const target = project?.id === HOME ? null : (project?.id ?? null);
  const place = project?.id === HOME ? 'your home folder' : project?.label;

  const choose = (id: string) => {
    if (id !== workspaceId) {
      if (kind !== TERMINAL) setKind('');
      setShowMore(false);
      setSubmittedName(null);
    }
    setWorkspaceId(id);
    setPicking(false);
    setError('');
    setOrphan(null);
  };

  const begin = () => {
    submitting.current = true;
    dictation.cancel();
    setBusy(true);
    setPhase('starting');
    setError('');
    setOrphan(null);
  };
  const failed = (reason: unknown, paneId: string | null = null) => {
    submitting.current = false;
    if (!alive.current) return;
    setOrphan(paneId);
    setError(startError(reason, terminal));
    setBusy(false);
  };

  const openTerminal = async () => {
    if (!client || !project || submitting.current) return;
    begin();
    const command = task.trim() ? task : '';
    let started: StartedTerminal;
    try {
      const result = await client.mutate<{ startTerminal: StartedTerminal }>({
        mutation: START_TERMINAL,
        variables: { workspaceId: target },
      });
      if (!result.data) throw new Error('No terminal returned.');
      started = result.data.startTerminal;
    } catch (reason) {
      failed(reason);
      return;
    }
    const key = `${activeMachine?.id}/${started.paneId}`;
    if (command && !started.ready) {
      handOff(key, {
        draft: command,
        notice:
          'The shell was still starting, so your command was not run. It is in the box: tap send when you see the prompt.',
      });
    } else if (command) {
      if (alive.current) setPhase('sending');
      // Text, then Enter; neither is ever resent.
      let typed = false;
      try {
        await client.mutate({
          mutation: SEND_TEXT,
          variables: { paneId: started.paneId, text: command },
        });
        typed = true;
        await client.mutate({
          mutation: KEYS,
          variables: { target: started.paneId, keys: ['enter'], raw: true },
        });
      } catch {
        handOff(
          key,
          typed
            ? { draft: '', notice: runFailureNotice(true) }
            : {
                draft: command,
                notice:
                  'The terminal opened, but your command may not have reached it. Check the terminal before running it again.',
              },
        );
      }
    }
    onOpen(started.paneId, true);
  };

  const startSession = async () => {
    if (!client || !project || submitting.current) return;
    begin();
    // Keep this name for any retry: if the first attempt did start, Herdr
    // rejects the duplicate instead of opening a second tab.
    setSubmittedName(name);
    const firstTask = task.trim() ? task : '';
    let started: StartedSession;
    try {
      const result = await client.mutate<{ startSession: StartedSession }>({
        mutation: START_SESSION,
        variables: { workspaceId: target, kind: chosenKind, name },
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
      failed(reason, opened?.paneId ?? null);
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
      title={showPicker ? 'choose a project' : 'new'}
      onClose={() => {
        if (busy) return;
        if (showPicker && project) setPicking(false);
        else onClose();
      }}
    >
      {!!loadError && <Notice message={loadError} danger />}
      {!projects && !loadError && (
        <View style={{ height: 120 }}>
          <Loading label="finding your projects…" />
        </View>
      )}
      {projects && showPicker && (
        <>
          <Text style={s.muted}>
            Projects open in Herdr on {activeMachine?.name ?? 'your computer'},
            or your home folder. Each new session or terminal gets its own tab.
          </Text>
          {projects.length > 6 && (
            <Field
              placeholder="find a project"
              accessibilityLabel="Find a project"
              value={filter}
              onChangeText={setFilter}
            />
          )}
          <View style={{ gap: 2 }}>
            {visible.map((item) => {
              const selected = item.id === workspaceId;
              const Icon = item.id === HOME ? House : FolderOpen;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose ${item.label}`}
                  accessibilityState={{ selected }}
                  onPress={() => choose(item.id)}
                  style={({ pressed }) => [
                    s.item,
                    s.row,
                    { paddingVertical: 10 },
                    (selected || pressed) && s.selected,
                  ]}
                >
                  <Icon size={16} color={c.accent} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      numberOfLines={1}
                      style={[s.body, { fontWeight: '700' }]}
                    >
                      {item.label}
                    </Text>
                    {!!item.cwd && (
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="middle"
                        style={s.eyebrow}
                      >
                        {shortPath(item.cwd)}
                      </Text>
                    )}
                  </View>
                  {selected ? (
                    <Check size={16} color={c.accent} />
                  ) : (
                    <ChevronRight size={16} color={c.dim} />
                  )}
                </Pressable>
              );
            })}
            {!visible.length && (
              <Text style={s.muted}>No open project matches.</Text>
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
            style={[s.item, s.row, s.selected, { paddingVertical: 10 }]}
          >
            {project.id === HOME ? (
              <House size={16} color={c.accent} />
            ) : (
              <FolderOpen size={16} color={c.accent} />
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={1} style={[s.body, { fontWeight: '700' }]}>
                {project.label}
              </Text>
              {!!project.cwd && (
                <Text
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={s.eyebrow}
                >
                  {shortPath(project.cwd)}
                </Text>
              )}
            </View>
            <Text style={[s.muted, { color: c.accent }]}>change</Text>
          </Pressable>

          <View style={{ gap: 8 }}>
            <Text style={s.eyebrow}>run</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[
                ...choices.primary,
                TERMINAL,
                ...(showMore ? choices.more : []),
              ].map((item) => (
                <Button
                  key={item}
                  title={item}
                  accessibilityLabel={
                    item === TERMINAL ? 'Plain terminal' : `Agent ${item}`
                  }
                  icon={
                    item === TERMINAL ? (
                      <TerminalSquare
                        size={14}
                        color={chosenKind === item ? c.ink : c.text}
                      />
                    ) : undefined
                  }
                  variant={chosenKind === item ? 'primary' : 'secondary'}
                  disabled={busy}
                  onPress={() => {
                    setKind(item);
                    setSubmittedName(null);
                  }}
                  style={chip}
                />
              ))}
              {!!choices.more.length && (
                <Button
                  title={showMore ? 'fewer' : 'more…'}
                  accessibilityLabel={showMore ? 'Fewer agents' : 'More agents'}
                  variant="ghost"
                  disabled={busy}
                  onPress={() => setShowMore((value) => !value)}
                  style={chip}
                />
              )}
            </View>
          </View>

          {!terminal &&
            (customName === null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Agent name ${name}. Edit name`}
                disabled={busy}
                onPress={() => setCustomName(name)}
                style={[s.row, { gap: 8, minHeight: 32 }]}
              >
                <Text style={s.muted}>name</Text>
                <Text style={s.body}>{name}</Text>
                <Pencil size={13} color={c.dim} />
              </Pressable>
            ) : (
              <Field
                label="agent name"
                accessibilityLabel="Agent name"
                value={customName}
                onChangeText={(value) => setCustomName(value.toLowerCase())}
                editable={!busy}
                maxLength={32}
                autoFocus
              />
            ))}
          {!terminal && customName !== null && !validAgentName(customName) && (
            <Text style={[s.muted, { color: c.amber }]}>
              Start with a letter; use lowercase letters, digits, - or _.
            </Text>
          )}
          {/* After a failed start Herdr may still hold the name; the error explains. */}
          {duplicate && !busy && !error && (
            <Text style={[s.muted, { color: c.amber }]}>
              Another agent is already named {name}. Choose a different name.
            </Text>
          )}

          <View style={{ gap: 8 }}>
            <Text style={s.eyebrow}>
              {terminal ? 'first command · optional' : 'first task · optional'}
            </Text>
            <View style={[s.row, { gap: 8, alignItems: 'flex-end' }]}>
              <TextInput
                accessibilityLabel={terminal ? 'First command' : 'First task'}
                placeholder={
                  terminal ? 'e.g. git status' : 'what should it work on?'
                }
                placeholderTextColor={c.dim}
                multiline
                value={task}
                onChangeText={setTask}
                editable={!busy && !dictation.listening}
                selectionColor={c.accent}
                autoCapitalize={terminal ? 'none' : 'sentences'}
                autoCorrect={!terminal}
                style={{
                  flex: 1,
                  color: c.text,
                  fontFamily: mono,
                  backgroundColor: c.bg,
                  borderRadius: radius,
                  borderWidth: 1,
                  borderColor: c.line,
                  minHeight: terminal ? 46 : 64,
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
                style={[s.muted, { color: c.red }]}
              >
                ● listening in {languageInfo(dictation.language).name} · tap ■
                to stop
              </Text>
            ) : (
              !!dictation.notice && (
                <Text style={[s.muted, { color: c.amber }]}>
                  {dictation.notice}
                </Text>
              )
            )}
          </View>

          <Text style={s.muted}>
            {terminal
              ? `Opens a new tab in ${place} on your computer with a plain shell.`
              : `Opens a new tab in ${place} on your computer and starts ${chosenKind || 'the agent'} there.`}{' '}
            Your other agents keep running untouched.
          </Text>
          {unsupported && <Notice message={outdatedBridge} danger />}
          {!!error && <Notice message={error} danger />}
          {!!orphan && (
            <Button
              title="open the new terminal"
              accessibilityLabel="Open the new terminal"
              variant="secondary"
              icon={<TerminalSquare size={15} color={c.text} />}
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
                ? terminal
                  ? 'open terminal'
                  : 'start session'
                : phase === 'sending'
                  ? terminal
                    ? 'running your command…'
                    : 'sending first task…'
                  : terminal
                    ? 'opening terminal…'
                    : `starting ${chosenKind}…`
            }
            accessibilityLabel={terminal ? 'Open terminal' : 'Start session'}
            busy={busy}
            disabled={
              unsupported ||
              !!loadError ||
              (!terminal &&
                (!validAgentName(name) ||
                  !validAgentName(chosenKind) ||
                  duplicate))
            }
            onPress={() => void (terminal ? openTerminal() : startSession())}
          />
          {busy && phase === 'starting' && (
            <Text style={[s.muted, { color: c.amber }]}>
              {terminal
                ? 'Waiting for the shell prompt. This takes a few seconds.'
                : `Waiting for ${chosenKind} to be ready. This can take about 40 seconds.`}
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
  minHeight: 36,
  paddingVertical: 6,
  paddingHorizontal: 11,
};
