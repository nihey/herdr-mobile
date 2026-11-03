import { describe, expect, it } from 'vitest';
import { statusMark } from './status';

describe('statusMark', () => {
  it.each([
    ['blocked', '●', 'red', 'needs input'],
    ['working', '◐', 'amber', 'working'],
    ['done', '✓', 'green', 'done'],
    ['idle', '○', 'dim', 'idle'],
    ['unknown', '·', 'dim', 'unknown'],
  ])('marks %s like Herdr', (status, glyph, tone, label) => {
    expect(statusMark(status)).toEqual({ glyph, tone, label });
  });
});
