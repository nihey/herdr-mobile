import { describe, expect, it } from 'vitest';
import { createBridge } from './server.js';
import { HerdrError } from './socket.js';

const token = 'a'.repeat(48);
function setup() {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const app = createBridge({
    token,
    request: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'session.snapshot')
        return {
          snapshot: {
            version: '0.9.4',
            protocol: 22,
            workspaces: [
              { workspace_id: 'w1', label: 'API', agent_status: 'working' },
            ],
            tabs: [],
            agents: [
              {
                pane_id: 'w1:p1',
                workspace_id: 'w1',
                tab_id: 'w1:t1',
                name: 'coder',
                agent: 'codex',
                agent_status: 'working',
              },
            ],
            panes: [],
          },
        };
      if (method === 'agent.read' || method === 'pane.read')
        return { read: { text: 'terminal output' } };
      if (params.text === 'blocked')
        throw new HerdrError('agent_blocked', 'Agent needs input');
      return { type: 'ok' };
    },
  });
  const query = async (
    query: string,
    variables: Record<string, unknown> = {},
    authorized = true,
  ) => {
    const response = await app(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorized ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
  return { calls, query, app };
}
describe('authenticated GraphQL bridge', () => {
  it('limits streamed request bodies even without a content-length header', async () => {
    const { app, calls } = setup();
    const response = await app(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: 'a'.repeat(128 * 1024 + 1),
      }),
    );
    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });
  it('disables schema introspection outside development', async () => {
    const { query, calls } = setup();
    const { body } = await query('{ __schema { types { name } } }');
    expect(body.errors).toBeDefined();
    expect(calls).toHaveLength(0);
  });
  it('rejects unauthorized requests before contacting the daemon', async () => {
    const { calls, query } = setup();
    const result = await query('{ session { version } }', {}, false);
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('maps snapshots to stable public identifiers', async () => {
    const { query } = setup();
    const { body } = await query(
      '{ session { version workspaces { id label } agents { paneId kind status } } }',
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.session.agents[0]).toEqual({
      paneId: 'w1:p1',
      kind: 'codex',
      status: 'working',
    });
    expect(body.data.session.workspaces[0].id).toBe('w1');
  });
  it('maps output reads using the installed schema source enum', async () => {
    const { query, calls } = setup();
    const { body } = await query(
      '{ output(target: "w1:p1", source: RECENT, lines: 120) { text } }',
    );
    expect(body.data.output.text).toBe('terminal output');
    expect(calls[0]).toEqual({
      method: 'agent.read',
      params: {
        target: 'w1:p1',
        source: 'recent_unwrapped',
        lines: 120,
        format: 'text',
        strip_ansi: true,
      },
    });
  });
  it('passes prompt text literally and uses an explicit target', async () => {
    const { query, calls } = setup();
    const text = 'hello "world"\n$(whoami)';
    const { body } = await query(
      'mutation($text: String!) { prompt(target: "w1:p1", text: $text) { ok } }',
      { text },
    );
    expect(body.data.prompt.ok).toBe(true);
    expect(calls).toEqual([
      { method: 'agent.prompt', params: { target: 'w1:p1', text } },
    ]);
  });
  it('validates bounds, keys and startup names before daemon access', async () => {
    const { query, calls } = setup();
    for (const operation of [
      '{ output(target:"w1:p1", lines:9999) { text } }',
      'mutation { sendKeys(target:"w1:p1", keys:["server.stop"]) { ok } }',
      'mutation { startAgent(paneId:"w1:p2", name:"bad name", kind:"codex") { ok } }',
    ]) {
      const { body } = await query(operation);
      expect(body.errors?.[0].extensions.code).toBe('BAD_USER_INPUT');
    }
    expect(calls).toHaveLength(0);
  });
  it('preserves actionable daemon error codes', async () => {
    const { query } = setup();
    const { body } = await query(
      'mutation { prompt(target:"w1:p1", text:"blocked") { ok } }',
    );
    expect(body.errors[0].extensions.code).toBe('agent_blocked');
  });
  it('uses explicit pane APIs for interactive text and keys', async () => {
    const { query, calls } = setup();
    await query(
      'mutation { sendText(paneId:"w1:p1", text:"yes") { ok } sendKeys(target:"w1:p1", keys:["enter"], raw:true) { ok } }',
    );
    expect(calls.map((c) => c.method)).toEqual([
      'pane.send_text',
      'pane.send_keys',
    ]);
  });
  it('rejects excessive query complexity and batched operations', async () => {
    const { query, calls, app } = setup();
    const { body } = await query(
      `{ ${Array.from({ length: 101 }, (_, i) => `a${i}: session { version }`).join(' ')} }`,
    );
    expect(body.errors).toBeDefined();
    expect(calls).toHaveLength(0);
    const response = await app(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify([{ query: '{session {version}}' }]),
      }),
    );
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
