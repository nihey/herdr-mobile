import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHerdrStarter,
  createLaunch,
  findHerdr,
  launchPlan,
  runLaunch,
  serverArgs,
} from './launch.js';
import type { LaunchPlan } from './launch.js';
import { HerdrClient, HerdrError } from './socket.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((f) => f()));
});
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'herdr-launch-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const notRunning = () =>
  new HerdrError('not_running', 'Cannot connect to Herdr.');
const fast = { pollMs: 1, budgetMs: 50 };

describe('serverArgs', () => {
  const dir = '/home/example/.config/herdr';
  it('starts the default server for the default socket', () => {
    expect(serverArgs(`${dir}/herdr.sock`, dir)).toEqual(['server']);
  });
  it('starts the named session that owns a session socket', () => {
    expect(serverArgs(`${dir}/sessions/work-2/herdr.sock`, dir)).toEqual([
      '--session',
      'work-2',
      'server',
    ]);
  });
  it('refuses any other socket, so it never starts the wrong session', () => {
    expect(serverArgs('/tmp/elsewhere.sock', dir)).toBeNull();
    expect(serverArgs(`${dir}/sessions/a/b/herdr.sock`, dir)).toBeNull();
    expect(serverArgs(`${dir}/../herdr.sock`, dir)).toBeNull();
    expect(serverArgs(`${dir}/sessions/-x/herdr.sock`, dir)).toBeNull();
  });
});

describe('launchPlan', () => {
  const base = {
    herdrBin: '/home/example/.local/bin/herdr',
    args: ['server'],
    homeDir: '/home/example',
    env: {
      PATH: '/usr/bin',
      HOME: '/home/example',
      HERDR_PANE_ID: 'w1:p1',
      HERDR_SOCKET_PATH: '/home/example/.config/herdr/herdr.sock',
      HERDR_MOBILE_TOKEN: 'secret',
      INVOCATION_ID: 'abc',
      JOURNAL_STREAM: '8:123',
      NOTIFY_SOCKET: '/run/notify',
      npm_config_prefix: '/repo',
      npm_lifecycle_event: 'bridge',
      INIT_CWD: '/repo',
      NODE: '/usr/bin/node',
      TMUX: '/tmp/tmux-1000/default,1,0',
      TMUX_PANE: '%1',
    },
  };
  it('runs Herdr in its own systemd user unit, outside the bridge service', () => {
    const plan = launchPlan({ ...base, systemd: true });
    expect(plan.command).toBe('systemd-run');
    expect(plan.args).toEqual([
      '--user',
      '--unit=herdr-mobile-server.service',
      '--collect',
      '--quiet',
      '--working-directory=/home/example',
      '-p',
      'StandardOutput=null',
      '-p',
      'StandardError=null',
      '--',
      '/home/example/.local/bin/herdr',
      'server',
    ]);
    expect(plan.detached).toBe(false);
  });
  it('names the unit after a named session', () => {
    const plan = launchPlan({
      ...base,
      args: ['--session', 'work-2', 'server'],
      systemd: true,
    });
    expect(plan.args).toContain('--unit=herdr-mobile-server-work-2.service');
  });
  it('always names a service, even for a session named like another unit type', () => {
    const plan = launchPlan({
      ...base,
      args: ['--session', 'x.socket', 'server'],
      systemd: true,
    });
    expect(plan.args).toContain('--unit=herdr-mobile-server-x.socket.service');
  });
  it('otherwise starts a detached Herdr in the home folder', () => {
    const plan = launchPlan({ ...base, systemd: false });
    expect(plan).toMatchObject({
      command: '/home/example/.local/bin/herdr',
      args: ['server'],
      cwd: '/home/example',
      detached: true,
    });
  });
  it('drops Herdr pane, bridge and service variables from the environment', () => {
    for (const systemd of [true, false]) {
      const { env } = launchPlan({ ...base, systemd });
      expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH']);
    }
  });
  it("drops npm's node_modules/.bin folders from PATH", () => {
    const { env } = launchPlan({
      ...base,
      env: {
        PATH: '/repo/bridge/node_modules/.bin:/repo/node_modules/.bin:/usr/bin:/bin',
      },
      systemd: false,
    });
    expect(env.PATH).toBe('/usr/bin:/bin');
  });
});

describe('findHerdr', () => {
  it('prefers the configured binary', () => {
    expect(
      findHerdr({ HERDR_MOBILE_HERDR_BIN: '/opt/herdr' }, '/home/example'),
    ).toBe('/opt/herdr');
  });
  it('searches PATH, then ~/.local/bin', async () => {
    const dir = await tempDir();
    const home = join(dir, 'home');
    const bin = join(dir, 'bin');
    await mkdir(join(home, '.local/bin'), { recursive: true });
    await mkdir(bin);
    const local = join(home, '.local/bin/herdr');
    await writeFile(local, '#!/bin/sh\n');
    await chmod(local, 0o755);
    expect(findHerdr({ PATH: bin }, home)).toBe(local);
    const onPath = join(bin, 'herdr');
    await writeFile(onPath, '#!/bin/sh\n');
    await chmod(onPath, 0o755);
    expect(findHerdr({ PATH: bin }, home)).toBe(onPath);
  });
  it('ignores files that are not executable', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'herdr'), '');
    expect(findHerdr({ PATH: dir }, join(dir, 'nohome'))).toBeNull();
  });
});

describe('runLaunch', () => {
  const plan = (command: string, args: string[], detached: boolean) => ({
    command,
    args,
    env: { PATH: process.env.PATH ?? '' },
    cwd: tmpdir(),
    detached,
  });
  it('waits for systemd-run to hand the unit over', async () => {
    await expect(
      runLaunch(plan('/bin/sh', ['-c', 'exit 0'], false)),
    ).resolves.toEqual({});
  });
  it('fails when systemd-run refuses, e.g. while the unit is still loaded', async () => {
    await expect(
      runLaunch(plan('/bin/sh', ['-c', 'exit 1'], false)),
    ).rejects.toMatchObject({ code: 'herdr_start_failed' });
  });
  it('fails when the command does not exist', async () => {
    await expect(
      runLaunch(plan('/nonexistent/herdr', [], true)),
    ).rejects.toMatchObject({ code: 'herdr_start_failed' });
  });
  it('reports when a detached server exits', async () => {
    const launched = await runLaunch(plan('/bin/sh', ['-c', 'exit 1'], true));
    await expect(launched.exited).resolves.toBeUndefined();
  });
  it('returns once a detached server has spawned, without waiting for it', async () => {
    const dir = await tempDir();
    const marker = join(dir, 'ran');
    const started = Date.now();
    await runLaunch(plan('/bin/sh', ['-c', `sleep 1; touch ${marker}`], true));
    expect(Date.now() - started).toBeLessThan(900);
  });
});

describe('createHerdrStarter', () => {
  it('does nothing when Herdr already answers', async () => {
    let launches = 0;
    const start = createHerdrStarter({
      ping: async () => {},
      launch: async () => {
        launches++;
      },
      ...fast,
    });
    await expect(start()).resolves.toEqual({ started: false });
    expect(launches).toBe(0);
  });
  it('starts Herdr once and waits until it answers', async () => {
    let up = false;
    let pings = 0;
    let launches = 0;
    const start = createHerdrStarter({
      ping: async () => {
        pings++;
        if (!up) throw notRunning();
      },
      launch: async () => {
        launches++;
        setTimeout(() => (up = true), 5);
      },
      pollMs: 1,
      budgetMs: 2000,
    });
    await expect(start()).resolves.toEqual({ started: true });
    expect(launches).toBe(1);
    expect(pings).toBeGreaterThan(1);
  });
  it('shares one start between simultaneous requests', async () => {
    let up = false;
    let launches = 0;
    const start = createHerdrStarter({
      ping: async () => {
        if (!up) throw notRunning();
      },
      launch: async () => {
        launches++;
        setTimeout(() => (up = true), 5);
      },
      pollMs: 1,
      budgetMs: 2000,
    });
    const results = await Promise.all([start(), start()]);
    expect(results).toEqual([{ started: true }, { started: true }]);
    expect(launches).toBe(1);
  });
  it('never starts a second Herdr while one is running but not answering', async () => {
    let launches = 0;
    const start = createHerdrStarter({
      ping: async () => {
        throw new HerdrError('timeout', 'Herdr did not respond in time.');
      },
      launch: async () => {
        launches++;
      },
      ...fast,
    });
    await expect(start()).rejects.toMatchObject({
      code: 'herdr_not_responding',
    });
    expect(launches).toBe(0);
  });
  it('never starts Herdr after a connection error other than a refused or missing socket', async () => {
    let launches = 0;
    const start = createHerdrStarter({
      ping: async () => {
        // e.g. EAGAIN: a frozen Herdr whose connection queue is full.
        throw new HerdrError('unavailable', 'Cannot connect to Herdr.');
      },
      launch: async () => {
        launches++;
      },
      ...fast,
    });
    await expect(start()).rejects.toMatchObject({
      code: 'herdr_not_responding',
    });
    expect(launches).toBe(0);
  });
  it('fails at once when the started Herdr exits before answering', async () => {
    const started = Date.now();
    const start = createHerdrStarter({
      ping: async () => {
        throw notRunning();
      },
      launch: async () => ({ exited: Promise.resolve() }),
      pollMs: 5,
      budgetMs: 5000,
    });
    await expect(start()).rejects.toMatchObject({
      code: 'herdr_start_failed',
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it('treats an error answer from Herdr as running', async () => {
    const start = createHerdrStarter({
      ping: async () => {
        throw new HerdrError('unknown_method', 'Unknown method.');
      },
      launch: async () => {
        throw new Error('must not launch');
      },
      ...fast,
    });
    await expect(start()).resolves.toEqual({ started: false });
  });
  it('reports a failed launch without retrying it', async () => {
    let launches = 0;
    const start = createHerdrStarter({
      ping: async () => {
        throw notRunning();
      },
      launch: async () => {
        launches++;
        throw new HerdrError('herdr_start_failed', 'Could not start Herdr.');
      },
      ...fast,
    });
    await expect(start()).rejects.toMatchObject({
      code: 'herdr_start_failed',
    });
    expect(launches).toBe(1);
  });
  it('gives up waiting after the time limit, without launching again', async () => {
    let launches = 0;
    const start = createHerdrStarter({
      ping: async () => {
        throw notRunning();
      },
      launch: async () => {
        launches++;
      },
      ...fast,
    });
    await expect(start()).rejects.toMatchObject({
      code: 'herdr_start_timeout',
    });
    expect(launches).toBe(1);
    // A later request is a new attempt (the user tapped again).
    await expect(start()).rejects.toMatchObject({
      code: 'herdr_start_timeout',
    });
    expect(launches).toBe(2);
  });
});

describe('createLaunch', () => {
  const home = '/home/example';
  const herdr = `${home}/.local/bin/herdr`;
  const env = { HERDR_MOBILE_HERDR_BIN: herdr, PATH: '/usr/bin' };
  it('launches the server that owns the bridge socket', async () => {
    const plans: LaunchPlan[] = [];
    const launch = createLaunch({
      socketPath: `${home}/.config/herdr/sessions/work/herdr.sock`,
      homeDir: home,
      env,
      systemd: () => false,
      run: async (plan) => {
        plans.push(plan);
        return {};
      },
    });
    await launch();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      command: herdr,
      args: ['--session', 'work', 'server'],
      detached: true,
    });
    expect(plans[0].env).not.toHaveProperty('HERDR_MOBILE_HERDR_BIN');
  });
  it('refuses to launch while the Herdr it started earlier is still running', async () => {
    let runs = 0;
    let exit = () => {};
    const launch = createLaunch({
      socketPath: `${home}/.config/herdr/herdr.sock`,
      homeDir: home,
      env,
      systemd: () => false,
      run: async () => {
        runs++;
        return { exited: new Promise<void>((done) => (exit = done)) };
      },
    });
    await launch();
    await expect(launch()).rejects.toMatchObject({
      code: 'herdr_start_failed',
    });
    expect(runs).toBe(1);
    exit();
    await new Promise((done) => setTimeout(done, 0));
    await launch();
    expect(runs).toBe(2);
  });
  it('uses systemd when the user manager is there', async () => {
    const plans: LaunchPlan[] = [];
    await createLaunch({
      socketPath: `${home}/.config/herdr/herdr.sock`,
      homeDir: home,
      env,
      systemd: () => true,
      run: async (plan) => {
        plans.push(plan);
        return {};
      },
    })();
    expect(plans[0].command).toBe('systemd-run');
  });
  it('refuses a socket it cannot match to a Herdr session', async () => {
    await expect(
      createLaunch({
        socketPath: '/tmp/custom.sock',
        homeDir: home,
        env,
        systemd: () => false,
        run: async () => {
          throw new Error('must not run');
        },
      })(),
    ).rejects.toMatchObject({ code: 'herdr_start_unsupported' });
  });
  it('says when Herdr is not installed', async () => {
    const dir = await tempDir();
    await expect(
      createLaunch({
        socketPath: join(dir, '.config/herdr/herdr.sock'),
        homeDir: dir,
        env: { PATH: dir },
        systemd: () => false,
        run: async () => {
          throw new Error('must not run');
        },
      })(),
    ).rejects.toMatchObject({ code: 'herdr_not_installed' });
  });
});

describe('starting a stand-in Herdr end to end', () => {
  it('starts the server after the socket refused, then sees it answer', async () => {
    const home = await tempDir();
    const bin = join(home, 'herdr');
    const pidFile = join(home, 'pid');
    // Listens where the real default server would, answers ping, then quits.
    await writeFile(
      bin,
      `#!${process.execPath}
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.slice(2).join(' ') !== 'server') process.exit(2);
const dir = path.join(process.env.HOME, '.config/herdr');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
const server = net.createServer((socket) => {
  socket.on('data', (chunk) => {
    const { id } = JSON.parse(String(chunk));
    socket.end(JSON.stringify({ id, result: { type: 'pong' } }) + '\\n');
  });
});
setTimeout(() => server.listen(path.join(dir, 'herdr.sock')), 50);
setTimeout(() => process.exit(0), 5000).unref();
`,
    );
    await chmod(bin, 0o755);
    cleanups.push(async () => {
      try {
        process.kill(Number(await readFile(pidFile, 'utf8')));
      } catch {
        // Already gone.
      }
    });
    const client = new HerdrClient(join(home, '.config/herdr/herdr.sock'));
    const start = createHerdrStarter({
      ping: () => client.request('ping', {}, 1000),
      launch: createLaunch({
        socketPath: join(home, '.config/herdr/herdr.sock'),
        homeDir: home,
        env: { HOME: home, PATH: home, HERDR_MOBILE_TOKEN: 'secret' },
        systemd: () => false,
      }),
      pollMs: 20,
      budgetMs: 4000,
    });
    await expect(start()).resolves.toEqual({ started: true });
    await expect(start()).resolves.toEqual({ started: false });
  });
});
