/** Herdr's agent status marks: ● needs input, ◐ working, ✓ done, ○ idle. */
export type StatusTone = 'red' | 'amber' | 'green' | 'dim';
export type StatusMark = {
  glyph: '●' | '◐' | '✓' | '○' | '·';
  tone: StatusTone;
  label: string;
};

export function statusMark(status: string): StatusMark {
  switch (status) {
    case 'blocked':
      return { glyph: '●', tone: 'red', label: 'needs input' };
    case 'working':
      return { glyph: '◐', tone: 'amber', label: 'working' };
    case 'done':
      return { glyph: '✓', tone: 'green', label: 'done' };
    case 'idle':
      return { glyph: '○', tone: 'dim', label: 'idle' };
    default:
      return { glyph: '·', tone: 'dim', label: status };
  }
}
