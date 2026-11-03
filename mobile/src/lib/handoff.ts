/**
 * Hands a draft to the next terminal screen in memory, keyed by
 * `<machineId>/<paneId>`. Prompt text never goes into route parameters.
 */
import type { ComposerMode } from './terminal';

/** `mode` overrides the terminal screen's first composer mode. */
export type Handoff = { draft: string; notice: string; mode?: ComposerMode };

const pending = new Map<string, Handoff>();

export function handOff(key: string, value: Handoff) {
  pending.set(key, value);
}

export function peekHandoff(key: string) {
  return pending.get(key);
}

export function clearHandoff(key: string) {
  pending.delete(key);
}
