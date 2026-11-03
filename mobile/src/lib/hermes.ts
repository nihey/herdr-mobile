import { cleanTitle } from './sessions';
import { statusMark } from './status';
import type { Agent, Hermes, HermesChip } from './types';

/** Where "report this reply" opens an email draft (nothing is sent by itself). */
export const REPORT_ADDRESS = 'nihey.takizawa@gmail.com';
const VERBS: Record<HermesChip['kind'], string> = {
  READ: 'read',
  SENT: 'sent to',
  STARTED: 'started',
};
const SUMMARY_CHARS = 80;
const REPORT_CHARS = 2000;

/** "sent to ◐ Payments migration"; an agent no longer open shows as closed. */
export function chipLabel(chip: HermesChip, agent: Agent | undefined) {
  const verb = `${chip.uncertain ? 'may have ' : ''}${VERBS[chip.kind]}`;
  if (!agent) return `${verb} (closed) ${chip.title ?? chip.paneId}`;
  const title =
    chip.title ?? (cleanTitle(agent.title) || agent.name || chip.paneId);
  return `${verb} ${statusMark(agent.status).glyph} ${title}`;
}

/** The home row's second line. */
export function summaryLine(
  hermes: Pick<Hermes, 'status' | 'reason' | 'working' | 'messages'>,
) {
  if (hermes.status === 'UNAVAILABLE')
    return hermes.reason ?? 'hermes is unavailable';
  if (hermes.working) return 'working…';
  if (hermes.status === 'STARTING') return 'starting…';
  const newest = [...hermes.messages].reverse().find((m) => m.text.trim());
  if (!newest) return 'ask about your agents';
  const line = newest.text.trim().split('\n')[0]?.trim() ?? '';
  return line.length > SUMMARY_CHARS
    ? `${line.slice(0, SUMMARY_CHARS - 1).trimEnd()}…`
    : line;
}

/** A mailto: draft reporting a Hermes reply; the user edits or discards it. */
export function reportUrl(text: string, address: string) {
  const body = `Hermes reply:\n\n${text.slice(0, REPORT_CHARS)}\n\nWhat was wrong:\n`;
  return `mailto:${address}?subject=${encodeURIComponent(
    'Herd Remote: report a Hermes reply',
  )}&body=${encodeURIComponent(body)}`;
}
