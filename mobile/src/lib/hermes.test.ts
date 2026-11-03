import { describe, expect, it } from 'vitest';
import { chipLabel, reportUrl, REPORT_ADDRESS, summaryLine } from './hermes';
import type { Agent, Hermes, HermesMessage } from './types';

const agent = (status: string): Agent => ({
  paneId: 'w1:p1',
  workspaceId: 'w1',
  tabId: 'w1:t1',
  name: null,
  kind: 'claude',
  title: '✳ Payments migration',
  cwd: '/work/api',
  status,
  interactiveReady: true,
});
const message = (
  text: string,
  role: HermesMessage['role'] = 'HERMES',
): HermesMessage => ({
  id: text,
  role,
  text,
  stopped: false,
  at: '2026-11-03T12:00:00.000Z',
  chips: [],
});
const hermes = (over: Partial<Hermes> = {}): Hermes => ({
  status: 'READY',
  reason: null,
  model: 'gpt-6.1-sol',
  modelNote: null,
  working: false,
  messages: [],
  ...over,
});

describe('Hermes chat helpers', () => {
  it("labels a send with the agent's status mark", () => {
    expect(
      chipLabel(
        { kind: 'SENT', paneId: 'w1:p1', title: 'Payments migration' },
        agent('working'),
      ),
    ).toBe('sent to ◐ Payments migration');
    expect(
      chipLabel({ kind: 'READ', paneId: 'w1:p1', title: null }, agent('done')),
    ).toBe('read ✓ Payments migration');
  });

  it('labels a closed agent', () => {
    expect(
      chipLabel(
        { kind: 'READ', paneId: 'w1:p1', title: 'Payments migration' },
        undefined,
      ),
    ).toBe('read (closed) Payments migration');
  });

  it('summarizes a working Hermes', () => {
    expect(
      summaryLine(hermes({ working: true, messages: [message('x')] })),
    ).toBe('working…');
  });

  it('summarizes with the newest line', () => {
    const long = `${'word '.repeat(30)}\nsecond line`;
    const line = summaryLine(
      hermes({ messages: [message('older'), message(long)] }),
    );
    expect(line.endsWith('…')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(80);
    expect(line).not.toContain('second line');
    expect(summaryLine(hermes())).toBe('ask about your agents');
    expect(
      summaryLine(
        hermes({ status: 'UNAVAILABLE', reason: "Hermes isn't installed." }),
      ),
    ).toBe("Hermes isn't installed.");
  });

  it('builds a report email', () => {
    const reply = 'z'.repeat(5000);
    const url = reportUrl(reply, REPORT_ADDRESS);
    expect(url.startsWith(`mailto:${REPORT_ADDRESS}?`)).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('subject')).toBe('Herd Remote: report a Hermes reply');
    const body = params.get('body') ?? '';
    expect(body).toContain('z'.repeat(2000));
    expect(body).not.toContain('z'.repeat(2001));
  });
});
