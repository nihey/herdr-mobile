const ANCHOR_LINES = 3;
const MAX_ANCHORS = 60;

function outputLines(text: string): string[] {
  const lines = text.split('\n').map((line) => line.trimEnd());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

function endsAt(lines: string[], end: number, anchor: string[]): boolean {
  if (end + 1 < anchor.length) return false;
  return anchor.every((line, i) => lines[end - anchor.length + 1 + i] === line);
}

/**
 * Counts lines in `latest` that arrived after the output in `seen`. The bridge
 * returns a rolling window and agent TUIs redraw their bottom lines, so this
 * anchors on a few lines of `seen`, stepping up from the end until one is found
 * in `latest`. Returns null when the outputs no longer overlap.
 */
export function newLineCount(seen: string, latest: string): number | null {
  if (seen === latest) return 0;
  const before = outputLines(seen);
  const after = outputLines(latest);
  if (!before.length) return after.length;
  const lowest = Math.max(0, before.length - MAX_ANCHORS);
  for (let end = before.length - 1; end >= lowest; end--) {
    if (!before[end]) continue;
    const anchor = before.slice(Math.max(0, end - ANCHOR_LINES + 1), end + 1);
    for (let match = after.length - 1; match >= 0; match--) {
      if (endsAt(after, match, anchor))
        return Math.max(
          after.length - 1 - match - (before.length - 1 - end),
          0,
        );
    }
  }
  return null;
}
