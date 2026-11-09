import { opendir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { GraphQLError } from 'graphql';

/**
 * Folders on this computer, for starting a session or terminal in any of
 * them. Read-only and by name only: the bridge never reads files or their
 * contents, and every read is bounded in entries and time.
 */
export type Folder = { name: string; path: string };
export type FolderListing = {
  path: string;
  parent: string | null;
  folders: Folder[];
  truncated: boolean;
};

/** Folders listed per level; the app asks the user to type to narrow. */
export const FOLDER_LIMIT = 500;
/** Entries read from one folder before the rest are left out. */
const MAX_ENTRIES = 10000;
/** A slow or hung drive (a network mount) must not hold the request. */
export const FOLDER_TIMEOUT_MS = 5000;
const MAX_PATH_BYTES = 4096;
const badInput = (message: string): never => {
  throw new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
};

const tooSlow = () =>
  new GraphQLError(
    'That folder took too long to read. Check the drive on your computer, or choose another folder.',
    { extensions: { code: 'folder_timeout' } },
  );
const stuck = () =>
  new GraphQLError(
    'The bridge is still waiting for a folder that stopped answering, such as a disconnected drive. Restart the bridge on your computer to browse folders again.',
    { extensions: { code: 'folder_timeout' } },
  );

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error = tooSlow,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Set once a read has run out of time; the read stops at its next step. */
export type Signal = { stopped: boolean };

/**
 * Folder reads, one at a time, each within `ms` including its wait. Giving up
 * on a promise does not stop the file-system call behind it: on a hung mount
 * it holds one of Node's few file-system threads for good. So a read that
 * never finishes holds the queue, and the reads behind it time out without
 * starting instead of taking more threads.
 */
export function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: (signal: Signal) => Promise<T>, ms: number): Promise<T> => {
    const signal: Signal = { stopped: false };
    let started = false;
    const job = tail.then(() => {
      if (signal.stopped) throw tooSlow();
      started = true;
      return work(signal);
    });
    tail = job.catch(() => undefined);
    return withTimeout(job, ms, () => {
      signal.stopped = true;
      return started ? tooSlow() : stuck();
    });
  };
}
const queue = createQueue();

/** `~` and `~/…` are the bridge user's home; anything else must be absolute. */
function expand(input: string, homeDir: string) {
  if (
    !input ||
    Buffer.byteLength(input) > MAX_PATH_BYTES ||
    Array.from(input).some((ch) => ch.charCodeAt(0) < 32 || ch === '\u007f')
  )
    badInput('Enter a valid folder path, shorter than 4 KiB.');
  const path =
    input === '~'
      ? homeDir
      : input.startsWith('~/')
        ? join(homeDir, input.slice(2))
        : input;
  if (!isAbsolute(path))
    badInput('Enter a full path, such as ~/devel or /srv.');
  return resolve(path);
}

function fsFailure(error: unknown): never {
  if (error instanceof GraphQLError) throw error;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT')
    badInput('That folder does not exist on this computer.');
  if (code === 'ENOTDIR') badInput('That is not a folder.');
  if (code === 'EACCES' || code === 'EPERM')
    badInput('This computer does not let the bridge open that folder.');
  throw new GraphQLError('The bridge could not read that folder.', {
    extensions: { code: 'BRIDGE_ERROR' },
  });
}

async function realFolder(path: string) {
  const real = await realpath(path);
  if (!(await stat(real)).isDirectory()) badInput('That is not a folder.');
  return real;
}

const hidden = (name: string) => name.startsWith('.');
function byName(a: string, b: string) {
  return (
    Number(hidden(a)) - Number(hidden(b)) ||
    a.localeCompare(b, undefined, { sensitivity: 'base' }) ||
    (a < b ? -1 : a > b ? 1 : 0)
  );
}

/**
 * A name the app can send back to open it: no control characters (refused as
 * paths) and valid UTF-8 (Node decodes other bytes as U+FFFD, a different
 * name that does not exist).
 */
const reopenable = (name: string) =>
  !Array.from(name).some(
    (ch) => ch.charCodeAt(0) < 32 || ch === '\u007f' || ch === '\ufffd',
  );

async function read(
  path: string,
  limit: number,
  signal: Signal,
): Promise<FolderListing> {
  const real = await realFolder(path);
  const names: string[] = [];
  const links: string[] = [];
  let entries = 0;
  let cut = false;
  // Leaving the loop early closes the folder.
  for await (const entry of await opendir(real)) {
    if (signal.stopped) throw tooSlow();
    if (++entries > MAX_ENTRIES) {
      cut = true;
      break;
    }
    if (!reopenable(entry.name)) continue;
    if (entry.isDirectory()) names.push(entry.name);
    else if (entry.isSymbolicLink()) links.push(entry.name);
  }
  // A link counts when it leads to a folder; broken links and files do not.
  // One at a time, so a link into a hung mount holds one thread, not many.
  for (const name of links) {
    if (signal.stopped) throw tooSlow();
    const info = await stat(join(real, name)).catch(() => null);
    if (info?.isDirectory()) names.push(name);
  }
  const all = names.sort(byName);
  const parent = dirname(real);
  return {
    path: real,
    parent: parent === real ? null : parent,
    folders: all
      .slice(0, limit)
      .map((name) => ({ name, path: join(real, name) })),
    truncated: cut || all.length > limit,
  };
}

/** The subfolders of a folder (default: home), real path first. */
export async function listFolders(
  input: string | null,
  homeDir: string,
  options: { limit?: number; timeoutMs?: number } = {},
) {
  const path = expand(input ?? homeDir, homeDir);
  return queue(
    (signal) => read(path, options.limit ?? FOLDER_LIMIT, signal),
    options.timeoutMs ?? FOLDER_TIMEOUT_MS,
  ).catch(fsFailure);
}

/**
 * The real path of an existing folder, for a new workspace or tab, and
 * whether it is the home folder (compared by real path, so a linked home
 * still counts).
 */
export async function resolveFolder(
  input: string,
  homeDir: string,
  timeoutMs = FOLDER_TIMEOUT_MS,
) {
  const path = expand(input, homeDir);
  return queue(async () => {
    const real = await realFolder(path);
    const home =
      real === homeDir ||
      real === (await realpath(homeDir).catch(() => homeDir));
    return { path: real, home };
  }, timeoutMs).catch(fsFailure);
}
