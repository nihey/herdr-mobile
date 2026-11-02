import React, { useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronRight,
  CircleHelp,
  Code,
  Cpu,
  GitFork,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Terminal,
  Zap,
} from 'lucide-react-native';
import { useSession } from '@/lib/session-context';
import { useSnapshot } from '@/hooks/useSnapshot';
import type { Pane } from '@/lib/types';
import { errorMessage } from '@/lib/errors';
import { attentionOrder, cleanTitle, shortPath } from '@/lib/sessions';
import {
  Button,
  c,
  Field,
  IconButton,
  Loading,
  mono,
  Notice,
  s,
  Screen,
  Sheet,
  Status,
} from '@/components/ui';
import { StartAgentModal } from './StartAgentModal';
import { NewSessionSheet } from './NewSessionSheet';

type StatusFilter = 'working' | 'blocked' | null;

const kindIconMap: Record<string, React.FC<{ size: number; color: string }>> = {
  codex: Code,
  claude: MessageSquare,
  gemini: Zap,
  opencode: GitFork,
  cursor: Cpu,
  copilot: Terminal,
};

function KindIcon({
  kind,
  size = 17,
  color = c.accent,
}: {
  kind: string | null;
  size?: number;
  color?: string;
}) {
  const Icon = kindIconMap[kind ?? ''] ?? Terminal;
  return <Icon size={size} color={color} />;
}

export function AgentsScreen() {
  const { connection, activeMachine, forget, busy } = useSession();
  const { data, error, loading, refreshing, refresh, pull } = useSnapshot();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const [newSession, setNewSession] = useState(false);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [forgetError, setForgetError] = useState('');
  const [startPane, setStartPane] = useState<Pane | null>(null);
  const matches = (workspaceId: string, content: string) =>
    (!workspace || workspace === workspaceId) &&
    content.toLowerCase().includes(search.toLowerCase());
  const workspaceLabel = (id: string) =>
    data?.workspaces.find((item) => item.id === id)?.label ?? id;
  const agents = attentionOrder(
    data?.agents.filter(
      (agent) =>
        (!statusFilter || agent.status === statusFilter) &&
        matches(
          agent.workspaceId,
          [
            agent.name,
            agent.kind,
            agent.cwd,
            agent.title,
            workspaceLabel(agent.workspaceId),
          ].join(' '),
        ),
    ) ?? [],
  );
  const filtered = !!(search || workspace || statusFilter);
  const panes =
    data?.panes.filter(
      (pane) =>
        !data.agents.some((a) => a.paneId === pane.id) &&
        matches(pane.workspaceId, [pane.label, pane.cwd, pane.title].join(' ')),
    ) ?? [];
  const connected = !!data && !error;
  const openTerminal = (paneId: string, raw = false) =>
    router.push({
      pathname: '/agent/[paneId]',
      params: {
        paneId,
        ...(raw ? { raw: '1' } : {}),
        machineId: activeMachine?.id,
      },
    });
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[s.page, { paddingTop: 18, paddingBottom: 110 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={pull}
            tintColor={c.accent}
            colors={[c.accent]}
          />
        }
      >
        <View style={s.between}>
          <View style={s.row}>
            <GitFork size={23} color={c.accent} />
            <Text style={[s.heading, { fontSize: 22, letterSpacing: -0.8 }]}>
              Herd Remote
            </Text>
          </View>
          <IconButton
            label="Connection settings"
            onPress={() => setSettings(true)}
          >
            <Settings2 size={20} color={c.muted} />
          </IconButton>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage machines"
          onPress={() => router.push('/machines')}
          style={[s.row, { gap: 7, minHeight: 44 }]}
        >
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: connected ? c.accent : c.amber,
            }}
          />
          <Text
            numberOfLines={1}
            style={[s.muted, { fontFamily: mono, fontSize: 11, flex: 1 }]}
          >
            {activeMachine?.name ?? connection?.url.replace(/^https?:\/\//, '')}{' '}
            · {connected ? 'connected' : loading ? 'connecting' : 'offline'}
          </Text>
          <ChevronRight size={16} color={c.muted} />
        </Pressable>
        <View style={[s.between, { marginTop: 3 }]}>
          <View style={{ gap: 4 }}>
            <Text style={s.eyebrow}>MISSION CONTROL</Text>
            <Text style={s.title}>
              Your agents<Text style={{ color: c.accent }}>.</Text>
            </Text>
          </View>
          <IconButton label="Refresh agents" onPress={refresh}>
            <RefreshCw size={19} color={c.accent} />
          </IconButton>
        </View>
        {!!data && (
          <View
            style={[
              s.row,
              {
                gap: 0,
                borderBottomWidth: 1,
                borderTopWidth: 1,
                borderColor: c.line,
                paddingTop: 17,
                paddingBottom: 13,
              },
            ]}
          >
            {(
              [
                {
                  label: 'TOTAL',
                  filter: null,
                  count: data.agents.length,
                  color: c.text,
                },
                {
                  label: 'WORKING',
                  filter: 'working',
                  count: data.agents.filter((a) => a.status === 'working')
                    .length,
                  color: c.accent,
                },
                {
                  label: 'NEED INPUT',
                  filter: 'blocked',
                  count: data.agents.filter((a) => a.status === 'blocked')
                    .length,
                  color: c.amber,
                },
              ] as const
            ).map((item, i) => {
              const selected = statusFilter === item.filter;
              return (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  accessibilityLabel={
                    item.filter
                      ? `Show only ${item.label.toLowerCase()}, ${item.count}`
                      : `Show all agents, ${item.count}`
                  }
                  accessibilityState={{ selected }}
                  onPress={() =>
                    setStatusFilter(
                      item.filter === statusFilter ? null : item.filter,
                    )
                  }
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingLeft: i ? 18 : 0,
                    borderLeftWidth: i ? 1 : 0,
                    borderColor: c.line,
                    gap: 4,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text
                    style={{
                      fontSize: 28,
                      color: item.color,
                      fontWeight: '500',
                    }}
                  >
                    {String(item.count).padStart(2, '0')}
                  </Text>
                  <Text
                    style={[
                      s.eyebrow,
                      {
                        fontSize: 9,
                        letterSpacing: 1,
                        color: selected ? item.color : c.muted,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                  <View
                    style={{
                      height: 2,
                      width: 22,
                      borderRadius: 1,
                      backgroundColor:
                        selected && data.agents.length
                          ? item.color
                          : 'transparent',
                    }}
                  />
                </Pressable>
              );
            })}
          </View>
        )}
        {!!error && <Notice message={errorMessage(error)} danger />}
        <View style={{ position: 'relative' }}>
          <Field
            placeholder="Find an agent or directory"
            value={search}
            onChangeText={setSearch}
            style={{ paddingLeft: 42 }}
          />
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 14, top: 17 }}
          >
            <Search size={17} color={c.muted} />
          </View>
        </View>
        {!!data && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            <Button
              title="All workspaces"
              variant={workspace === null ? 'primary' : 'secondary'}
              onPress={() => setWorkspace(null)}
            />
            {data.workspaces.map((item) => (
              <Button
                key={item.id}
                title={item.label}
                variant={workspace === item.id ? 'primary' : 'secondary'}
                onPress={() => setWorkspace(item.id)}
              />
            ))}
          </ScrollView>
        )}
        {loading && !data ? (
          <View style={{ height: 160 }}>
            <Loading />
          </View>
        ) : (
          <>
            <View style={s.between}>
              <Text style={s.eyebrow}>AGENTS / {agents.length}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="About agent status"
                onPress={() => setHelp(true)}
                style={[s.row, { minHeight: 44, gap: 5 }]}
              >
                <CircleHelp color={c.muted} size={14} />
                <Text style={s.muted}>Status guide</Text>
              </Pressable>
            </View>
            {agents.map((agent) => {
              const project = workspaceLabel(agent.workspaceId);
              const heading = agent.name ?? project;
              const task = cleanTitle(agent.title);
              const meta = [
                agent.kind ?? 'agent',
                agent.name ? project : null,
                shortPath(agent.cwd),
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <Pressable
                  key={agent.paneId}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${heading}, ${agent.kind ?? 'agent'}, ${agent.status === 'blocked' ? 'needs input' : agent.status}`}
                  onPress={() => openTerminal(agent.paneId)}
                  style={({ pressed }) => [
                    s.card,
                    {
                      padding: 14,
                      gap: 7,
                      opacity: pressed ? 0.7 : 1,
                      borderLeftWidth: 3,
                      borderLeftColor:
                        agent.status === 'blocked'
                          ? c.amber
                          : agent.status === 'working'
                            ? c.accent
                            : c.line,
                    },
                  ]}
                >
                  <View style={s.between}>
                    <View style={[s.row, { flex: 1, gap: 10 }]}>
                      <View
                        style={{
                          width: 30,
                          height: 30,
                          backgroundColor: c.elevated,
                          borderRadius: 9,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <KindIcon
                          kind={agent.kind}
                          size={15}
                          color={c.accent}
                        />
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[s.heading, { fontSize: 16, flex: 1 }]}
                      >
                        {heading}
                      </Text>
                    </View>
                    <Status status={agent.status} />
                  </View>
                  {!!task && (
                    <Text
                      numberOfLines={1}
                      style={{ color: c.text, fontSize: 13, lineHeight: 18 }}
                    >
                      {task}
                    </Text>
                  )}
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="middle"
                    style={[
                      s.muted,
                      { fontFamily: mono, fontSize: 10, lineHeight: 14 },
                    ]}
                  >
                    {meta}
                  </Text>
                </Pressable>
              );
            })}
            {!agents.length && (
              <View style={s.card}>
                <Text style={s.heading}>
                  {filtered ? 'No matching agents' : 'Room for your next idea.'}
                </Text>
                <Text style={s.muted}>
                  {filtered
                    ? 'Try another search, status or workspace.'
                    : 'Your running Herdr agents appear here. Tap New session to start one in a project.'}
                </Text>
              </View>
            )}
            {!!panes.length && (
              <>
                <Text style={[s.eyebrow, { marginTop: 8 }]}>
                  OTHER TERMINALS / {panes.length}
                </Text>
                {panes.map((pane) => (
                  <View key={pane.id} style={[s.card, { padding: 14 }]}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => openTerminal(pane.id, true)}
                      style={s.between}
                    >
                      <View style={{ flex: 1, gap: 5 }}>
                        <Text style={s.body}>
                          {pane.label ?? pane.title ?? 'Terminal'}{' '}
                          <Text style={s.muted}>· {pane.id}</Text>
                        </Text>
                        <Text numberOfLines={1} style={s.muted}>
                          {workspaceLabel(pane.workspaceId)} ·{' '}
                          {pane.cwd ?? 'Shell'}
                        </Text>
                      </View>
                      <ChevronRight size={18} color={c.muted} />
                    </Pressable>
                    {!pane.kind && (
                      <Button
                        title="Start an agent here"
                        variant="secondary"
                        onPress={() => setStartPane(pane)}
                        icon={<Plus size={16} color={c.text} />}
                      />
                    )}
                  </View>
                ))}
              </>
            )}
            <Text
              style={[
                s.eyebrow,
                { fontSize: 9, textAlign: 'center', paddingVertical: 10 },
              ]}
            >
              RUNNING ON YOUR MACHINE. CONNECTED BY YOU.
            </Text>
          </>
        )}
      </ScrollView>
      {!!data?.workspaces.length && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            right: 20,
            // Absolute children ignore the safe-area padding; clear the nav bar.
            bottom: insets.bottom + 16,
          }}
        >
          <Button
            title="New session"
            accessibilityLabel="Start a new session in a project"
            icon={<Plus size={18} color={c.ink} />}
            onPress={() => setNewSession(true)}
            style={{
              borderRadius: 18,
              paddingHorizontal: 20,
              minHeight: 54,
              elevation: 6,
              shadowColor: '#000',
              shadowOpacity: 0.4,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
            }}
          />
        </View>
      )}
      {newSession && data && (
        <NewSessionSheet
          agents={data.agents}
          initialWorkspaceId={workspace}
          onClose={() => setNewSession(false)}
          onOpen={(paneId, raw) => {
            setNewSession(false);
            refresh();
            openTerminal(paneId, raw);
          }}
        />
      )}
      {startPane && (
        <StartAgentModal
          pane={startPane}
          workspaces={data?.workspaces ?? []}
          onClose={() => setStartPane(null)}
          onStarted={() => {
            setStartPane(null);
            refresh();
          }}
        />
      )}
      <Sheet
        visible={settings}
        title="Your connection"
        onClose={() => setSettings(false)}
      >
        <Text selectable style={s.body}>
          {connection?.url}
        </Text>
        <Text style={s.muted}>
          Herdr {data?.version ?? '—'} · protocol {data?.protocol ?? '—'}
        </Text>
        <Notice message="The bridge can control this Herdr session. Keep your pairing token private and keep both devices on your trusted tailnet." />
        <Button
          title="Manage machines"
          variant="secondary"
          onPress={() => {
            setSettings(false);
            router.push('/machines');
          }}
        />
        {!!forgetError && <Notice message={forgetError} danger />}
        <Button
          title="Forget connection"
          variant="danger"
          disabled={busy}
          onPress={() => {
            void forget().catch(() =>
              setForgetError(
                'Could not clear secure storage. Please try again.',
              ),
            );
          }}
        />
        <Text style={s.muted}>
          This removes saved pairing settings from this phone. Your agents keep
          running on your computer.
        </Text>
      </Sheet>
      <Sheet
        visible={help}
        title="Reading agent status"
        onClose={() => setHelp(false)}
      >
        {[
          ['working', 'The agent is processing work.'],
          [
            'blocked',
            'An approval or question needs your input. Open the terminal and read it before responding.',
          ],
          ['done', 'Herdr detected completed work.'],
          ['idle', 'The agent appears ready for input.'],
          ['unknown', 'Herdr cannot confidently classify this terminal.'],
        ].map(([status, description]) => (
          <View key={status} style={{ gap: 8 }}>
            <Status status={status} />
            <Text style={s.muted}>{description}</Text>
          </View>
        ))}
        <Text style={s.muted}>
          Status comes from Herdr’s detection. Read the current terminal to
          understand the agent’s actual state.
        </Text>
      </Sheet>
    </Screen>
  );
}
