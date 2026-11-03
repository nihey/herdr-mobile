import { describe, expect, it } from 'vitest';
import { createActions } from '../actions.js';
import { HerdrError } from '../socket.js';
import { CHANGES_PER_TURN, createTools, type Turn } from './tools.js';

type Call = { method: string; params: Record<string, unknown> };

function setup({
  output = 'line one\nline two',
  promptError,
  startStatus = 'idle',
  onStart,
}: {
  output?: string;
  promptError?: string;
  startStatus?: string;
  onStart?: () => void;
} = {}) {
  const calls: Call[] = [];
  const request = async (
    method: string,
    params: Record<string, unknown> = {},
  ) => {
    calls.push({ method, params });
    switch (method) {
      case 'session.snapshot':
        return {
          snapshot: {
            workspaces: [
              { workspace_id: 'w1', label: 'API' },
              { workspace_id: 'w9', label: 'phone' },
            ],
            panes: [
              { pane_id: 'w1:p1', workspace_id: 'w1', cwd: '/work/api' },
              { pane_id: 'w9:p1', workspace_id: 'w9', cwd: '/home/tester' },
            ],
            agents: [
              {
                pane_id: 'w1:p1',
                workspace_id: 'w1',
                tab_id: 'w1:t1',
                name: 'coder',
                agent: 'codex',
                agent_status: 'working',
                cwd: '/work/api',
                terminal_title_stripped: 'Payments migration',
              },
            ],
          },
        };
      case 'pane.get':
        return { pane: { scroll: { max_offset_from_bottom: 5 } } };
      case 'agent.read':
        return { read: { text: output } };
      case 'agent.prompt':
        if (promptError) throw new HerdrError(promptError, 'Herdr said no.');
        return { type: 'ok' };
      case 'tab.create':
        return {
          tab: { tab_id: `${params.workspace_id}:t2` },
          root_pane: { pane_id: `${params.workspace_id}:p2` },
        };
      case 'pane.process_info':
        throw new HerdrError('unsupported', 'no process info');
      case 'agent.start':
        onStart?.();
        return { type: 'ok' };
      case 'agent.get':
        return { agent: { agent_status: startStatus } };
      default:
        return { type: 'ok' };
    }
  };
  const actions = createActions(
    request,
    {
      pollMs: 1,
      settleMs: 0,
      shellTimeoutMs: 50,
      exitGraceMs: 0,
      totalMs: 2000,
    },
    '/home/tester',
  );
  const tools = createTools(actions, (kind) => `${kind}-beef`);
  const turn: Turn = { id: 't1', changes: 0 };
  const methods = () => calls.map((c) => c.method);
  return { calls, tools, turn, methods };
}

describe('coordinator tools', () => {
  it('lists agents with opaque ids', async () => {
    const { tools, turn } = await setup();
    const { ok, result } = await tools.run(turn, 'list_agents', {});
    expect(ok).toBe(true);
    expect(JSON.parse(result)).toEqual([
      {
        agent_id: 'w1:p1',
        name: 'coder',
        title: 'Payments migration',
        project: 'API',
        folder: '/work/api',
        kind: 'codex',
        status: 'working',
      },
    ]);
  });

  it('clips long agent output', async () => {
    const lines = Array.from(
      { length: 1000 },
      (_, i) => `row ${i} ${'x'.repeat(60)}`,
    );
    const { tools, turn } = setup({ output: lines.join('\n') });
    const { ok, result, chip } = await tools.run(turn, 'read_agent', {
      agent_id: 'w1:p1',
      lines: 1000,
    });
    expect(ok).toBe(true);
    const text = (JSON.parse(result) as { text: string }).text;
    expect(text.split('\n').length).toBeLessThanOrEqual(200);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(24 * 1024);
    expect(text.endsWith(lines.at(-1) as string)).toBe(true);
    expect(chip).toEqual({
      kind: 'read',
      paneId: 'w1:p1',
      title: 'Payments migration',
    });
  });

  it('sends once and records a chip', async () => {
    const { tools, turn, calls } = setup();
    const { ok, chip } = await tools.run(turn, 'send_to_agent', {
      agent_id: 'w1:p1',
      message: 'also check the staging logs',
    });
    expect(ok).toBe(true);
    expect(calls.filter((c) => c.method === 'agent.prompt')).toEqual([
      {
        method: 'agent.prompt',
        params: { target: 'w1:p1', text: 'also check the staging logs' },
      },
    ]);
    expect(chip).toEqual({
      kind: 'sent',
      paneId: 'w1:p1',
      title: 'Payments migration',
    });
  });

  it('refuses a fourth change in one turn', async () => {
    const { tools, turn, methods } = setup();
    for (let i = 0; i < CHANGES_PER_TURN; i++)
      expect(
        (
          await tools.run(turn, 'send_to_agent', {
            agent_id: 'w1:p1',
            message: `m${i}`,
          })
        ).ok,
      ).toBe(true);
    const fourth = await tools.run(turn, 'send_to_agent', {
      agent_id: 'w1:p1',
      message: 'm3',
    });
    expect(fourth.ok).toBe(false);
    expect(fourth.result).toContain('at most 3 agents per request');
    expect(fourth.chip).toBeUndefined();
    expect(methods().filter((m) => m === 'agent.prompt')).toHaveLength(3);
  });

  it('refuses sends outside a user turn', async () => {
    const { tools, calls } = setup();
    const { ok, result } = await tools.run(null, 'send_to_agent', {
      agent_id: 'w1:p1',
      message: 'deploy',
    });
    expect(ok).toBe(false);
    expect(result).toContain('only happen while answering the user');
    expect(calls).toEqual([]);
  });

  it('reports a closed agent without a chip', async () => {
    const { tools, turn } = setup({ promptError: 'agent_not_found' });
    const sent = await tools.run(turn, 'send_to_agent', {
      agent_id: 'w1:p1',
      message: 'hello',
    });
    expect(sent.ok).toBe(false);
    expect(sent.result).toContain('agent_not_found');
    expect(sent.chip).toBeUndefined();
  });

  it('never resends on uncertain delivery', async () => {
    const { tools, turn, methods } = setup({ promptError: 'delivery_unknown' });
    const sent = await tools.run(turn, 'send_to_agent', {
      agent_id: 'w1:p1',
      message: 'hello',
    });
    expect(sent.result).toContain('may have been delivered');
    expect(JSON.parse(sent.result)).toMatchObject({
      uncertain: true,
      agent_id: 'w1:p1',
    });
    expect(methods().filter((m) => m === 'agent.prompt')).toHaveLength(1);
    // A send that may have happened is still shown.
    expect(sent.chip).toEqual({
      kind: 'sent',
      paneId: 'w1:p1',
      title: 'Payments migration',
      uncertain: true,
    });
  });

  it('records a start that failed after opening a tab', async () => {
    const { tools, turn, methods } = setup({ startStatus: 'blocked' });
    const started = await tools.run(turn, 'start_agent', {
      project: 'api',
      first_task: 'compare pricing pages',
    });
    expect(JSON.parse(started.result)).toMatchObject({
      uncertain: true,
      agent_id: 'w1:p2',
    });
    expect(started.chip).toEqual({
      kind: 'started',
      paneId: 'w1:p2',
      title: 'claude-beef',
      uncertain: true,
    });
    expect(methods()).not.toContain('agent.prompt');
  });

  it('stops a start the user cancelled', async () => {
    const turn = { id: 't1', changes: 0, cancelled: false };
    const { tools, methods } = setup({
      onStart: () => (turn.cancelled = true),
    });
    const started = await tools.run(turn, 'start_agent', {
      first_task: 'compare pricing pages',
    });
    expect(methods()).not.toContain('agent.prompt');
    expect(JSON.parse(started.result).first_task).toContain('stopped');
    expect(started.chip?.kind).toBe('started');
    const after = await tools.run(turn, 'send_to_agent', {
      agent_id: 'w1:p1',
      message: 'hi',
    });
    expect(after.ok).toBe(false);
    expect(after.result).toContain('stopped');
  });

  it('starts an agent in a named project and sends its first task once', async () => {
    const { tools, turn, calls } = setup();
    const started = await tools.run(turn, 'start_agent', {
      project: 'api',
      first_task: 'compare pricing pages',
    });
    expect(started.ok).toBe(true);
    expect(calls.find((c) => c.method === 'tab.create')?.params).toMatchObject({
      workspace_id: 'w1',
      focus: false,
      label: 'claude-beef',
    });
    expect(calls.find((c) => c.method === 'agent.start')?.params).toMatchObject(
      {
        pane_id: 'w1:p2',
        kind: 'claude',
        name: 'claude-beef',
      },
    );
    expect(calls.filter((c) => c.method === 'agent.prompt')).toEqual([
      {
        method: 'agent.prompt',
        params: { target: 'w1:p2', text: 'compare pricing pages' },
      },
    ]);
    expect(started.chip).toEqual({
      kind: 'started',
      paneId: 'w1:p2',
      title: 'claude-beef',
    });
    expect(turn.changes).toBe(1);
  });

  it('starts in the home workspace when no project is named', async () => {
    const { tools, turn, calls } = setup();
    const started = await tools.run(turn, 'start_agent', { kind: 'codex' });
    expect(started.ok).toBe(true);
    expect(calls.find((c) => c.method === 'tab.create')?.params).toMatchObject({
      workspace_id: 'w9',
      focus: false,
    });
  });
});
