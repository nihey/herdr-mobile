import { describe, expect, it } from 'vitest';
import { newLineCount } from './terminal';
const lines = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`).join(
    '\n',
  );
describe('new terminal line count', () => {
  it('is zero when nothing changed', () => {
    expect(newLineCount(lines(1, 5), lines(1, 5))).toBe(0);
  });
  it('counts lines appended below the seen output', () => {
    expect(newLineCount('a\nb\nc', 'a\nb\nc\nd\ne')).toBe(2);
  });
  it('follows a rolling window that dropped lines from the top', () => {
    expect(newLineCount(lines(1, 10), lines(4, 15))).toBe(5);
  });
  it('steps past bottom lines that a TUI redraws', () => {
    expect(
      newLineCount(
        'l1\nl2\nl3\nl4\n⠋ Working',
        'l1\nl2\nl3\nl4\nl5\nl6\n⠙ Working',
      ),
    ).toBe(2);
  });
  it('ignores trailing blank lines', () => {
    expect(newLineCount('a\nb\nc\n\n', 'a\nb\nc\nd\n\n\n')).toBe(1);
  });
  it('anchors across blank lines', () => {
    expect(newLineCount('x\ny\n\nz', 'x\ny\n\nz\nw')).toBe(1);
  });
  it('counts everything when nothing was seen yet', () => {
    expect(newLineCount('', 'a\nb\n')).toBe(2);
  });
  it('is unknown when the outputs no longer overlap', () => {
    expect(newLineCount(lines(1, 10), lines(400, 420))).toBeNull();
  });
  it('never reports a negative count', () => {
    expect(newLineCount('a\nb\nc\nd', 'a\nb')).toBe(0);
  });
});
