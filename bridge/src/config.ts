import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

export function loadConfig() {
  const tokenFile = resolve(
    process.env.HERDR_MOBILE_TOKEN_FILE ?? '../.local/pairing-token',
  );
  let token = process.env.HERDR_MOBILE_TOKEN?.trim();
  if (!token) {
    mkdirSync(dirname(tokenFile), { recursive: true, mode: 0o700 });
    try {
      token = readFileSync(tokenFile, 'utf8').trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      token = randomBytes(32).toString('hex');
      writeFileSync(tokenFile, token + '\n', { flag: 'wx', mode: 0o600 });
    }
    chmodSync(tokenFile, 0o600);
  }
  if (token.length < 32)
    throw new Error('Pairing token must contain at least 32 characters.');
  let host = process.env.HERDR_MOBILE_HOST;
  if (!host) {
    try {
      host = execFileSync('tailscale', ['ip', '-4'], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .trim()
        .split('\n')[0];
    } catch {
      throw new Error(
        'No Tailscale address available. Connect Tailscale or set HERDR_MOBILE_HOST=127.0.0.1 for local development.',
      );
    }
  }
  if (!host) throw new Error('Tailscale did not return an address.');
  const port = Number(process.env.HERDR_MOBILE_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid bridge port.');
  return {
    host,
    port,
    token,
    tokenFile,
    socketPath:
      process.env.HERDR_SOCKET_PATH ??
      resolve(homedir(), '.config/herdr/herdr.sock'),
  };
}
