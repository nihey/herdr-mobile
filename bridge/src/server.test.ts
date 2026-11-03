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
                terminal_title_stripped: '✳ Fix login',
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
function sessionSetup({
  failStart = '',
  shellBusyPolls = 0,
  settled = 'idle',
  processInfoFails = false,
  manifestsFail = false,
  agentProcess = true,
  totalMs = 9000,
  homeWorkspace = false,
}: {
  failStart?: string;
  shellBusyPolls?: number;
  /** Agent state agent.get reports after start; 'gone' = agent_not_found. */
  settled?: string;
  processInfoFails?: boolean;
  manifestsFail?: boolean;
  /** Whether the launched CLI keeps running in the pane's foreground. */
  agentProcess?: boolean;
  totalMs?: number;
  /** Whether a `phone` workspace (whose shell has left the home folder) exists. */
  homeWorkspace?: boolean;
} = {}) {
  let busyPolls = shellBusyPolls;
  let started = false;
  const calls: {
    method: string;
    params: Record<string, unknown>;
    timeoutMs?: number;
  }[] = [];
  const app = createBridge({
    token,
    homeDir: '/home/tester',
    startTiming: {
      pollMs: 1,
      settleMs: 0,
      shellTimeoutMs: 1000,
      exitGraceMs: 0,
      totalMs,
    },
    request: async (method, params = {}, timeoutMs) => {
      if (method === 'pane.process_info') {
        calls.push({ method, params });
        if (processInfoFails)
          throw new HerdrError('unsupported', 'process info unavailable');
        // Startup scripts run as children of the shell, then it idles alone
        // until the agent CLI runs in the foreground.
        const busy = busyPolls-- > 0 || (started && agentProcess);
        return {
          process_info: {
            shell_pid: 10,
            foreground_process_group_id: 10,
            foreground_processes: busy
              ? [
                  { pid: 10, name: 'bash' },
                  { pid: 11, name: 'conda' },
                ]
              : [{ pid: 10, name: 'bash' }],
          },
        };
      }
      calls.push(
        timeoutMs === undefined
          ? { method, params }
          : { method, params, timeoutMs },
      );
      if (method === 'session.snapshot')
        return {
          snapshot: {
            version: '0.9.4',
            protocol: 22,
            workspaces: [
              { workspace_id: 'w1', label: 'API', agent_status: 'working' },
              { workspace_id: 'w2', label: 'Site', agent_status: 'idle' },
              { workspace_id: 'w3', label: 'Empty', agent_status: 'idle' },
              ...(homeWorkspace
                ? [{ workspace_id: 'w7', label: 'phone', agent_status: 'idle' }]
                : []),
            ],
            tabs: [],
            agents: [
              {
                pane_id: 'w2:p1',
                workspace_id: 'w2',
                name: 'taken',
                agent: 'claude',
                agent_status: 'idle',
              },
            ],
            panes: [
              {
                pane_id: 'w1:p1',
                workspace_id: 'w1',
                tab_id: 'w1:t1',
                cwd: '/work/api',
                foreground_cwd: '/work/api/src',
                agent_status: 'working',
              },
              {
                pane_id: 'w1:p2',
                workspace_id: 'w1',
                tab_id: 'w1:t2',
                cwd: '/elsewhere',
                agent_status: 'idle',
              },
              {
                pane_id: 'w2:p1',
                workspace_id: 'w2',
                tab_id: 'w2:t1',
                cwd: null,
                foreground_cwd: '/work/site',
                agent_status: 'idle',
              },
              ...(homeWorkspace
                ? [
                    {
                      pane_id: 'w7:p1',
                      workspace_id: 'w7',
                      tab_id: 'w7:t1',
                      cwd: '/work/elsewhere',
                      agent_status: 'idle',
                    },
                  ]
                : []),
            ],
          },
        };
      if (method === 'workspace.create')
        return {
          type: 'workspace_created',
          workspace: { workspace_id: 'w8', label: params.label },
          tab: { tab_id: 'w8:t1', workspace_id: 'w8' },
          root_pane: { pane_id: 'w8:p1' },
        };
      if (method === 'server.agent_manifests' && manifestsFail)
        throw new HerdrError('unavailable', 'manifests unavailable');
      if (method === 'server.agent_manifests')
        return {
          manifests: [
            { agent: 'claude' },
            { agent: 'codex' },
            { agent: 'claude' },
            { agent: 'Bad Kind' },
            { agent: 42 },
            { agent: 'pi' },
          ],
        };
      if (method === 'tab.create')
        return {
          type: 'tab_created',
          tab: { tab_id: 'w1:t9', workspace_id: params.workspace_id },
          root_pane: { pane_id: 'w1:p9' },
        };
      if (method === 'agent.start' && failStart === 'missing')
        throw new HerdrError('agent_not_found', 'claude is not installed');
      if (method === 'agent.start' && failStart === 'blocked')
        throw new HerdrError('agent_not_ready', 'claude is blocked');
      if (method === 'agent.start') started = true;
      if (method === 'agent.get') {
        if (settled === 'gone')
          throw new HerdrError('agent_not_found', 'agent target not found');
        return {
          type: 'agent_info',
          agent: {
            agent_status: settled,
            launch_pending: settled === 'unknown',
          },
        };
      }
      return { type: 'ok' };
    },
  });
  const query = async (query: string) => {
    const response = await app(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query }),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
  return { calls, query };
}
function outputSetup({
  maxOffset,
  refuseRecent = false,
}: {
  /** The pane's scrollback (pane.get scroll.max_offset_from_bottom). */
  maxOffset: number | null;
  /** Herdr refuses recent reads of a working full-screen app. */
  refuseRecent?: boolean;
}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const app = createBridge({
    token,
    request: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'pane.get') {
        if (maxOffset === null) throw new HerdrError('pane_not_found', 'nope');
        return {
          type: 'pane_info',
          pane: {
            pane_id: params.pane_id,
            scroll: {
              offset_from_bottom: 0,
              max_offset_from_bottom: maxOffset,
              viewport_rows: 40,
            },
          },
        };
      }
      if (params.source !== 'visible' && refuseRecent)
        throw new HerdrError(
          'agent_not_idle',
          'cannot read 300 lines while w1:p1 is working: its alternate-screen history can only be captured by scrolling while idle.',
        );
      return { read: { text: `${params.source} text` } };
    },
  });
  const query = async (raw: boolean) => {
    const response = await app(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: `{ output(target: "w1:p1", source: RECENT, lines: 300, raw: ${raw}) { text } }`,
        }),
      }),
    );
    return (await response.json()) as {
      data?: { output: { text: string } };
      errors?: unknown[];
    };
  };
  const reads = () =>
    calls
      .filter((c) => c.method === 'agent.read' || c.method === 'pane.read')
      .map((c) => c.params.source);
  return { query, reads };
}
describe('authenticated GraphQL bridge', () => {
  it('requires authentication before discovery and returns only declared fields', async () => {
    let discoveries = 0;
    const app = createBridge({
      token,
      request: async () => {
        throw new Error('No Herdr access expected');
      },
      discover: async () => {
        discoveries++;
        return [
          {
            id: 'device',
            name: 'Laptop',
            dnsName: 'laptop.example.ts.net',
            os: 'linux',
            addresses: ['100.64.0.1'],
            online: true,
            self: false,
          },
        ];
      },
    });
    const body = JSON.stringify({
      query:
        '{ discoveredMachines { id name dnsName os addresses online self } }',
    });
    const unauthorized = await app(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(unauthorized.status).toBe(401);
    expect(discoveries).toBe(0);
    const response = await app(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body,
      }),
    );
    expect((await response.json()).data.discoveredMachines[0]).toMatchObject({
      id: 'device',
      name: 'Laptop',
    });
    expect(discoveries).toBe(1);
  });
  it('returns useful discovery errors without leaking underlying failures', async () => {
    for (const failure of [
      new HerdrError(
        'TAILSCALE_UNAVAILABLE',
        'Connect Tailscale on this computer.',
      ),
      new Error('sensitive stderr'),
    ]) {
      const app = createBridge({
        token,
        request: async () => ({}),
        discover: async () => {
          throw failure;
        },
      });
      const response = await app(
        new Request('http://localhost/graphql', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ query: '{discoveredMachines{id}}' }),
        }),
      );
      const body = await response.json();
      expect(body.errors[0].extensions.code).toBe('TAILSCALE_UNAVAILABLE');
      expect(JSON.stringify(body)).not.toContain('sensitive stderr');
    }
  });
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
      '{ session { version workspaces { id label } agents { paneId kind status title } } }',
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.session.agents[0]).toEqual({
      paneId: 'w1:p1',
      kind: 'codex',
      status: 'working',
      title: '✳ Fix login',
    });
    expect(body.data.session.workspaces[0].id).toBe('w1');
  });
  it('reads the screen of a full-screen app instead of scrolling it for history', async () => {
    for (const raw of [false, true]) {
      const { query, reads } = outputSetup({ maxOffset: 0 });
      const body = await query(raw);
      expect(body.errors).toBeUndefined();
      expect(body.data?.output.text).toBe('visible text');
      expect(reads()).toEqual(['visible']);
    }
  });
  it('reads recent history when the pane has scrollback', async () => {
    const { query, reads } = outputSetup({ maxOffset: 162 });
    const body = await query(false);
    expect(body.data?.output.text).toBe('recent_unwrapped text');
    expect(reads()).toEqual(['recent_unwrapped']);
  });
  it('shows the screen when Herdr refuses a working full-screen read', async () => {
    const { query, reads } = outputSetup({
      maxOffset: null,
      refuseRecent: true,
    });
    const body = await query(false);
    expect(body.errors).toBeUndefined();
    expect(body.data?.output.text).toBe('visible text');
    expect(reads()).toEqual(['recent_unwrapped', 'visible']);
  });
  it('maps output reads using the installed schema source enum', async () => {
    const { query, calls } = setup();
    const { body } = await query(
      '{ output(target: "w1:p1", source: RECENT, lines: 120) { text } }',
    );
    expect(body.data.output.text).toBe('terminal output');
    expect(calls.find((c) => c.method === 'agent.read')).toEqual({
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
  it('exposes each workspace project folder from its first pane', async () => {
    const { query } = sessionSetup();
    const { body } = await query('{ session { workspaces { id cwd } } }');
    expect(body.errors).toBeUndefined();
    expect(body.data.session.workspaces).toEqual([
      { id: 'w1', cwd: '/work/api' },
      { id: 'w2', cwd: '/work/site' },
      { id: 'w3', cwd: null },
    ]);
  });
  it('lists validated agent kinds from Herdr manifests', async () => {
    const { query, calls } = sessionSetup();
    const { body } = await query('{ agentKinds }');
    expect(body.errors).toBeUndefined();
    expect(body.data.agentKinds).toEqual(['claude', 'codex', 'pi']);
    expect(calls.map((c) => c.method)).toEqual(['server.agent_manifests']);
  });
  it('starts a session in a new unfocused tab in the project folder', async () => {
    const { query, calls } = sessionSetup();
    const { body } = await query(
      'mutation { startSession(workspaceId:"w1", kind:"claude", name:"claude-2") { paneId tabId workspaceId name kind ready } }',
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.startSession).toEqual({
      paneId: 'w1:p9',
      tabId: 'w1:t9',
      workspaceId: 'w1',
      name: 'claude-2',
      kind: 'claude',
      ready: true,
    });
    expect(calls).toEqual([
      { method: 'session.snapshot', params: {} },
      {
        method: 'tab.create',
        params: {
          workspace_id: 'w1',
          label: 'claude-2',
          focus: false,
          cwd: '/work/api',
        },
      },
      { method: 'pane.process_info', params: { pane_id: 'w1:p9' } },
      {
        method: 'agent.start',
        params: {
          pane_id: 'w1:p9',
          name: 'claude-2',
          kind: 'claude',
          timeout_ms: 25000,
        },
        timeoutMs: 30000,
      },
      { method: 'agent.get', params: { target: 'w1:p9' } },
    ]);
  });
  it('reports a launched CLI that exits back to the shell', async () => {
    const { query } = sessionSetup({ settled: 'unknown', agentProcess: false });
    const { body } = await query(
      'mutation { startSession(workspaceId:"w1", kind:"gemini", name:"gemini-1") { paneId } }',
    );
    expect(body.errors[0].extensions).toMatchObject({
      code: 'agent_not_found',
      paneId: 'w1:p9',
    });
    expect(body.errors[0].message).toContain('gemini exited');
  });
  it('reports an agent that Herdr no longer knows after launching', async () => {
    const { query } = sessionSetup({ settled: 'gone' });
    const { body } = await query(
      'mutation { startSession(workspaceId:"w1", kind:"claude", name:"claude-2") { paneId } }',
    );
    expect(body.errors[0].extensions).toMatchObject({
      code: 'agent_not_found',
      paneId: 'w1:p9',
      tabId: 'w1:t9',
    });
    expect(body.errors[0].message).toContain('claude');
  });
  it('still starts the agent when the shell check is unavailable', async () => {
    const { query, calls } = sessionSetup({ processInfoFails: true });
    const { body } = await query(
      'mutation { startSession(workspaceId:"w1", kind:"claude", name:"claude-2") { paneId ready } }',
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.startSession).toEqual({ paneId: 'w1:p9', ready: true });
    expect(calls.map((c) => c.method)).toContain('agent.start');
  });
  it('rejects a name another live agent uses before opening a tab', async () => {
    const { query, calls } = sessionSetup();
    const { body } = await query(
      'mutation { startSession(workspaceId:"w1", kind:"claude", name:"taken") { paneId } }',
    );
    expect(body.errors?.[0].extensions.code).toBe('BAD_USER_INPUT');
    expect(calls.map((c) => c.method)).toEqual(['session.snapshot']);
  });
  it('lists no kinds rather than failing when manifests are unavailable', async () => {
    const { query } = sessionSetup({ manifestsFail: true });
    const { body } = await query('{ agentKinds }');
    expect(body.errors).toBeUndefined();
    expect(body.data.agentKinds).toEqual([]);
  });
  it('reports a session that is still starting without failing', async () => {
    const { query } = sessionSetup({ settled: 'unknown', totalMs: 30 });
    const { body } = await query(
      'mutation { startSession(workspaceId:"w1", kind:"claude", name:"claude-2") { paneId ready } }',
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.startSession).toEqual({ paneId: 'w1:p9', ready: false });
  });
  it('reports an agent that stops at a question after starting', async () => {
    const { query } = sessionSetup({ settled: 'blocked' });
    const { body } = await query(
      'mutation { startSession(workspaceId:"w1", kind:"claude", name:"claude-2") { paneId } }',
    );
    expect(body.errors[0].extensions).toMatchObject({
      code: 'agent_not_ready',
      paneId: 'w1:p9',
    });
  });
  it('waits for the new shell to finish its startup scripts', async () => {
    const { query, calls } = sessionSetup({ shellBusyPolls: 3 });
    const { body } = await query(
      'mutation { startSession(workspaceId:"w1", kind:"claude", name:"claude-2") { paneId } }',
    );
    expect(body.errors).toBeUndefined();
    const methods = calls.map((c) => c.method);
    expect(methods.filter((m) => m === 'pane.process_info')).toHaveLength(4);
    expect(methods.slice(-2)).toEqual(['agent.start', 'agent.get']);
  });
  it('reports an agent waiting for input during startup', async () => {
    const { query } = sessionSetup({ failStart: 'blocked' });
    const { body } = await query(
      'mutation { startSession(workspaceId:"w1", kind:"claude", name:"claude-2") { paneId } }',
    );
    expect(body.errors[0].extensions).toMatchObject({
      code: 'agent_not_ready',
      paneId: 'w1:p9',
    });
    expect(body.errors[0].message).toContain('waiting for input');
  });
  it('lets Herdr choose the folder when the project has none', async () => {
    const { query, calls } = sessionSetup();
    await query(
      'mutation { startSession(workspaceId:"w3", kind:"codex", name:"codex-1") { paneId } }',
    );
    expect(calls[1]?.params).toEqual({
      workspace_id: 'w3',
      label: 'codex-1',
      focus: false,
    });
  });
  it('reports the home folder', async () => {
    const { query } = sessionSetup();
    const { body } = await query('{ homeFolder }');
    expect(body.errors).toBeUndefined();
    expect(body.data.homeFolder).toBe('/home/tester');
  });
  it('opens a plain terminal in a new unfocused tab in the project folder', async () => {
    const { query, calls } = sessionSetup();
    const { body } = await query(
      'mutation { startTerminal(workspaceId:"w1") { paneId tabId workspaceId ready } }',
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.startTerminal).toEqual({
      paneId: 'w1:p9',
      tabId: 'w1:t9',
      workspaceId: 'w1',
      ready: true,
    });
    expect(calls.map((c) => c.method)).toEqual([
      'session.snapshot',
      'tab.create',
      'pane.process_info',
    ]);
    expect(calls[1]?.params).toEqual({
      workspace_id: 'w1',
      label: 'terminal',
      focus: false,
      cwd: '/work/api',
    });
    expect(
      calls.some((c) => /^agent\.|send_text|send_keys/.test(c.method)),
    ).toBe(false);
  });
  it('creates the phone workspace in the home folder for the first home terminal', async () => {
    const { query, calls } = sessionSetup();
    const { body } = await query(
      'mutation { startTerminal { paneId tabId workspaceId ready } }',
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.startTerminal).toEqual({
      paneId: 'w8:p1',
      tabId: 'w8:t1',
      workspaceId: 'w8',
      ready: true,
    });
    expect(calls.find((c) => c.method === 'workspace.create')?.params).toEqual({
      label: 'phone',
      cwd: '/home/tester',
      focus: false,
    });
    expect(calls.some((c) => c.method === 'tab.create')).toBe(false);
  });
  it("reuses the phone workspace whatever its panes' folders", async () => {
    const { query, calls } = sessionSetup({ homeWorkspace: true });
    const { body } = await query('mutation { startTerminal { workspaceId } }');
    expect(body.errors).toBeUndefined();
    expect(body.data.startTerminal.workspaceId).toBe('w7');
    expect(calls.some((c) => c.method === 'workspace.create')).toBe(false);
    expect(calls.find((c) => c.method === 'tab.create')?.params).toEqual({
      workspace_id: 'w7',
      label: 'terminal',
      focus: false,
      cwd: '/home/tester',
    });
  });
  it('starts an agent session in the home workspace when no project is given', async () => {
    const { query, calls } = sessionSetup({ homeWorkspace: true });
    const { body } = await query(
      'mutation { startSession(kind:"claude", name:"claude-9") { workspaceId ready } }',
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.startSession).toEqual({ workspaceId: 'w7', ready: true });
    expect(calls.find((c) => c.method === 'tab.create')?.params).toMatchObject({
      workspace_id: 'w7',
      cwd: '/home/tester',
    });
  });
  it('reports a terminal whose shell is still busy as not ready', async () => {
    const { query } = sessionSetup({ shellBusyPolls: 100000 });
    const { body } = await query(
      'mutation { startTerminal(workspaceId:"w1") { ready } }',
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.startTerminal.ready).toBe(false);
  });
  it('reports not ready when the shell cannot be checked', async () => {
    const { query } = sessionSetup({ processInfoFails: true });
    const { body } = await query(
      'mutation { startTerminal(workspaceId:"w1") { ready } }',
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.startTerminal.ready).toBe(false);
  });
  it('rejects an unknown project before opening a terminal', async () => {
    const { query, calls } = sessionSetup();
    const { body } = await query(
      'mutation { startTerminal(workspaceId:"w404") { paneId } }',
    );
    expect(body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    expect(calls.some((c) => c.method === 'tab.create')).toBe(false);
  });
  it('validates new sessions before opening a tab', async () => {
    const { query, calls } = sessionSetup();
    for (const operation of [
      'mutation { startSession(workspaceId:"w1", kind:"claude", name:"Bad Name") { paneId } }',
      'mutation { startSession(workspaceId:"w1", kind:"rm -rf", name:"ok") { paneId } }',
      'mutation { startSession(workspaceId:"", kind:"claude", name:"ok") { paneId } }',
    ]) {
      const { body } = await query(operation);
      expect(body.errors?.[0].extensions.code).toBe('BAD_USER_INPUT');
    }
    expect(calls).toHaveLength(0);
    const { body } = await query(
      'mutation { startSession(workspaceId:"gone", kind:"claude", name:"ok") { paneId } }',
    );
    expect(body.errors?.[0].extensions.code).toBe('BAD_USER_INPUT');
    expect(calls.map((c) => c.method)).toEqual(['session.snapshot']);
  });
  it('reports the opened pane when the agent fails to start', async () => {
    const { query, calls } = sessionSetup({ failStart: 'missing' });
    const { body } = await query(
      'mutation { startSession(workspaceId:"w1", kind:"claude", name:"claude-2") { paneId } }',
    );
    expect(body.errors[0].extensions).toMatchObject({
      code: 'agent_not_found',
      paneId: 'w1:p9',
      tabId: 'w1:t9',
    });
    expect(body.errors[0].message).toContain('claude is not installed');
    expect(calls.map((c) => c.method)).toEqual([
      'session.snapshot',
      'tab.create',
      'pane.process_info',
      'agent.start',
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
