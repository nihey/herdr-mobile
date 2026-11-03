import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hostEnv, spawnHost, type HermesHost } from './host.js';
import type { HostIn, HostOut, ToolSpec } from './protocol.js';
import { startFakeModel, type FakeModel, type FakeStep } from './fake-model.js';

const python = join(homedir(), '.hermes/hermes-agent/venv/bin/python');
const tools: ToolSpec[] = [
  'list_agents',
  'read_agent',
  'send_to_agent',
  'start_agent',
].map((name) => ({
  name,
  description: `${name} test tool`,
  parameters: { type: 'object', properties: {}, required: [] },
}));

/** Drives a real host process and waits for its messages in order. */
class Driver {
  readonly seen: HostOut[] = [];
  private waiters: {
    match: (m: HostOut) => boolean;
    resolve: (m: HostOut) => void;
  }[] = [];
  constructor(readonly host: HermesHost) {
    host.onMessage((message) => {
      this.seen.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(message)) return true;
        w.resolve(message);
        return false;
      });
    });
  }
  next<T extends HostOut['type']>(type: T, after = 0) {
    const found = this.seen.slice(after).find((m) => m.type === type);
    if (found) return Promise.resolve(found as Extract<HostOut, { type: T }>);
    return new Promise<Extract<HostOut, { type: T }>>((resolve) =>
      this.waiters.push({
        match: (m) => m.type === type,
        resolve: resolve as (m: HostOut) => void,
      }),
    );
  }
  send(message: HostIn) {
    this.host.send(message);
  }
}

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) await step();
  cleanup = [];
});

async function setup(steps: FakeStep[], home?: string) {
  const model: FakeModel = await startFakeModel(steps);
  const hermesHome = home ?? mkdtempSync(join(tmpdir(), 'herd-hermes-'));
  const host = spawnHost({
    python,
    env: { ...process.env, HERMES_HOME: hermesHome },
  });
  cleanup.push(
    () => host.stop(),
    () => model.close(),
  );
  if (!home) cleanup.push(() => rmSync(hermesHome, { recursive: true }));
  const driver = new Driver(host);
  const start = (sessionId: string | null = null, probe = false) =>
    driver.send({
      type: 'start',
      sessionId,
      model: 'fake-model',
      provider: 'custom',
      baseUrl: model.baseUrl,
      apiKey: 'dummy',
      reasoningEffort: 'medium',
      instructions: 'You coordinate test agents.',
      tools,
      probe,
    });
  return { model, driver, start, hermesHome };
}

describe.skipIf(!existsSync(python))('Hermes host', () => {
  it('reports exactly the four coordinator tools', async () => {
    const { driver, start } = await setup([]);
    start();
    const ready = await driver.next('ready');
    expect([...ready.tools].sort()).toEqual([
      'list_agents',
      'read_agent',
      'send_to_agent',
      'start_agent',
    ]);
  }, 30000);

  it('relays a tool call and streams the reply', async () => {
    const { driver, start } = await setup([
      { tool: 'list_agents' },
      { text: 'two agents' },
    ]);
    start();
    await driver.next('ready');
    driver.send({ type: 'turn', turnId: 't1', text: 'how are they?' });
    const call = await driver.next('tool_call');
    expect(call).toMatchObject({ turnId: 't1', name: 'list_agents' });
    driver.send({
      type: 'tool_result',
      callId: call.callId,
      ok: true,
      result: '[]',
    });
    const end = await driver.next('turn_end');
    expect(end).toMatchObject({
      turnId: 't1',
      text: 'two agents',
      interrupted: false,
      error: null,
    });
    expect(driver.seen.some((m) => m.type === 'delta')).toBe(true);
  }, 30000);

  it('stops a turn and closes the request in history', async () => {
    const { driver, start, model } = await setup([
      { text: 'one two three four five six seven eight', slowMs: 300 },
      { text: 'all quiet' },
    ]);
    start();
    await driver.next('ready');
    driver.send({ type: 'turn', turnId: 't1', text: 'tell X to deploy' });
    await driver.next('delta');
    driver.send({ type: 'cancel', turnId: 't1' });
    const stopped = await driver.next('turn_end');
    expect(stopped.interrupted).toBe(true);
    const mark = driver.seen.length;
    driver.send({ type: 'turn', turnId: 't2', text: 'how are you?' });
    await driver.next('turn_end', mark);
    const last = JSON.stringify(model.requests.at(-1));
    expect(last).toContain('Nothing more will be done');
  }, 30000);

  it("reloads a session's history", async () => {
    const home = mkdtempSync(join(tmpdir(), 'herd-hermes-'));
    cleanup.push(() => rmSync(home, { recursive: true }));
    const first = await setup(
      [{ tool: 'read_agent', args: { agent_id: 'w1:p1' } }, { text: 'busy' }],
      home,
    );
    first.start();
    const ready = await first.driver.next('ready');
    first.driver.send({ type: 'turn', turnId: 't1', text: 'how is w1?' });
    const call = await first.driver.next('tool_call');
    first.driver.send({
      type: 'tool_result',
      callId: call.callId,
      ok: true,
      result: '{"status":"working"}',
    });
    await first.driver.next('turn_end');
    first.driver.host.stop();
    const second = await setup([], home);
    second.start(ready.sessionId);
    const again = await second.driver.next('ready');
    expect(again.sessionId).toBe(ready.sessionId);
    expect(again.history).toEqual([
      { role: 'user', text: 'how is w1?', tools: [], stopped: false },
      {
        role: 'hermes',
        text: 'busy',
        tools: [
          {
            name: 'read_agent',
            args: { agent_id: 'w1:p1' },
            result: '{"status": "working"}',
          },
        ],
        stopped: false,
      },
    ]);
  }, 30000);

  it('flags a missing model on probe', async () => {
    const { driver, start } = await setup([
      {
        status: 404,
        body: {
          error: {
            message: 'The model fake-model does not exist',
            code: 'model_not_found',
          },
        },
      },
    ]);
    start(null, true);
    const ready = await driver.next('ready');
    expect(ready.probe).toEqual({ ok: false, modelMissing: true });
  }, 30000);
});

describe('Hermes host environment', () => {
  it('strips Herdr variables', () => {
    expect(hostEnv({ HERDR_ENV: '1', HERDR_PANE_ID: 'x', PATH: 'p' })).toEqual({
      PATH: 'p',
    });
  });
});

// Final review fixes: unfinished requests stay closed, in-flight results are
// recorded as they happened, the probe carries no tools, ready stays small.
type Message = { role: string; content?: unknown };
const messagesOf = (request: Record<string, unknown> | undefined) =>
  (request?.messages ?? []) as Message[];
const text = (m: Message) =>
  typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
const notFound = {
  status: 404,
  body: {
    error: {
      message: 'The model fake-model does not exist',
      code: 'model_not_found',
    },
  },
};

describe.skipIf(!existsSync(python))('Hermes host: unfinished requests', () => {
  it('closes a failed request so the next message is not merged with it', async () => {
    const { driver, start, model } = await setup([notFound, { text: 'fine' }]);
    start();
    await driver.next('ready');
    driver.send({ type: 'turn', turnId: 't1', text: 'tell X to deploy' });
    const failed = await driver.next('turn_end');
    expect(failed.error).toContain('404');
    const mark = driver.seen.length;
    driver.send({ type: 'turn', turnId: 't2', text: 'how are you?' });
    await driver.next('turn_end', mark);
    const messages = messagesOf(model.requests.at(-1));
    const users = messages.filter((m) => m.role === 'user').map(text);
    expect(
      users.some((u) => u.includes('deploy') && u.includes('how are you')),
    ).toBe(false);
    expect(
      messages.some(
        (m) =>
          m.role === 'assistant' &&
          text(m).includes('Nothing more will be done'),
      ),
    ).toBe(true);
  }, 30000);

  it('closes a turn cut off by a restart', async () => {
    const home = mkdtempSync(join(tmpdir(), 'herd-hermes-'));
    cleanup.push(() => rmSync(home, { recursive: true }));
    const first = await setup(
      [
        {
          tool: 'send_to_agent',
          args: { agent_id: 'w1:p1', message: 'deploy' },
        },
      ],
      home,
    );
    first.start();
    const ready = await first.driver.next('ready');
    first.driver.send({
      type: 'turn',
      turnId: 't1',
      text: 'tell X and Y to deploy',
    });
    const call = await first.driver.next('tool_call');
    first.driver.send({
      type: 'tool_result',
      callId: call.callId,
      ok: true,
      result: '{"sent":true,"agent_id":"w1:p1"}',
    });
    await new Promise((r) => setTimeout(r, 500));
    first.driver.host.stop();
    await new Promise((r) => setTimeout(r, 500));
    const second = await setup([{ text: 'all quiet' }], home);
    second.start(ready.sessionId);
    const again = await second.driver.next('ready');
    expect(again.history.at(-1)).toMatchObject({
      role: 'hermes',
      stopped: true,
    });
    second.driver.send({ type: 'turn', turnId: 't2', text: 'anything new?' });
    await second.driver.next('turn_end');
    const messages = messagesOf(second.model.requests.at(-1));
    const last = messages.findLastIndex((m) => m.role === 'user');
    expect(text(messages[last - 1] as Message)).toContain(
      'Nothing more will be done',
    );
  }, 30000);

  it("records the bridge's answer for a call in flight when stopped", async () => {
    const home = mkdtempSync(join(tmpdir(), 'herd-hermes-'));
    cleanup.push(() => rmSync(home, { recursive: true }));
    const first = await setup(
      [
        { tool: 'send_to_agent', args: { agent_id: 'w1:p1', message: 'hi' } },
        { text: 'done' },
      ],
      home,
    );
    first.start();
    const ready = await first.driver.next('ready');
    first.driver.send({ type: 'turn', turnId: 't1', text: 'tell it hi' });
    const call = await first.driver.next('tool_call');
    first.driver.send({ type: 'cancel', turnId: 't1' });
    await new Promise((r) => setTimeout(r, 300));
    first.driver.send({
      type: 'tool_result',
      callId: call.callId,
      ok: true,
      result: '{"sent":true,"agent_id":"w1:p1"}',
    });
    await first.driver.next('turn_end');
    first.driver.host.stop();
    const second = await setup([], home);
    second.start(ready.sessionId);
    const again = await second.driver.next('ready');
    const tool = again.history
      .flatMap((item) => item.tools)
      .find((t) => t.name === 'send_to_agent');
    expect(tool?.result).toContain('"sent": true');
  }, 30000);

  it('probes the model without tools', async () => {
    const { driver, start, model } = await setup([{ text: 'OK' }]);
    start(null, true);
    const ready = await driver.next('ready');
    expect(ready.probe).toEqual({ ok: true, modelMissing: false });
    const tools = model.requests[0]?.tools;
    expect(Array.isArray(tools) ? tools : []).toEqual([]);
  }, 30000);

  it('keeps reloaded tool results small', async () => {
    const home = mkdtempSync(join(tmpdir(), 'herd-hermes-'));
    cleanup.push(() => rmSync(home, { recursive: true }));
    const first = await setup(
      [{ tool: 'read_agent', args: { agent_id: 'w1:p1' } }, { text: 'busy' }],
      home,
    );
    first.start();
    const ready = await first.driver.next('ready');
    first.driver.send({ type: 'turn', turnId: 't1', text: 'how is w1?' });
    const call = await first.driver.next('tool_call');
    const big = JSON.stringify({
      title: 'Payments migration',
      status: 'working',
      text: 'x'.repeat(30000),
    });
    first.driver.send({
      type: 'tool_result',
      callId: call.callId,
      ok: true,
      result: big,
    });
    await first.driver.next('turn_end');
    first.driver.host.stop();
    const second = await setup([], home);
    second.start(ready.sessionId);
    const again = await second.driver.next('ready');
    const tool = again.history.flatMap((item) => item.tools)[0];
    expect(tool?.result.length).toBeLessThan(1000);
    expect(JSON.parse(tool?.result ?? '{}')).toMatchObject({
      title: 'Payments migration',
    });
  }, 30000);
});
