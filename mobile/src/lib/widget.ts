import { cleanTitle } from './sessions';
import { statusMark, type StatusMark } from './status';

/** The widget provider's name in app.json (`react-native-android-widget`). */
export const WIDGET_NAME = 'AgentStatus';

export type WidgetAgent = {
  paneId: string;
  workspaceId: string;
  name: string | null;
  kind: string | null;
  title: string | null;
  status: string;
};
export type WidgetSession = {
  workspaces: { id: string; label: string }[];
  agents: WidgetAgent[];
};
export type Group = 'input' | 'working' | 'idle';
export type Row = {
  paneId: string;
  heading: string;
  detail: string;
  mark: StatusMark;
};
export type Snapshot = {
  /** When the bridge answered, in ms since the epoch. */
  at: number;
  counts: Record<Group, number>;
  /** Needing input first, then working, then idle; Herdr's order within. */
  rows: Row[];
};
export type WidgetMachine = { id: string; name: string };
export type WidgetState =
  | { kind: 'unpaired' }
  | { kind: 'unreadable' }
  | {
      kind: 'machine';
      machine: WidgetMachine;
      /** The last snapshot read from this machine, if any. */
      snapshot: Snapshot | null;
      /** Why the latest read failed; null when it succeeded. */
      problem: 'offline' | 'rejected' | null;
      refreshing: boolean;
    };

/** Herdr's `done` and unknown statuses count as idle. */
export function group(status: string): Group {
  return status === 'blocked'
    ? 'input'
    : status === 'working'
      ? 'working'
      : 'idle';
}

const ORDER: Group[] = ['input', 'working', 'idle'];

export function snapshotOf(session: WidgetSession, at: number): Snapshot {
  const label = (id: string) =>
    session.workspaces.find((w) => w.id === id)?.label ?? null;
  const counts: Record<Group, number> = { input: 0, working: 0, idle: 0 };
  for (const agent of session.agents) counts[group(agent.status)]++;
  const rows = ORDER.flatMap((which) =>
    session.agents
      .filter((agent) => group(agent.status) === which)
      .map((agent) => {
        const project = label(agent.workspaceId);
        return {
          paneId: agent.paneId,
          heading: agent.name ?? project ?? agent.kind ?? 'agent',
          detail:
            cleanTitle(agent.title) ||
            [agent.kind, agent.name ? project : null]
              .filter(Boolean)
              .join(' · '),
          mark: statusMark(agent.status),
        };
      }),
  );
  return { at, counts, rows };
}

/** Opens one agent; the route sends the user home if the machine changed. */
export function agentLink(machineId: string, paneId: string) {
  return `herdr-mobile://agent/${encodeURIComponent(paneId)}?machineId=${encodeURIComponent(machineId)}`;
}

/** 24-hour `HH:MM` in the phone's time zone. */
export function clock(at: number) {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Sizes in dp at a font scale of 1; text heights grow with the scale. */
export const SIZES = {
  padding: 10,
  header: 22,
  counters: 40,
  gap: 6,
  row: 20,
};
export type Layout = {
  /** `line`: header with inline counts only; `counters`: no rows. */
  mode: 'line' | 'counters' | 'list';
  /** Counter tiles show their labels (`input`, `working`, `idle`). */
  labels: boolean;
  /** Agent rows to draw. */
  shown: number;
  /** Agents left out, drawn as a `+N more` row. */
  more: number;
};

export function layoutFor(
  width: number,
  height: number,
  agents: number,
  fontScale = 1,
): Layout {
  const scale = Math.max(1, fontScale);
  const { padding, header, counters, gap, row } = SIZES;
  const labels = width >= 200;
  if (height < 2 * padding + (header + gap + counters) * scale)
    return { mode: 'line', labels, shown: 0, more: 0 };
  const space = height - 2 * padding - (header + gap + counters + gap) * scale;
  const fit = Math.max(0, Math.floor(space / (row * scale)));
  if (!fit) return { mode: 'counters', labels, shown: 0, more: 0 };
  const shown = agents > fit ? fit - 1 : agents;
  return { mode: 'list', labels, shown, more: agents - shown };
}
