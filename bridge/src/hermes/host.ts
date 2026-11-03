import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { HostIn, HostOut } from './protocol.js';

export type HermesHost = {
  send(message: HostIn): void;
  onMessage(listener: (message: HostOut) => void): void;
  onExit(listener: (code: number | null) => void): void;
  stop(): void;
};

/** bridge/hermes/host.py, from both src/hermes and dist/hermes. */
export const HOST_SCRIPT = fileURLToPath(
  new URL('../../hermes/host.py', import.meta.url),
);
const MAX_LINE_BYTES = 4 * 1024 * 1024;

/**
 * The host's environment: everything except Herdr's pane variables, so the
 * Hermes Herdr plugin (and anything else) never reports the coordinator as an
 * agent in a pane.
 */
export function hostEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith('HERDR_')),
  );
}

export function spawnHost(options: {
  python: string;
  script?: string;
  env?: NodeJS.ProcessEnv;
}): HermesHost {
  // stderr carries Hermes's own logs, which can quote the conversation: never
  // read or log it.
  const child = spawn(options.python, ['-I', options.script ?? HOST_SCRIPT], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: hostEnv(options.env ?? process.env),
  });
  const listeners: ((message: HostOut) => void)[] = [];
  const exits: ((code: number | null) => void)[] = [];
  let exited = false;
  const emit = (message: HostOut) => {
    for (const listener of listeners) listener(message);
  };
  const fail = (message: string) => {
    emit({ type: 'fatal', reason: 'other', message });
    child.kill('SIGKILL');
  };
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        emit(JSON.parse(line) as HostOut);
      } catch {
        fail('Hermes sent an unreadable message.');
        return;
      }
    }
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES)
      fail('Hermes sent a message that is too large.');
  });
  child.on('error', () => fail('Hermes could not be started.'));
  child.on('exit', (code) => {
    exited = true;
    for (const listener of exits) listener(code);
  });
  child.stdin.on('error', () => {
    // The host exited; onExit reports it.
  });
  return {
    send(message) {
      if (!exited && child.stdin.writable)
        child.stdin.write(JSON.stringify(message) + '\n');
    },
    onMessage(listener) {
      listeners.push(listener);
    },
    onExit(listener) {
      exits.push(listener);
    },
    stop() {
      if (!exited) child.kill('SIGTERM');
    },
  };
}
