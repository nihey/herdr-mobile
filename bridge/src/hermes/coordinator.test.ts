import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoordinatorError, createCoordinator } from './coordinator.js';
import type { HermesHost } from './host.js';
import type { HistoryItem, HostIn, HostOut } from './protocol.js';
import type { ToolOutcome, Turn } from './tools.js';

const FOUR = ['list_agents', 'read_agent', 'send_to_agent', 'start_agent'];

class FakeHost implements HermesHost {
  sent: HostIn[] = [];
  stopped = false;
  private listeners: ((m: HostOut) => void)[] = [];
  private exits: ((code: number | null) => void)[] = [];
  send(message: HostIn) {
    this.sent.push(message);
  }
  onMessage(listener: (m: HostOut) => void) {
    this.listeners.push(listener);
  }
  onExit(listener: (code: number | null) => void) {
    this.exits.push(listener);
  }
  stop() {
    this.stopped = true;
  }
  emit(message: HostOut) {
    for (const listener of this.listeners) listener(message);
  }
  exit(code: number | null) {
    for (const listener of this.exits) listener(code);
  }
  ready(overrides: Partial<Extract<HostOut, { type: 'ready' }>> = {}) {
    this.emit({
      type: 'ready',
      sessionId: 's1',
      tools: FOUR,
      history: [],
      defaultModel: 'gpt-5.6-sol',
      defaultProvider: 'openai-codex',
      probe: null,
      ...overrides,
    });
  }
  last<T extends HostIn['type']>(type: T) {
    return this.sent.filter((m) => m.type === type).at(-1) as
      Extract<HostIn, { type: T }> | undefined;
  }
}

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true });
  dirs = [];
});

function setup({
  codex = 'model = "gpt-6.1-sol"\n',
  spawnNull = false,
  run = async (): Promise<ToolOutcome> => ({ ok: true, result: '{}' }),
  turnTimeoutMs,
  stateDir,
  extra = {},
}: {
  codex?: string | null;
  spawnNull?: boolean;
  run?: (
    turn: Turn | null,
    name: string,
    args: unknown,
  ) => Promise<ToolOutcome>;
  turnTimeoutMs?: number;
  stateDir?: string;
  extra?: Partial<Parameters<typeof createCoordinator>[0]>;
} = {}) {
  const dir = stateDir ?? mkdtempSync(join(tmpdir(), 'herd-coord-'));
  if (!stateDir) dirs.push(dir);
  const hosts: FakeHost[] = [];
  const tools = { run: vi.fn(run) };
  const coordinator = createCoordinator({
    spawn: () => {
      if (spawnNull) return null;
      const host = new FakeHost();
      hosts.push(host);
      return host;
    },
    tools,
    stateFile: join(dir, 'hermes-state.json'),
    readCodexConfig: () => codex,
    instructions: 'coordinate',
    ...(turnTimeoutMs ? { turnTimeoutMs } : {}),
    ...extra,
  });
  const host = () => hosts.at(-1) as FakeHost;
  return { coordinator, hosts, host, tools, dir };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Hermes coordinator', () => {
  it("starts Hermes with codex's model at medium effort", () => {
    const { coordinator, host } = setup();
    expect(coordinator.conversation().status).toBe('starting');
    expect(host().last('start')).toMatchObject({
      model: 'gpt-6.1-sol',
      provider: 'openai-codex',
      reasoningEffort: 'medium',
      probe: true,
      sessionId: null,
    });
    expect(
      host()
        .last('start')
        ?.tools.map((t) => t.name),
    ).toEqual(FOUR);
  });

  it("falls back visibly when codex's model is missing", () => {
    const { coordinator, hosts, host } = setup();
    coordinator.conversation();
    host().ready({ probe: { ok: false, modelMissing: true } });
    expect(hosts[0]?.stopped).toBe(true);
    expect(hosts).toHaveLength(2);
    expect(host().last('start')).toMatchObject({
      model: 'gpt-5.6-sol',
      provider: 'openai-codex',
      probe: false,
    });
    host().ready();
    const conversation = coordinator.conversation();
    expect(conversation.status).toBe('ready');
    expect(conversation.model).toBe('gpt-5.6-sol');
    expect(conversation.modelNote).toBe(
      "gpt-5.6-sol · codex's gpt-6.1-sol isn't available in hermes",
    );
  });

  it('refuses a host with extra tools', () => {
    const { coordinator, host } = setup();
    coordinator.conversation();
    host().ready({ tools: [...FOUR, 'terminal'] });
    const conversation = coordinator.conversation();
    expect(conversation.status).toBe('unavailable');
    expect(conversation.reason).toBe(
      'Hermes offered tools beyond the four coordinator tools; refusing to start.',
    );
    expect(host().stopped).toBe(true);
  });

  it('rejects a second message while working', () => {
    const { coordinator, host } = setup();
    coordinator.conversation();
    host().ready();
    coordinator.send('how are they?');
    expect(() => coordinator.send('and now?')).toThrowError(
      expect.objectContaining({ code: 'hermes_busy' }) as Error,
    );
    expect(host().sent.filter((m) => m.type === 'turn')).toHaveLength(1);
  });

  it("shows sends as chips from the bridge's record", async () => {
    const { coordinator, host, tools } = setup({
      run: async () => ({
        ok: true,
        result: '{"sent":true}',
        chip: { kind: 'sent', paneId: 'w1:p1', title: 'Payments migration' },
      }),
    });
    coordinator.conversation();
    host().ready();
    const turnId = coordinator.send('tell the api agent to check logs');
    host().emit({
      type: 'tool_call',
      turnId,
      callId: 'c1',
      name: 'send_to_agent',
      args: { agent_id: 'w1:p1', message: 'check logs' },
    });
    await flush();
    expect(tools.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: turnId }),
      'send_to_agent',
      { agent_id: 'w1:p1', message: 'check logs' },
    );
    expect(host().last('tool_result')).toEqual({
      type: 'tool_result',
      callId: 'c1',
      ok: true,
      result: '{"sent":true}',
    });
    host().emit({ type: 'delta', turnId, text: 'Done.' });
    host().emit({
      type: 'turn_end',
      turnId,
      text: 'Done.',
      interrupted: false,
      error: null,
    });
    const reply = coordinator.conversation().messages.at(-1);
    expect(reply).toMatchObject({
      role: 'hermes',
      text: 'Done.',
      stopped: false,
    });
    expect(reply?.chips).toEqual([
      { kind: 'sent', paneId: 'w1:p1', title: 'Payments migration' },
    ]);
  });

  it('refuses tool calls for a turn that is over', async () => {
    const { coordinator, host, tools } = setup();
    coordinator.conversation();
    host().ready();
    host().emit({
      type: 'tool_call',
      turnId: 'old',
      callId: 'c9',
      name: 'send_to_agent',
      args: {},
    });
    await flush();
    expect(tools.run).toHaveBeenCalledWith(null, 'send_to_agent', {});
  });

  it('stop marks the reply stopped', () => {
    const { coordinator, host } = setup();
    coordinator.conversation();
    host().ready();
    const turnId = coordinator.send('tell X to deploy');
    host().emit({ type: 'delta', turnId, text: 'Sending' });
    coordinator.stop();
    expect(host().last('cancel')).toEqual({ type: 'cancel', turnId });
    host().emit({
      type: 'turn_end',
      turnId,
      text: 'Sending',
      interrupted: true,
      error: null,
    });
    const conversation = coordinator.conversation();
    expect(conversation.working).toBe(false);
    expect(conversation.messages.at(-1)).toMatchObject({
      role: 'hermes',
      stopped: true,
    });
  });

  it('ends a stalled turn', async () => {
    const { coordinator, hosts } = setup({
      turnTimeoutMs: 50,
      extra: { stopGraceMs: 30 },
    });
    coordinator.conversation();
    hosts[0]?.ready();
    const turnId = coordinator.send('hello?');
    await new Promise((resolve) => setTimeout(resolve, 120));
    const conversation = coordinator.conversation();
    expect(conversation.working).toBe(false);
    expect(conversation.messages.at(-1)).toMatchObject({
      role: 'hermes',
      stopped: true,
      text: 'Hermes took too long and was stopped.',
    });
    expect(hosts[0]?.last('cancel')).toEqual({ type: 'cancel', turnId });
    // The stalled host is replaced so the next message is not refused.
    expect(hosts[0]?.stopped).toBe(true);
    expect(hosts).toHaveLength(2);
  });

  it('maps reloaded history to messages and chips', () => {
    const { coordinator, host } = setup();
    coordinator.conversation();
    const history: HistoryItem[] = [
      { role: 'user', text: 'how is api?', tools: [], stopped: false },
      {
        role: 'hermes',
        text: 'It is working.',
        tools: [
          {
            name: 'read_agent',
            args: { agent_id: 'w1:p1' },
            result: '{"title":"Payments migration"}',
          },
          {
            name: 'send_to_agent',
            args: { agent_id: 'w2:p1' },
            result: '{"error":"agent_not_found"}',
          },
        ],
        stopped: false,
      },
      { role: 'user', text: 'tell it to stop', tools: [], stopped: false },
    ];
    host().ready({ history });
    const { messages } = coordinator.conversation();
    expect(messages.map((m) => [m.role, m.text, m.stopped])).toEqual([
      ['user', 'how is api?', false],
      ['hermes', 'It is working.', false],
      ['user', 'tell it to stop', true],
    ]);
    expect(messages[1]?.chips).toEqual([
      { kind: 'read', paneId: 'w1:p1', title: 'Payments migration' },
    ]);
  });

  it('remembers the session', () => {
    const first = setup();
    first.coordinator.conversation();
    first
      .host()
      .ready({ sessionId: 'kept-1', probe: { ok: true, modelMissing: false } });
    const file = join(first.dir, 'hermes-state.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      sessionId: 'kept-1',
      verifiedModel: 'gpt-6.1-sol',
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const second = setup({ stateDir: first.dir });
    second.coordinator.conversation();
    expect(second.host().last('start')).toMatchObject({
      sessionId: 'kept-1',
      probe: false,
    });
  });

  it('reports a missing Hermes', () => {
    const { coordinator } = setup({ spawnNull: true });
    const conversation = coordinator.conversation();
    expect(conversation.status).toBe('unavailable');
    expect(conversation.reason).toBe(
      "Hermes isn't installed on this computer.",
    );
    expect(() => coordinator.send('hi')).toThrowError(CoordinatorError);
  });

  it("uses Hermes's own default without a codex config", () => {
    const { coordinator, host } = setup({ codex: null });
    coordinator.conversation();
    expect(host().last('start')).toMatchObject({
      model: '',
      provider: '',
      probe: false,
    });
  });

  it('refuses tool calls after stop', async () => {
    const { coordinator, host, tools } = setup();
    coordinator.conversation();
    host().ready();
    const turnId = coordinator.send('tell X to deploy');
    coordinator.stop();
    host().emit({
      type: 'tool_call',
      turnId,
      callId: 'c2',
      name: 'send_to_agent',
      args: { agent_id: 'w1:p1', message: 'deploy' },
    });
    await flush();
    expect(tools.run).toHaveBeenCalledWith(null, 'send_to_agent', {
      agent_id: 'w1:p1',
      message: 'deploy',
    });
  });

  it('finishes a stop that Hermes never confirms', async () => {
    const { coordinator, hosts } = setup({ extra: { stopGraceMs: 30 } });
    coordinator.conversation();
    hosts[0]?.ready();
    coordinator.send('count to a million');
    coordinator.stop();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const conversation = coordinator.conversation();
    expect(conversation.working).toBe(false);
    expect(conversation.messages.at(-1)).toMatchObject({ stopped: true });
    expect(hosts[0]?.stopped).toBe(true);
    expect(hosts).toHaveLength(2);
  });

  it('gives up on a start that never becomes ready', async () => {
    const { coordinator, host } = setup({ extra: { startTimeoutMs: 30 } });
    coordinator.conversation();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const conversation = coordinator.conversation();
    expect(conversation.status).toBe('unavailable');
    expect(conversation.reason).toBe(
      'Hermes did not start in time. It will try again shortly.',
    );
    expect(host().stopped).toBe(true);
  });

  it('survives a state file it cannot write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'herd-coord-'));
    dirs.push(dir);
    // A directory where the state file should be: every write fails.
    mkdirSync(join(dir, 'hermes-state.json'));
    const { coordinator, host } = setup({ stateDir: dir });
    coordinator.conversation();
    expect(() => host().ready()).not.toThrow();
    const conversation = coordinator.conversation();
    expect(conversation.status).toBe('unavailable');
    expect(conversation.reason).toContain('could not save its state');
  });

  it('does not start Hermes for a summary', () => {
    const { coordinator, hosts } = setup();
    const summary = coordinator.conversation({ start: false });
    expect(summary.status).toBe('off');
    expect(hosts).toHaveLength(0);
    coordinator.conversation();
    expect(hosts).toHaveLength(1);
  });

  it('shows uncertain changes from history', () => {
    const { coordinator, host } = setup();
    coordinator.conversation();
    host().ready({
      history: [
        { role: 'user', text: 'tell api hi', tools: [], stopped: false },
        {
          role: 'hermes',
          text: 'It may have arrived.',
          tools: [
            {
              name: 'send_to_agent',
              args: { agent_id: 'w1:p1' },
              result: '{"uncertain": true, "agent_id": "w1:p1"}',
            },
          ],
          stopped: false,
        },
      ],
    });
    expect(coordinator.conversation().messages[1]?.chips).toEqual([
      { kind: 'sent', paneId: 'w1:p1', title: null, uncertain: true },
    ]);
  });
});
