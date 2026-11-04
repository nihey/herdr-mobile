import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { connectFailureCode, HerdrClient } from './socket.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((f) => f()));
});
async function daemon(
  reply: (
    socket: Socket,
    request: { id: string; method: string; params: unknown },
  ) => void,
) {
  const dir = await mkdtemp(join(tmpdir(), 'herdr-test-'));
  const path = join(dir, 'api.sock');
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let text = '';
    socket.on('data', (chunk) => {
      text += chunk;
      if (text.includes('\n')) reply(socket, JSON.parse(text.trim()));
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  return path;
}
describe('Herdr socket transport', () => {
  it('reassembles fragmented JSON and correlates opaque request IDs', async () => {
    const path = await daemon((s, req) => {
      expect(req.method).toBe('ping');
      s.write('{"id":');
      setTimeout(
        () =>
          s.end(
            `${JSON.stringify(req.id)},"result":{"type":"pong","version":"0.9.4"}}\n`,
          ),
        5,
      );
    });
    expect(await new HerdrClient(path).request('ping')).toEqual({
      type: 'pong',
      version: '0.9.4',
    });
  });
  it('preserves semantic daemon errors', async () => {
    const path = await daemon((s, req) =>
      s.end(
        JSON.stringify({
          id: req.id,
          error: { code: 'agent_blocked', message: 'Agent needs input' },
        }) + '\n',
      ),
    );
    await expect(
      new HerdrClient(path).request('agent.prompt', {
        target: 'w1:p1',
        text: 'hello',
      }),
    ).rejects.toMatchObject({ code: 'agent_blocked' });
  });
  it('rejects a response for a different request', async () => {
    const path = await daemon((s) => s.end('{"id":"wrong","result":{}}\n'));
    await expect(new HerdrClient(path).request('ping')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
  it('does not replay an unacknowledged mutation after disconnect', async () => {
    let calls = 0;
    const path = await daemon((s) => {
      calls++;
      s.end();
    });
    await expect(
      new HerdrClient(path).request('agent.prompt', {
        target: 'w1:p1',
        text: 'hello',
      }),
    ).rejects.toMatchObject({ code: 'delivery_unknown' });
    expect(calls).toBe(1);
  });
  it('times out a silent daemon', async () => {
    const path = await daemon(() => {});
    await expect(
      new HerdrClient(path, { timeoutMs: 25 }).request('ping'),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
  it('rejects invalid JSON', async () => {
    const path = await daemon((s) => s.end('oops\n'));
    await expect(new HerdrClient(path).request('ping')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
  it('limits response memory', async () => {
    const path = await daemon((s) => s.end('a'.repeat(129)));
    await expect(
      new HerdrClient(path, { maxBytes: 128 }).request('ping'),
    ).rejects.toMatchObject({ code: 'response_too_large' });
  });
  it('reports a missing socket as Herdr not running', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'herdr-test-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await expect(
      new HerdrClient(join(dir, 'herdr.sock')).request('ping'),
    ).rejects.toMatchObject({ code: 'not_running' });
  });
  it('reports a socket nobody listens on (left by a crash) as not running', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'herdr-test-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    // Connecting to a path that is not a listening socket is refused.
    const path = join(dir, 'herdr.sock');
    await writeFile(path, '');
    await expect(new HerdrClient(path).request('ping')).rejects.toMatchObject({
      code: 'not_running',
    });
  });
});

describe('connection failure codes', () => {
  it('is not_running only when the socket is missing or refused before connecting', () => {
    expect(connectFailureCode('ENOENT', false)).toBe('not_running');
    expect(connectFailureCode('ECONNREFUSED', false)).toBe('not_running');
  });
  it('keeps every other failure unavailable, e.g. a full queue of a frozen Herdr', () => {
    for (const errno of ['EAGAIN', 'EACCES', 'ECONNRESET', 'EPIPE', undefined])
      expect(connectFailureCode(errno, false)).toBe('unavailable');
    expect(connectFailureCode('ECONNREFUSED', true)).toBe('unavailable');
  });
});
