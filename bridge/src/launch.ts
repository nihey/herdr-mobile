import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { HerdrError } from './socket.js';

/**
 * Starting the Herdr server from the phone after it crashed. The bridge runs
 * exactly one fixed command, `herdr [--session <name>] server`, never with
 * user input in it, and only after the socket refused the connection. It never
 * stops or restarts a server.
 */

const sessionName = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
/** Herdr's own directory, which holds the default socket and named sessions. */
export const herdrDir = (homeDir: string) => resolve(homeDir, '.config/herdr');

/** The `herdr` arguments that start the server owning `socketPath`, if known. */
export function serverArgs(socketPath: string, dir: string): string[] | null {
  const path = relative(dir, resolve(socketPath)).split(sep);
  if (path.length === 1 && path[0] === 'herdr.sock') return ['server'];
  const [folder, name, file] = path;
  if (
    path.length === 3 &&
    folder === 'sessions' &&
    name &&
    sessionName.test(name) &&
    file === 'herdr.sock'
  )
    return ['--session', name, 'server'];
  return null;
}

/** The configured `herdr`, else the first executable on PATH or in ~/.local/bin. */
export function findHerdr(env: NodeJS.ProcessEnv, homeDir: string) {
  if (env.HERDR_MOBILE_HERDR_BIN) return env.HERDR_MOBILE_HERDR_BIN;
  const dirs = [
    ...(env.PATH ?? '').split(delimiter).filter(Boolean),
    join(homeDir, '.local/bin'),
  ];
  for (const dir of dirs) {
    const candidate = resolve(dir, 'herdr');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

/** Whether a systemd user manager can run Herdr in its own unit. */
export function systemdAvailable(env: NodeJS.ProcessEnv) {
  return (
    process.platform === 'linux' &&
    !!env.XDG_RUNTIME_DIR &&
    existsSync(join(env.XDG_RUNTIME_DIR, 'systemd/private'))
  );
}

// Herdr pane variables (when the bridge runs inside Herdr), the bridge's own
// configuration, npm's and tmux's (when started with `npm run bridge` in a
// terminal) and the bridge service's systemd variables. Herdr and its panes
// would otherwise inherit them.
const DROPPED_VARIABLES = new Set([
  'INIT_CWD',
  'NODE',
  'TMUX',
  'TMUX_PANE',
  'INVOCATION_ID',
  'JOURNAL_STREAM',
  'NOTIFY_SOCKET',
  'MANAGERPID',
  'SYSTEMD_EXEC_PID',
  'WATCHDOG_PID',
  'WATCHDOG_USEC',
  'MEMORY_PRESSURE_WATCH',
  'MEMORY_PRESSURE_WRITE',
]);
const dropped = (name: string) =>
  name.startsWith('HERDR_') ||
  name.startsWith('LISTEN_') ||
  name.startsWith('npm_') ||
  DROPPED_VARIABLES.has(name);
/** PATH without the node_modules/.bin folders `npm run` puts first. */
const cleanPath = (path: string) =>
  path
    .split(delimiter)
    .filter((dir) => !/(^|[/\\])node_modules[/\\]\.bin$/.test(dir))
    .join(delimiter);

export type LaunchPlan = {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  /** True for a server that is the bridge's own (detached) child. */
  detached: boolean;
};

export function launchPlan(options: {
  herdrBin: string;
  args: string[];
  homeDir: string;
  env: NodeJS.ProcessEnv;
  systemd: boolean;
}): LaunchPlan {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.env))
    if (value !== undefined && !dropped(name)) env[name] = value;
  if (env.PATH !== undefined) env.PATH = cleanPath(env.PATH);
  if (!options.systemd)
    return {
      command: options.herdrBin,
      args: options.args,
      env,
      cwd: options.homeDir,
      detached: true,
    };
  // Its own transient unit, so restarting or stopping the bridge service
  // never kills Herdr and its agents. Herdr keeps its own log; its output
  // is discarded so nothing from it reaches the journal. The explicit
  // `.service` keeps a session named like `x.socket` a valid, distinct unit.
  const session = options.args[0] === '--session' ? options.args[1] : null;
  return {
    command: 'systemd-run',
    args: [
      '--user',
      `--unit=herdr-mobile-server${session ? `-${session}` : ''}.service`,
      '--collect',
      '--quiet',
      `--working-directory=${options.homeDir}`,
      '-p',
      'StandardOutput=null',
      '-p',
      'StandardError=null',
      '--',
      options.herdrBin,
      ...options.args,
    ],
    env,
    cwd: options.homeDir,
    detached: false,
  };
}

const startFailed = (message: string) =>
  new HerdrError('herdr_start_failed', message);

/** A started server; `exited` settles when a detached server exits. */
export type Launched = { exited?: Promise<void> };

/**
 * Runs a plan once. systemd-run returns as soon as the unit is running; a
 * detached server returns once spawned. Its output is never read.
 */
export function runLaunch(plan: LaunchPlan, timeoutMs = 10000) {
  return new Promise<Launched>((resolvePromise, reject) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env,
      detached: plan.detached,
      stdio: 'ignore',
    });
    const exited = new Promise<void>((done) =>
      child.once('exit', () => done()),
    );
    let settled = false;
    const settle = (error?: HerdrError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(plan.detached ? { exited } : {});
    };
    const timer = setTimeout(() => {
      settle(startFailed('Starting Herdr took too long.'));
    }, timeoutMs);
    child.once('error', () =>
      settle(
        startFailed(
          `Could not run ${plan.detached ? 'Herdr' : 'systemd-run'} on the computer.`,
        ),
      ),
    );
    if (plan.detached)
      child.once('spawn', () => {
        child.unref();
        settle();
      });
    else
      child.once('exit', (code) =>
        settle(
          code === 0
            ? undefined
            : startFailed(
                'Could not start Herdr. It may still be starting from an earlier request: refresh in a moment, or check it on the computer.',
              ),
        ),
      );
  });
}

/**
 * The bridge's launch: resolved on every request, so installing Herdr or
 * logging in to the desktop later needs no bridge restart.
 */
export function createLaunch(options: {
  socketPath: string;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  systemd?: () => boolean;
  run?: (plan: LaunchPlan) => Promise<Launched>;
}) {
  // The detached server this bridge started, until it exits. (A systemd
  // unit needs no tracking: systemd-run refuses a unit that is still loaded.)
  let running: Launched | null = null;
  return async (): Promise<Launched> => {
    if (running)
      throw startFailed(
        'Herdr is still starting from an earlier request. Refresh in a moment, or check it on the computer.',
      );
    const args = serverArgs(options.socketPath, herdrDir(options.homeDir));
    if (!args)
      throw new HerdrError(
        'herdr_start_unsupported',
        'This bridge uses a custom Herdr socket, so it cannot tell which Herdr to start. Start it on the computer.',
      );
    const herdrBin = findHerdr(options.env, options.homeDir);
    if (!herdrBin)
      throw new HerdrError(
        'herdr_not_installed',
        'Herdr was not found on the computer. Set HERDR_MOBILE_HERDR_BIN for the bridge.',
      );
    const plan = launchPlan({
      herdrBin,
      args,
      homeDir: options.homeDir,
      env: options.env,
      systemd: (options.systemd ?? (() => systemdAvailable(options.env)))(),
    });
    const launched = await (options.run ?? runLaunch)(plan);
    if (launched.exited) {
      running = launched;
      void launched.exited.then(() => {
        if (running === launched) running = null;
      });
    }
    return launched;
  };
}

export type HerdrStart = { started: boolean };
export type StartHerdr = () => Promise<HerdrStart>;
// Transport failures other than a missing or refused socket: Herdr may be
// running (frozen, a full connection queue, still shutting down), so a
// second one must not be started.
const NOT_RESPONDING = new Set([
  'unavailable',
  'timeout',
  'connection_closed',
  'invalid_response',
  'response_too_large',
]);

/**
 * Starts Herdr only when its socket is missing or refuses connections
 * (`not_running`), then waits (read-only pings) until it answers.
 * Simultaneous requests share one start; a launch is never retried.
 */
export function createHerdrStarter(options: {
  ping: () => Promise<unknown>;
  launch: () => Promise<Launched | void>;
  pollMs?: number;
  budgetMs?: number;
}): StartHerdr {
  const pollMs = options.pollMs ?? 250;
  const budgetMs = options.budgetMs ?? 20000;
  /** Whether Herdr answers; throws when it is running but not answering. */
  const answers = async () => {
    try {
      await options.ping();
      return true;
    } catch (error) {
      if (!(error instanceof HerdrError)) throw error;
      if (error.code === 'not_running') return false;
      if (NOT_RESPONDING.has(error.code))
        throw new HerdrError(
          'herdr_not_responding',
          'Herdr is not answering, but it may still be running, so it was not started again. Check it on the computer.',
        );
      return true;
    }
  };
  async function start(): Promise<HerdrStart> {
    if (await answers()) return { started: false };
    const launched = await options.launch();
    let exited = false;
    void launched?.exited?.then(() => (exited = true));
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      await delay(pollMs);
      try {
        if (await answers()) return { started: true };
      } catch {
        // Still restoring; keep waiting.
      }
      if (exited)
        throw startFailed(
          'Herdr stopped right after starting. Check its log on the computer (~/.config/herdr/herdr-server.log).',
        );
    }
    throw new HerdrError(
      'herdr_start_timeout',
      `Herdr was started but did not answer within ${Math.round(budgetMs / 1000)} seconds. Refresh in a moment, or check it on the computer.`,
    );
  }
  let inflight: Promise<HerdrStart> | null = null;
  return () =>
    (inflight ??= start().finally(() => {
      inflight = null;
    }));
}
