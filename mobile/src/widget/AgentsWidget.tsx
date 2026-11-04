// Widget trees are built by calling these functions directly: no hooks, no
// fragments, and no React Compiler memoization.
'use no memo';
import {
  FlexWidget,
  TextWidget,
  type ColorProp,
} from 'react-native-android-widget';
import { c, tint, toneColor } from '@/components/ui';
import {
  agentLink,
  clock,
  layoutFor,
  SIZES,
  type Group,
  type Row,
  type Snapshot,
  type WidgetState,
} from '@/lib/widget';

// The widget library loads fonts by file name from assets/fonts (app.json).
const REGULAR = 'NotoSansMono-Regular';
const BOLD = 'NotoSansMono-Bold';
const color = (value: string) => value as ColorProp;
const GROUPS: { group: Group; glyph: string; label: string; tone: string }[] = [
  { group: 'input', glyph: '●', label: 'input', tone: c.red },
  { group: 'working', glyph: '◐', label: 'working', tone: c.amber },
  { group: 'idle', glyph: '○', label: 'idle', tone: c.dim },
];

type Props = {
  state: WidgetState;
  width: number;
  height: number;
  fontScale?: number;
};

export function AgentsWidget({ state, width, height, fontScale = 1 }: Props) {
  const snapshot = state.kind === 'machine' ? state.snapshot : null;
  const layout = layoutFor(
    width,
    height,
    snapshot?.rows.length ?? 0,
    fontScale,
  );
  const stale = state.kind === 'machine' && !!state.problem;
  // Text is sized in sp, so boxes grow with the user's font size.
  const scale = Math.max(1, fontScale);
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: color(c.bg),
        borderRadius: 16,
        borderWidth: 1,
        borderColor: color(c.line),
        padding: SIZES.padding,
      }}
    >
      <Header
        state={state}
        counts={layout.mode === 'line' ? snapshot : null}
        scale={scale}
      />
      {layout.mode !== 'line' &&
        (state.kind !== 'machine' || !snapshot ? (
          <Message state={state} />
        ) : (
          <Counters
            snapshot={snapshot}
            labels={layout.labels}
            stale={stale}
            scale={scale}
          />
        ))}
      {/* The widget library has no fragments: siblings only. */}
      {layout.mode === 'list' && state.kind === 'machine' && snapshot && (
        <FlexWidget
          style={{
            width: 'match_parent',
            flexDirection: 'column',
            marginTop: SIZES.gap,
          }}
        >
          {snapshot.rows.slice(0, layout.shown).map((row) => (
            <AgentRow
              key={row.paneId}
              row={row}
              machineId={state.machine.id}
              stale={stale}
              height={SIZES.row * scale}
            />
          ))}
          {!!layout.more && (
            <TextWidget
              text={`+${layout.more} more`}
              clickAction="OPEN_APP"
              accessibilityLabel={`Open Herd Remote, ${layout.more} more agents`}
              style={{
                fontFamily: REGULAR,
                fontSize: 11,
                color: color(c.dim),
                paddingLeft: 20,
                paddingVertical: 3,
              }}
            />
          )}
          {!snapshot.rows.length && (
            <TextWidget
              text="no agents running"
              clickAction="OPEN_APP"
              style={{
                fontFamily: REGULAR,
                fontSize: 12,
                color: color(c.dim),
                paddingVertical: 3,
              }}
            />
          )}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

function Header({
  state,
  counts,
  scale,
}: {
  state: WidgetState;
  /** Inline counts, for a widget one cell tall. */
  counts: Snapshot | null;
  scale: number;
}) {
  const machine = state.kind === 'machine' ? state : null;
  const status = !machine
    ? ''
    : machine.problem === 'rejected'
      ? 'token rejected'
      : machine.problem
        ? machine.snapshot
          ? `offline · last ${clock(machine.snapshot.at)}`
          : 'offline'
        : machine.snapshot
          ? clock(machine.snapshot.at)
          : '';
  // Not while redrawing an older snapshot: it may be minutes old.
  const connected =
    !!machine && !machine.problem && !machine.refreshing && !!machine.snapshot;
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: SIZES.header * scale,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <FlexWidget
        clickAction="OPEN_APP"
        accessibilityLabel="Open Herd Remote"
        style={{
          flex: 1,
          height: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <TextWidget
          text={connected ? '●' : '○'}
          style={{
            fontFamily: REGULAR,
            fontSize: 10,
            color: color(
              connected ? c.green : machine?.problem ? c.amber : c.dim,
            ),
            marginRight: 6,
          }}
        />
        <TextWidget
          text={machine ? machine.machine.name : 'herd remote'}
          maxLines={1}
          truncate="END"
          style={{ fontFamily: BOLD, fontSize: 12, color: color(c.text) }}
        />
        {!!status && (
          <TextWidget
            text={` · ${status}`}
            maxLines={1}
            truncate="END"
            style={{
              fontFamily: REGULAR,
              fontSize: 11,
              color: color(machine?.problem ? c.amber : c.dim),
            }}
          />
        )}
        {counts && <InlineCounts snapshot={counts} />}
      </FlexWidget>
      {!!machine && (
        <TextWidget
          text={machine.refreshing ? '…' : '↻'}
          clickAction="REFRESH"
          accessibilityLabel="Refresh agents"
          style={{
            width: 36,
            height: 'match_parent',
            textAlign: 'right',
            fontFamily: BOLD,
            fontSize: 15,
            color: color(c.accent),
          }}
        />
      )}
    </FlexWidget>
  );
}

function InlineCounts({ snapshot }: { snapshot: Snapshot }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', marginLeft: 8 }}>
      {GROUPS.map(({ group, glyph, tone }) => (
        <TextWidget
          key={group}
          text={`${glyph} ${snapshot.counts[group]}`}
          style={{
            fontFamily: BOLD,
            fontSize: 12,
            color: color(tone),
            marginLeft: 6,
          }}
        />
      ))}
    </FlexWidget>
  );
}

function Counters({
  snapshot,
  labels,
  stale,
  scale,
}: {
  snapshot: Snapshot;
  labels: boolean;
  stale: boolean;
  scale: number;
}) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={`Open Herd Remote: ${snapshot.counts.input} need input, ${snapshot.counts.working} working, ${snapshot.counts.idle} idle`}
      style={{
        width: 'match_parent',
        height: SIZES.counters * scale,
        flexDirection: 'row',
        flexGap: SIZES.gap,
        marginTop: SIZES.gap,
      }}
    >
      {GROUPS.map(({ group, glyph, label, tone }) => (
        <FlexWidget
          key={group}
          style={{
            flex: 1,
            height: 'match_parent',
            flexDirection: 'column',
            justifyContent: 'center',
            backgroundColor: color(c.panel),
            borderRadius: 4,
            paddingHorizontal: 8,
          }}
        >
          <TextWidget
            text={labels ? `${glyph} ${label}` : glyph}
            maxLines={1}
            style={{
              fontFamily: REGULAR,
              fontSize: 10,
              color: color(stale ? c.dim : tone),
            }}
          />
          <TextWidget
            text={String(snapshot.counts[group])}
            style={{
              fontFamily: BOLD,
              fontSize: 16,
              color: color(stale ? c.muted : c.text),
            }}
          />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

function AgentRow({
  row,
  machineId,
  stale,
  height,
}: {
  row: Row;
  machineId: string;
  stale: boolean;
  height: number;
}) {
  const attention = row.mark.tone === 'red' && !stale;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: agentLink(machineId, row.paneId) }}
      accessibilityLabel={`Open ${row.heading}, ${row.mark.label}`}
      style={{
        width: 'match_parent',
        height,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 4,
        paddingHorizontal: 4,
        ...(attention ? { backgroundColor: color(tint(c.red, 0.1)) } : {}),
      }}
    >
      <TextWidget
        text={row.mark.glyph}
        style={{
          width: 16,
          fontFamily: REGULAR,
          fontSize: 12,
          color: color(stale ? c.dim : toneColor(row.mark.tone)),
        }}
      />
      <TextWidget
        text={row.heading}
        maxLines={1}
        truncate="END"
        style={{
          fontFamily: BOLD,
          fontSize: 12,
          color: color(stale ? c.muted : c.text),
        }}
      />
      {!!row.detail && (
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget
            text={`  ${row.detail}`}
            maxLines={1}
            truncate="END"
            style={{ fontFamily: REGULAR, fontSize: 11, color: color(c.dim) }}
          />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

function Message({ state }: { state: WidgetState }) {
  const [title, hint] =
    state.kind === 'unpaired'
      ? ['pair a computer', 'open herd remote to pair one']
      : state.kind === 'unreadable'
        ? ['open herd remote', 'saved machines could not be read']
        : state.problem === 'rejected'
          ? ['pairing token rejected', 'open herd remote to pair again']
          : state.problem
            ? [
                `can't reach ${state.machine.name}`,
                'check tailscale and the bridge · tap ↻',
              ]
            : [`checking ${state.machine.name}…`, ''];
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={`${title}. Open Herd Remote`}
      style={{
        width: 'match_parent',
        flex: 1,
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <TextWidget
        text={title}
        maxLines={1}
        truncate="END"
        style={{ fontFamily: BOLD, fontSize: 13, color: color(c.text) }}
      />
      {!!hint && (
        <TextWidget
          text={hint}
          maxLines={2}
          style={{
            fontFamily: REGULAR,
            fontSize: 11,
            color: color(c.dim),
            marginTop: 2,
          }}
        />
      )}
    </FlexWidget>
  );
}
