import { useState } from 'react';
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
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react-native';
import { useSession } from '@/lib/session-context';
import { useSnapshot } from '@/hooks/useSnapshot';
import type { Pane } from '@/lib/types';
import { errorMessage } from '@/lib/errors';
import { attentionOrder, cleanTitle, shortPath } from '@/lib/sessions';
import { statusMark } from '@/lib/status';
import {
  Button,
  c,
  Field,
  IconButton,
  Loading,
  mono,
  Notice,
  radius,
  s,
  Screen,
  Sheet,
  Status,
  tint,
  toneColor,
} from '@/components/ui';
import { StartAgentModal } from './StartAgentModal';
import { NewSessionSheet } from './NewSessionSheet';
import { HermesRow } from './HermesRow';

type StatusFilter = 'working' | 'blocked' | null;

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
        contentContainerStyle={[s.page, { paddingTop: 12, paddingBottom: 110 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={pull}
            tintColor={c.accent}
            colors={[c.accent]}
            progressBackgroundColor={c.panel}
          />
        }
      >
        <View style={s.between}>
          <View style={{ flex: 1, gap: 2 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Manage machines"
              onPress={() => router.push('/machines')}
              style={[s.row, { gap: 6, minHeight: 28 }]}
            >
              <Text
                style={{
                  color: connected ? c.green : c.amber,
                  fontFamily: mono,
                  fontSize: 11,
                }}
              >
                {connected ? '●' : '○'}
              </Text>
              <Text numberOfLines={1} style={[s.eyebrow, { flexShrink: 1 }]}>
                {activeMachine?.name ??
                  connection?.url.replace(/^https?:\/\//, '')}{' '}
                · {connected ? 'connected' : loading ? 'connecting' : 'offline'}
              </Text>
              <ChevronRight size={14} color={c.dim} />
            </Pressable>
            <Text style={s.title}>herd remote</Text>
          </View>
          <IconButton label="Refresh agents" onPress={refresh} size={40}>
            <RefreshCw size={17} color={c.accent} />
          </IconButton>
          <IconButton
            label="Connection settings"
            onPress={() => setSettings(true)}
            size={40}
          >
            <Settings2 size={18} color={c.muted} />
          </IconButton>
        </View>
        <HermesRow />
        {!!data && (
          <View style={[s.row, { gap: 8 }]}>
            {(
              [
                {
                  label: 'all',
                  filter: null,
                  count: data.agents.length,
                  color: c.text,
                },
                {
                  label: '◐ working',
                  filter: 'working',
                  count: data.agents.filter((a) => a.status === 'working')
                    .length,
                  color: c.amber,
                },
                {
                  label: '● input',
                  filter: 'blocked',
                  count: data.agents.filter((a) => a.status === 'blocked')
                    .length,
                  color: c.red,
                },
              ] as const
            ).map((item) => {
              const selected = statusFilter === item.filter;
              return (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  accessibilityLabel={
                    item.filter
                      ? `Show only ${item.filter === 'blocked' ? 'agents needing input' : 'working agents'}, ${item.count}`
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
                    backgroundColor: c.panel,
                    borderRadius: radius,
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderBottomWidth: 2,
                    borderBottomColor:
                      selected && data.agents.length ? c.accent : c.panel,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      s.eyebrow,
                      { color: item.filter ? item.color : c.dim },
                    ]}
                  >
                    {item.label}
                  </Text>
                  <Text
                    style={{
                      color: c.text,
                      fontFamily: mono,
                      fontSize: 20,
                      lineHeight: 26,
                      fontWeight: '700',
                    }}
                  >
                    {item.count}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {!!error && <Notice message={errorMessage(error)} danger />}
        <View style={{ position: 'relative' }}>
          <Field
            placeholder="find an agent or folder"
            value={search}
            onChangeText={setSearch}
            style={{ paddingLeft: 38 }}
          />
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 12, top: 15 }}
          >
            <Search size={16} color={c.dim} />
          </View>
        </View>
        {!!data && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6 }}
          >
            <Button
              title="all"
              accessibilityLabel="All workspaces"
              variant={workspace === null ? 'primary' : 'secondary'}
              onPress={() => setWorkspace(null)}
              style={chip}
            />
            {data.workspaces.map((item) => (
              <Button
                key={item.id}
                title={item.label}
                variant={workspace === item.id ? 'primary' : 'secondary'}
                onPress={() => setWorkspace(item.id)}
                style={chip}
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
            <View style={[s.between, { marginBottom: -8 }]}>
              <Text style={s.eyebrow}>agents · {agents.length}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="About agent status"
                onPress={() => setHelp(true)}
                style={[s.row, { minHeight: 40, gap: 5 }]}
              >
                <CircleHelp color={c.dim} size={13} />
                <Text style={s.eyebrow}>status guide</Text>
              </Pressable>
            </View>
            <View style={{ gap: 2 }}>
              {agents.map((agent) => {
                const project = workspaceLabel(agent.workspaceId);
                const heading = agent.name ?? project;
                const task = cleanTitle(agent.title);
                const mark = statusMark(agent.status);
                const meta = [
                  agent.kind ?? 'agent',
                  agent.name ? project : null,
                  shortPath(agent.cwd),
                ]
                  .filter(Boolean)
                  .join(' · ');
                const attention = agent.status === 'blocked';
                return (
                  <Pressable
                    key={agent.paneId}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${heading}, ${agent.kind ?? 'agent'}, ${mark.label}`}
                    onPress={() => openTerminal(agent.paneId)}
                    style={({ pressed }) => [
                      s.item,
                      attention && {
                        backgroundColor: tint(c.red, 0.08),
                        borderLeftColor: c.red,
                      },
                      pressed && s.selected,
                    ]}
                  >
                    <View style={[s.row, { gap: 8 }]}>
                      <Text
                        style={{
                          color: toneColor(mark.tone),
                          fontFamily: mono,
                          fontSize: 14,
                          width: 14,
                          textAlign: 'center',
                        }}
                      >
                        {mark.glyph}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[s.body, { fontWeight: '700', flex: 1 }]}
                      >
                        {heading}
                      </Text>
                    </View>
                    {!!task && (
                      <Text
                        numberOfLines={1}
                        style={[s.muted, { color: c.text, paddingLeft: 22 }]}
                      >
                        {task}
                      </Text>
                    )}
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="middle"
                      style={[
                        s.eyebrow,
                        { paddingLeft: 22, letterSpacing: 0, fontSize: 10.5 },
                      ]}
                    >
                      {meta}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!agents.length && (
              <View style={s.card}>
                <Text style={s.heading}>
                  {filtered ? 'no matching agents' : 'room for your next idea'}
                </Text>
                <Text style={s.muted}>
                  {filtered
                    ? 'Try another search, status or workspace.'
                    : 'Your running Herdr agents appear here. Tap new to start one in a project, or open a terminal.'}
                </Text>
              </View>
            )}
            {!!panes.length && (
              <>
                <Text style={[s.eyebrow, { marginBottom: -8 }]}>
                  terminals · {panes.length}
                </Text>
                <View style={{ gap: 2 }}>
                  {panes.map((pane) => (
                    <View key={pane.id} style={[s.item, { gap: 6 }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open terminal ${pane.label ?? pane.title ?? pane.id}`}
                        onPress={() => openTerminal(pane.id, true)}
                        style={({ pressed }) => [
                          { gap: 3, borderRadius: 2 },
                          pressed && { backgroundColor: c.select },
                        ]}
                      >
                        <View style={[s.row, { gap: 8 }]}>
                          <Text
                            style={{
                              color: c.accent,
                              fontFamily: mono,
                              fontSize: 14,
                              width: 14,
                              textAlign: 'center',
                            }}
                          >
                            $
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={[s.body, { fontWeight: '700', flex: 1 }]}
                          >
                            {pane.label ?? pane.title ?? 'terminal'}{' '}
                            <Text style={[s.eyebrow, { fontWeight: '400' }]}>
                              {pane.id}
                            </Text>
                          </Text>
                          <ChevronRight size={15} color={c.dim} />
                        </View>
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="middle"
                          style={[
                            s.eyebrow,
                            {
                              paddingLeft: 22,
                              letterSpacing: 0,
                              fontSize: 10.5,
                            },
                          ]}
                        >
                          {workspaceLabel(pane.workspaceId)} ·{' '}
                          {shortPath(pane.cwd) ?? 'shell'}
                        </Text>
                      </Pressable>
                      {!pane.kind && (
                        <Button
                          title="start an agent here"
                          accessibilityLabel="Start an agent here"
                          variant="secondary"
                          onPress={() => setStartPane(pane)}
                          icon={<Plus size={15} color={c.text} />}
                          style={{ ...chip, marginLeft: 22 }}
                        />
                      )}
                    </View>
                  ))}
                </View>
              </>
            )}
            <Text
              style={[
                s.eyebrow,
                { fontSize: 10, textAlign: 'center', paddingVertical: 10 },
              ]}
            >
              running on your machine. connected by you.
            </Text>
          </>
        )}
      </ScrollView>
      {/* Home terminals work even with no project open. */}
      {!!data && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            right: 16,
            // Absolute children ignore the safe-area padding; clear the nav bar.
            bottom: insets.bottom + 16,
          }}
        >
          <Button
            title="new"
            accessibilityLabel="Start a new session or terminal"
            icon={<Plus size={17} color={c.ink} />}
            onPress={() => setNewSession(true)}
            style={{ minHeight: 48, paddingHorizontal: 18, elevation: 4 }}
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
        title="your connection"
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
          title="manage machines"
          variant="secondary"
          onPress={() => {
            setSettings(false);
            router.push('/machines');
          }}
        />
        {!!forgetError && <Notice message={forgetError} danger />}
        <Button
          title="forget connection"
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
        title="reading agent status"
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
          <View key={status} style={{ gap: 6 }}>
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

const chip = {
  minHeight: 34,
  paddingVertical: 6,
  paddingHorizontal: 11,
};
