import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { Agent, Project } from './types';

const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const FALLBACK_KINDS = ['claude', 'codex'];

export function validAgentName(name: string) {
  return AGENT_NAME.test(name);
}

function byUse(agents: Agent[]) {
  const counts = new Map<string, number>();
  for (const { kind } of agents)
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  // Map keeps first-seen order, so ties stay in Herdr's order.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind]) => kind);
}

/**
 * Agent kinds for a new session in a workspace: those already used there, then
 * elsewhere in the session. `more` lists the remaining kinds Herdr supports.
 */
export function kindChoices(
  agents: Agent[],
  workspaceId: string,
  supported: string[],
) {
  const used = [
    ...byUse(agents.filter((a) => a.workspaceId === workspaceId)),
    ...byUse(agents),
  ];
  let primary = [...new Set(used)];
  if (!primary.length)
    primary = supported.length ? supported.slice(0, 3) : FALLBACK_KINDS;
  return {
    primary,
    more: supported.filter((kind) => !primary.includes(kind)),
  };
}

/** `<kind>-<n>` with the lowest free n, bounded to Herdr's 32 characters. */
export function suggestName(kind: string, taken: (string | null)[]) {
  const names = new Set(taken);
  for (let n = 1; ; n++) {
    const suffix = `-${n}`;
    const name = kind.slice(0, 32 - suffix.length) + suffix;
    if (!names.has(name)) return name;
  }
}

/** Agents waiting for input first; everything else keeps Herdr's order. */
export function attentionOrder(agents: Agent[]) {
  return [
    ...agents.filter((a) => a.status === 'blocked'),
    ...agents.filter((a) => a.status !== 'blocked'),
  ];
}

/** `/home/<user>/x` or `/Users/<user>/x` as `~/x`, for narrow screens. */
export function shortPath(path: string | null | undefined) {
  return (path ?? '').replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, '~');
}

/** Terminal title without leading status glyphs such as ✳ or spinners. */
export function cleanTitle(title: string | null | undefined) {
  return (title ?? '').replace(/^[\p{So}\s·•]+/u, '').trim();
}

/** The bridge's home workspace label (terminals started in the home folder). */
export const HOME_LABEL = 'phone';
/** Sheet-only choice for the home folder; sent to the bridge as null. */
export const HOME = '~home';

/** Open projects to offer; the home workspace is the Home folder entry. */
export function listedProjects(projects: Project[]) {
  return projects.filter((project) => project.label !== HOME_LABEL);
}

/** Errors from a bridge that predates a queried field or argument. */
export function isOutdated(reason: unknown) {
  return (
    CombinedGraphQLErrors.is(reason) &&
    reason.errors.some((e) =>
      /^(Cannot query field|Unknown (argument|type))/.test(e.message),
    )
  );
}

/** Whether the bridge can open terminals and home sessions (0.5.0+). */
export function terminalsSupported(reason: unknown) {
  return !isOutdated(reason);
}
