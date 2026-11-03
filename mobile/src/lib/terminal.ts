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

/**
 * Composer modes. Agents take a Prompt (text + Enter through Herdr) or raw
 * Type; plain shells take Run (text, then Enter) or Type (no Enter).
 */
export type ComposerMode = 'prompt' | 'run' | 'type';

/** The mode to show once Herdr does (or no longer does) see an agent. */
export function effectiveMode(
  mode: ComposerMode,
  hasAgent: boolean,
): ComposerMode {
  if (mode === 'type') return mode;
  return hasAgent ? 'prompt' : 'run';
}

/** The other mode for the chip: Run/Type in shells, Prompt/Type for agents. */
export function nextMode(mode: ComposerMode, hasAgent: boolean): ComposerMode {
  if (effectiveMode(mode, hasAgent) !== 'type') return 'type';
  return hasAgent ? 'prompt' : 'run';
}

/** Run is text then Enter; never resent, so say what may have happened. */
export function runFailureNotice(typed: boolean): string {
  return typed
    ? 'Your command was typed but not run: Enter may not have reached the terminal. Check it, then tap enter on the key row to run it.'
    : 'Your command may not have reached the terminal. Check it before sending it again.';
}
