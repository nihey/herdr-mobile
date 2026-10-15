import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HerdrClient } from './socket.js';

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
});
