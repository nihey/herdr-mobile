import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphQLError } from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createQueue,
  listFolders,
  resolveFolder,
  withTimeout,
} from './folders.js';

let home: string;
beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'herd-folders-')));
  const devel = join(home, 'devel');
  for (const name of ['notes-app', 'Alpha', 'beta', '.hidden'])
    await mkdir(join(devel, name), { recursive: true });
  await writeFile(join(devel, 'notes.txt'), 'not a folder');
  await symlink(join(devel, 'notes-app'), join(devel, 'linked'));
  await symlink(join(devel, 'notes.txt'), join(devel, 'file-link'));
  await symlink(join(devel, 'missing'), join(devel, 'broken-link'));
  await mkdir(join(home, 'locked'));
  // Names the app could not send back: a control character, invalid UTF-8.
  const odd = join(home, 'odd');
  await mkdir(join(odd, 'fine'), { recursive: true });
  await mkdir(join(odd, 'bad\u0001name'));
  await mkdir(
    Buffer.concat([Buffer.from(odd + '/'), Buffer.from([0x66, 0xff])]),
  );
  await symlink(home, join(tmpdir(), `${home.split('/').pop()}-link`));
});
afterAll(async () => {
  await chmod(join(home, 'locked'), 0o700).catch(() => undefined);
  await rm(home, { recursive: true, force: true });
  await rm(homeLink(), { force: true });
});
/** A link to the home folder, like a symlinked $HOME. */
const homeLink = () => join(tmpdir(), `${home.split('/').pop()}-link`);

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(GraphQLError);
  return error as GraphQLError;
}

describe('listing folders', () => {
  it('lists only folders, by name, with hidden ones last', async () => {
    const listing = await listFolders('~/devel', home);
    expect(listing.path).toBe(join(home, 'devel'));
    expect(listing.parent).toBe(home);
    expect(listing.truncated).toBe(false);
    expect(listing.folders.map((f) => f.name)).toEqual([
      'Alpha',
      'beta',
      'linked',
      'notes-app',
      '.hidden',
    ]);
    expect(listing.folders[3]).toEqual({
      name: 'notes-app',
      path: join(home, 'devel', 'notes-app'),
    });
  });
  it('starts in the home folder', async () => {
    expect((await listFolders(null, home)).path).toBe(home);
    expect((await listFolders('~', home)).path).toBe(home);
  });
  it('accepts full paths and resolves links to the real folder', async () => {
    const listing = await listFolders(join(home, 'devel', 'linked'), home);
    expect(listing.path).toBe(join(home, 'devel', 'notes-app'));
  });
  it('has no parent above the root folder', async () => {
    expect((await listFolders('/', home)).parent).toBeNull();
  });
  it('leaves out names that could not be opened again', async () => {
    const listing = await listFolders('~/odd', home);
    expect(listing.folders.map((f) => f.name)).toEqual(['fine']);
  });
  it('stops at the limit and says so', async () => {
    const listing = await listFolders('~/devel', home, { limit: 2 });
    expect(listing.folders.map((f) => f.name)).toEqual(['Alpha', 'beta']);
    expect(listing.truncated).toBe(true);
  });
  it('refuses relative paths', async () => {
    const error = await refusal(listFolders('devel', home));
    expect(error.extensions.code).toBe('BAD_USER_INPUT');
    expect(error.message).toMatch(/full path/);
  });
  it('refuses control characters and very long paths', async () => {
    for (const path of ['/tmp/\nx', `/${'a'.repeat(5000)}`]) {
      const error = await refusal(listFolders(path, home));
      expect(error.extensions.code).toBe('BAD_USER_INPUT');
    }
  });
  it('explains a missing folder and a file', async () => {
    const missing = await refusal(listFolders('~/nope', home));
    expect(missing.message).toMatch(/does not exist/);
    const file = await refusal(listFolders('~/devel/notes.txt', home));
    expect(file.message).toMatch(/not a folder/);
  });
  it.skipIf(process.getuid?.() === 0)(
    'explains a folder the bridge may not open',
    async () => {
      await chmod(join(home, 'locked'), 0o000);
      const error = await refusal(listFolders('~/locked', home));
      expect(error.extensions.code).toBe('BAD_USER_INPUT');
      expect(error.message).toMatch(/does not let/);
    },
  );
});

describe('resolving a folder for a new session', () => {
  it('returns the real folder', async () => {
    expect(await resolveFolder('~/devel/linked', home)).toEqual({
      path: join(home, 'devel', 'notes-app'),
      home: false,
    });
  });
  it('knows the home folder, even through a link', async () => {
    expect(await resolveFolder('~', homeLink())).toEqual({
      path: home,
      home: true,
    });
    expect(await resolveFolder(home, homeLink())).toEqual({
      path: home,
      home: true,
    });
  });
  it('refuses files and missing folders', async () => {
    await refusal(resolveFolder('~/devel/notes.txt', home));
    await refusal(resolveFolder('~/devel/missing', home));
  });
});

describe('time limit', () => {
  it('gives up on a folder that never answers', async () => {
    const error = await refusal(withTimeout(new Promise(() => {}), 5));
    expect(error.extensions.code).toBe('folder_timeout');
  });
  it('passes through an answer in time', async () => {
    expect(await withTimeout(Promise.resolve(7), 1000)).toBe(7);
  });
});

describe('one folder read at a time', () => {
  it('runs reads in order, each after the last', async () => {
    const run = createQueue();
    const order: string[] = [];
    let finishFirst = () => {};
    const first = run(
      () =>
        new Promise<string>((resolve) => {
          order.push('first started');
          finishFirst = () => resolve('first');
        }),
      1000,
    );
    const second = run(async () => {
      order.push('second started');
      return 'second';
    }, 1000);
    await Promise.resolve();
    expect(order).toEqual(['first started']);
    finishFirst();
    expect(await first).toBe('first');
    expect(await second).toBe('second');
    expect(order).toEqual(['first started', 'second started']);
  });
  it('tells the read in progress to stop when it runs out of time', async () => {
    const run = createQueue();
    let signal: { stopped: boolean } | undefined;
    const error = await refusal(
      run((given) => {
        signal = given;
        return new Promise(() => {});
      }, 5),
    );
    expect(error.extensions.code).toBe('folder_timeout');
    expect(signal?.stopped).toBe(true);
  });
  it('never starts reads stuck behind one that does not finish', async () => {
    const run = createQueue();
    void run(() => new Promise(() => {}), 5).catch(() => undefined);
    let started = false;
    const error = await refusal(
      run(async () => {
        started = true;
      }, 20),
    );
    expect(error.extensions.code).toBe('folder_timeout');
    expect(error.message).toMatch(/Restart the bridge/);
    expect(started).toBe(false);
  });
  it('keeps going after a read fails', async () => {
    const run = createQueue();
    await run(() => Promise.reject(new Error('nope')), 1000).catch(
      () => undefined,
    );
    expect(await run(async () => 'next', 1000)).toBe('next');
  });
});
