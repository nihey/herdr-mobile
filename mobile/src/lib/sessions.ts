import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { Agent, Folder, Project } from './types';

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
/** Sheet-only choice for a browsed folder; its path goes to the bridge. */
export const FOLDER = '~folder';

/** Open projects to offer; the home workspace is the Home folder entry. */
export function listedProjects(projects: Project[]) {
  return projects.filter((project) => project.label !== HOME_LABEL);
}

/** A folder's last part (`/` for the root), as Herdr names its workspace. */
export function folderName(path: string) {
  return path.replace(/\/+$/, '').split('/').pop() || '/';
}

/**
 * A path with the bridge's own home folder as `~` (unlike `shortPath`, never
 * another user's home); unchanged when the home folder is unknown.
 */
export function homePath(path: string, home: string | null) {
  if (!home) return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Text typed in the folder browser that is a path to go to (`~…` or `/…`). */
export function typedPath(text: string) {
  const path = text.trim();
  return /^[~/]/.test(path) ? path : null;
}

/**
 * Folders to show for the browser's search text: names containing it,
 * ignoring case. Hidden folders (a leading dot) only once the text starts
 * with a dot; `hidden` counts those left out. A typed path filters nothing.
 */
export function browsable(folders: Folder[], text: string) {
  const query = typedPath(text) === null ? text.trim().toLowerCase() : '';
  const matching = folders.filter((f) => f.name.toLowerCase().includes(query));
  const shown = query.startsWith('.')
    ? matching
    : matching.filter((f) => !f.name.startsWith('.'));
  return { shown, hidden: matching.length - shown.length };
}

/** The open project whose folder this is, if any. */
export function projectAt(projects: Project[], path: string) {
  return projects.find((project) => project.cwd === path) ?? null;
}

export const OUTDATED_BRIDGE =
  'This bridge is too old for this. On your computer, rebuild and restart the Herd Remote bridge, then try again.';

/** Validation errors from a bridge that predates a field or argument. */
const OUTDATED =
  /^(Cannot query field|Unknown (argument|type))|argument "[^"]+" of type "[^"]+" is required|^Variable "\$[^"]+" of type "[^"]+" used in position expecting/;
export function isOutdated(reason: unknown) {
  return (
    CombinedGraphQLErrors.is(reason) &&
    reason.errors.some((e) => OUTDATED.test(e.message))
  );
}

/** Whether the bridge can open terminals and home sessions (0.5.0+). */
export function terminalsSupported(reason: unknown) {
  return !isOutdated(reason);
}
