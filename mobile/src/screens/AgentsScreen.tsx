import React, { useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import {
  ArrowUpRight,
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
  const { data, error, loading, refresh } = useSnapshot();
  const [search, setSearch] = useState('');
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [forgetError, setForgetError] = useState('');
  const [startPane, setStartPane] = useState<Pane | null>(null);
  const matches = (workspaceId: string, content: string) =>
    (!workspace || workspace === workspaceId) &&
    content.toLowerCase().includes(search.toLowerCase());
  const agents =
    data?.agents.filter((agent) =>
      matches(
        agent.workspaceId,
        [agent.name, agent.kind, agent.cwd, agent.title].join(' '),
      ),
    ) ?? [];
  const panes =
    data?.panes.filter(
      (pane) =>
        !data.agents.some((a) => a.paneId === pane.id) &&
        matches(pane.workspaceId, [pane.label, pane.cwd, pane.title].join(' ')),
    ) ?? [];
  const connected = !!data && !error;
  const workspaceLabel = (id: string) =>
    data?.workspaces.find((item) => item.id === id)?.label ?? id;
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[s.page, { paddingTop: 18 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={c.accent}
            colors={[c.accent]}
          />
        }
      >
        <View style={s.between}>
          <View style={s.row}>
            <GitFork size={25} color={c.accent} />
            <Text style={[s.heading, { fontSize: 25, letterSpacing: -1 }]}>
              herdr
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
                paddingVertical: 17,
              },
            ]}
          >
            {[
              { label: 'TOTAL', count: data.agents.length, color: c.text },
              {
                label: 'WORKING',
                count: data.agents.filter((a) => a.status === 'working').length,
                color: c.accent,
              },
              {
                label: 'NEED INPUT',
                count: data.agents.filter((a) => a.status === 'blocked').length,
                color: c.amber,
              },
            ].map((item, i) => (
              <View
                key={item.label}
                style={{
                  flex: 1,
                  paddingLeft: i ? 18 : 0,
                  borderLeftWidth: i ? 1 : 0,
                  borderColor: c.line,
                  gap: 4,
                }}
              >
                <Text
                  style={{ fontSize: 28, color: item.color, fontWeight: '500' }}
                >
                  {String(item.count).padStart(2, '0')}
                </Text>
                <Text style={[s.eyebrow, { fontSize: 9, letterSpacing: 1 }]}>
                  {item.label}
                </Text>
              </View>
            ))}
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
            {agents.map((agent) => (
              <Pressable
                key={agent.paneId}
                accessibilityRole="button"
                accessibilityLabel={`Open ${agent.name ?? agent.kind ?? 'agent'}, ${agent.status}`}
                onPress={() =>
                  router.push({
                    pathname: '/agent/[paneId]',
                    params: {
                      paneId: agent.paneId,
                      machineId: activeMachine?.id,
                    },
                  })
                }
                style={({ pressed }) => [
                  s.card,
                  {
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
                        width: 35,
                        height: 35,
                        backgroundColor: c.elevated,
                        borderRadius: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <KindIcon kind={agent.kind} size={17} color={c.accent} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        numberOfLines={1}
                        style={[s.heading, { fontSize: 17 }]}
                      >
                        {agent.name ?? agent.title ?? agent.kind ?? 'Agent'}
                      </Text>
                      <Text style={[s.muted, { fontSize: 11 }]}>
                        {agent.kind ?? 'Agent'} ·{' '}
                        {workspaceLabel(agent.workspaceId)}
                      </Text>
                    </View>
                  </View>
                  <Status status={agent.status} />
                </View>
                <Text
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={[s.muted, { fontFamily: mono, fontSize: 11 }]}
                >
                  {agent.cwd ?? agent.paneId}
                </Text>
                <View
                  style={[
                    s.between,
                    { borderTopWidth: 1, borderColor: c.line, paddingTop: 11 },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[s.muted, { fontSize: 11, flex: 1 }]}
                  >
                    {agent.status === 'blocked'
                      ? 'Waiting for your response'
                      : agent.status === 'working'
                        ? 'At work on your computer'
                        : agent.status === 'done'
                          ? 'Ready for your next step'
                          : 'Open terminal to pick up the thread'}
                  </Text>
                  <ArrowUpRight size={16} color={c.muted} />
                </View>
              </Pressable>
            ))}
            {!agents.length && (
              <View style={s.card}>
                <Text style={s.heading}>
                  {search || workspace
                    ? 'No matching agents'
                    : 'Room for your next idea.'}
                </Text>
                <Text style={s.muted}>
                  {search || workspace
                    ? 'Try another search or workspace.'
                    : 'Your running Herdr agents appear here. Start one in an available terminal below.'}
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
                      onPress={() =>
                        router.push({
                          pathname: '/agent/[paneId]',
                          params: {
                            paneId: pane.id,
                            raw: '1',
                            machineId: activeMachine?.id,
                          },
                        })
                      }
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
