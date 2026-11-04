import { describe, expect, it } from 'vitest';
import {
  agentLink,
  clock,
  group,
  layoutFor,
  snapshotOf,
  type WidgetAgent,
} from './widget';

const agent = (
  paneId: string,
  status: string,
  name: string | null = null,
  title: string | null = null,
): WidgetAgent => ({
  paneId,
  workspaceId: 'w1',
  name,
  kind: 'claude',
  title,
  status,
});

describe('widget snapshot', () => {
  it('counts done and unknown statuses as idle', () => {
    expect(['blocked', 'working', 'idle', 'done', 'odd'].map(group)).toEqual([
      'input',
      'working',
      'idle',
      'idle',
      'idle',
    ]);
  });
  it('lists agents needing input, then working, then idle, in Herdr order', () => {
    const snapshot = snapshotOf(
      {
        workspaces: [{ id: 'w1', label: 'shop' }],
        agents: [
          agent('p1', 'idle'),
          agent('p2', 'working'),
          agent('p3', 'blocked'),
          agent('p4', 'done'),
          agent('p5', 'blocked'),
          agent('p6', 'working'),
        ],
      },
      1000,
    );
    expect(snapshot.rows.map((row) => row.paneId)).toEqual([
      'p3',
      'p5',
      'p2',
      'p6',
      'p1',
      'p4',
    ]);
    expect(snapshot.counts).toEqual({ input: 2, working: 2, idle: 2 });
    expect(snapshot.rows.at(-1)?.mark.glyph).toBe('✓');
    expect(snapshot.at).toBe(1000);
  });
  it('names a row by agent, then project, and details it by task', () => {
    const [named, unnamed] = snapshotOf(
      {
        workspaces: [{ id: 'w1', label: 'shop' }],
        agents: [
          agent('p1', 'idle', 'claude-2', '✳ Fix the cart'),
          agent('p2', 'idle'),
        ],
      },
      0,
    ).rows;
    expect(named).toMatchObject({
      heading: 'claude-2',
      detail: 'Fix the cart',
    });
    expect(unnamed).toMatchObject({ heading: 'shop', detail: 'claude' });
  });
});

describe('widget links and time', () => {
  it('encodes opaque IDs into the agent route', () => {
    expect(agentLink('m-1', 'w1:p 2/x')).toBe(
      'herdr-mobile://agent/w1%3Ap%202%2Fx?machineId=m-1',
    );
  });
  it('shows a 24-hour clock', () => {
    expect(clock(new Date(2026, 10, 4, 9, 5).getTime())).toBe('09:05');
    expect(clock(new Date(2026, 10, 4, 21, 40).getTime())).toBe('21:40');
  });
});

describe('widget layout', () => {
  it('shows only the header line in a widget one cell tall', () => {
    expect(layoutFor(320, 70, 4)).toMatchObject({ mode: 'line', shown: 0 });
  });
  it('fits rows to the height and keeps one for the rest', () => {
    // 180 - 20 padding - 74 header and counters = 86 → 4 rows of 20.
    expect(layoutFor(320, 180, 3)).toEqual({
      mode: 'list',
      labels: true,
      shown: 3,
      more: 0,
    });
    expect(layoutFor(320, 180, 4)).toMatchObject({ shown: 4, more: 0 });
    expect(layoutFor(320, 180, 9)).toMatchObject({ shown: 3, more: 6 });
  });
  it('drops rows before counters and labels on narrow widgets', () => {
    expect(layoutFor(150, 100, 2)).toEqual({
      mode: 'counters',
      labels: false,
      shown: 0,
      more: 0,
    });
  });
  it('makes room for larger text', () => {
    expect(layoutFor(320, 180, 9, 1.3).shown).toBeLessThan(
      layoutFor(320, 180, 9).shown,
    );
    expect(layoutFor(320, 90, 0, 1.3).mode).toBe('line');
  });
});
