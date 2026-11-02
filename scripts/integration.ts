import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { HerdrClient } from '../bridge/src/socket.js';
import { createBridge } from '../bridge/src/server.js';

// Always create a private named session. Never target the user's default socket.
const name = `herdr-mobile-test-${process.pid}`;
// A stand-in `codex` first on PATH lets startSession launch an "agent" that only
// echoes its input. Panes use plain /bin/sh so no shell startup script can put
// a real agent CLI ahead of it; both are verified before anything is sent.
const fakeBin = mkdtempSync(join(tmpdir(), 'herdr-mobile-fake-'));
writeFileSync(
  join(fakeBin, 'codex'),
  [
    '#!/bin/sh',
    // Herdr's codex manifest reads a plain terminal title as idle.
    "printf '\\033]0;codex stand-in\\007\\n  Codex test stand-in\\n\\n'",
    "while printf '> ' && IFS= read -r line; do printf 'received: %s\\n' \"$line\"; done",
    '',
  ].join('\n'),
);
chmodSync(join(fakeBin, 'codex'), 0o755);
// Like a slow ~/.bashrc: the shell runs a child for a second before its prompt,
// so startSession has to wait for the shell to be available.
writeFileSync(join(fakeBin, 'shrc'), 'sleep 1\n');
const env: NodeJS.ProcessEnv = {
  ...process.env,
  SHELL: '/bin/sh',
  ENV: join(fakeBin, 'shrc'),
  PATH: `${fakeBin}:${process.env.PATH}`,
};
const server = spawn('herdr', ['--session', name, 'server'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env,
});
let client: HerdrClient | undefined;
try {
  const socketPath = await new Promise<string>((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error('Test server did not announce its socket.')),
      10000,
    );
    const read = (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = /api socket: (.+)\n/.exec(buffer);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1].trim());
      }
    };
    server.stdout.on('data', read);
    server.stderr.on('data', read);
    server.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Test server exited (${code}).`));
    });
  });
  assert(socketPath.includes(`/sessions/${name}/`));
  client = new HerdrClient(socketPath);
  const token = randomBytes(32).toString('hex');
  const app = createBridge({ token, request: client.request.bind(client) });
  const execute = async <T>(query: string, variables = {}) => {
    const response = await app(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables }),
      }),
    );
    const result = (await response.json()) as {
      data?: T;
      errors?: { message: string }[];
    };
    assert.equal(result.errors, undefined, JSON.stringify(result.errors));
    assert(result.data);
    return result.data;
  };
  const readPane = async (id: string) =>
    (
      await execute<{ output: { text: string } }>(
        'query($id:ID!){output(target:$id,raw:true,lines:200){text}}',
        { id },
      )
    ).output.text;
  const waitFor = async (id: string, found: (text: string) => boolean) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (found(await readPane(id))) return true;
      await delay(100);
    }
    return false;
  };
  const created = await client.request<{
    root_pane: { pane_id: string };
    workspace: { workspace_id: string };
  }>('workspace.create', {
    label: 'Mobile verification',
    cwd: '/tmp',
    focus: false,
  });
  const paneId = created.root_pane.pane_id;
  const session = await execute<{
    session: { version: string; panes: { id: string }[] };
  }>('{ session { version panes { id } } }');
  assert(session.session.panes.some((p) => p.id === paneId));
  // Type only once the shell idles alone at its prompt.
  for (let attempt = 0; attempt < 50; attempt++) {
    const { process_info: info } = await client.request<{
      process_info: {
        shell_pid: number;
        foreground_processes: { pid: number }[];
      };
    }>('pane.process_info', { pane_id: paneId });
    if (
      info.foreground_processes.length === 1 &&
      info.foreground_processes[0]?.pid === info.shell_pid
    )
      break;
    await delay(100);
  }
  await delay(300);
  await execute(
    'mutation($id:ID!,$text:String!){sendText(paneId:$id,text:$text){ok}}',
    { id: paneId, text: "printf '%s\\n' 'HERDR_'MOBILE_OK" },
  );
  await execute(
    'mutation($id:ID!){sendKeys(target:$id,keys:["enter"],raw:true){ok}}',
    { id: paneId },
  );
  assert(
    await waitFor(paneId, (text) =>
      text.split('\n').some((line) => line.trim() === 'HERDR_MOBILE_OK'),
    ),
    'Command output did not appear in the selected pane.',
  );

  // Refuse to start anything unless `codex` resolves to the stand-in.
  await execute(
    'mutation($id:ID!,$text:String!){sendText(paneId:$id,text:$text){ok}}',
    { id: paneId, text: 'echo "RESOLVED=$(command -v codex)"' },
  );
  await execute(
    'mutation($id:ID!){sendKeys(target:$id,keys:["enter"],raw:true){ok}}',
    { id: paneId },
  );
  assert(
    await waitFor(paneId, (text) =>
      text
        .split('\n')
        .some((line) => line.trim() === `RESOLVED=${fakeBin}/codex`),
    ),
    'codex does not resolve to the test stand-in; refusing to start an agent.',
  );

  // New session in the existing workspace: new tab in its folder + agent.
  const workspaceId = created.workspace.workspace_id;
  const options = await execute<{
    agentKinds: string[];
    session: { workspaces: { id: string; cwd: string | null }[] };
  }>('{ agentKinds session { workspaces { id cwd } } }');
  assert(options.agentKinds.includes('codex'));
  assert.equal(
    options.session.workspaces.find((w) => w.id === workspaceId)?.cwd,
    '/tmp',
  );
  const started = await execute<{
    startSession: { paneId: string; tabId: string; ready: boolean };
  }>(
    'mutation($w:ID!){startSession(workspaceId:$w,kind:"codex",name:"mobile-session"){paneId tabId ready}}',
    { w: workspaceId },
  );
  const { paneId: sessionPane, tabId, ready } = started.startSession;
  assert.equal(ready, true, 'startSession did not wait for agent readiness.');
  assert.notEqual(sessionPane, paneId);
  const after = await execute<{
    session: {
      agents: { paneId: string; name: string | null }[];
      tabs: { id: string; workspaceId: string; label: string }[];
      panes: { id: string; cwd: string | null }[];
    };
  }>(
    '{ session { agents { paneId name } tabs { id workspaceId label } panes { id cwd } } }',
  );
  assert(
    after.session.agents.some(
      (a) => a.paneId === sessionPane && a.name === 'mobile-session',
    ),
  );
  assert(
    after.session.tabs.some(
      (t) =>
        t.id === tabId &&
        t.workspaceId === workspaceId &&
        t.label === 'mobile-session',
    ),
  );
  assert.equal(
    after.session.panes.find((p) => p.id === sessionPane)?.cwd,
    '/tmp',
  );
  // Only prompt the stand-in, identified by its own banner.
  assert(
    await waitFor(sessionPane, (text) => text.includes('Codex test stand-in')),
    'The new session is not the test stand-in; no prompt was sent.',
  );
  await execute('mutation($p:ID!){prompt(target:$p,text:"first task"){ok}}', {
    p: sessionPane,
  });
  assert(
    await waitFor(sessionPane, (text) => text.includes('received: first task')),
    'The new session did not receive its first task.',
  );
  console.log(
    `Live integration passed against Herdr ${session.session.version}: authenticated snapshot → literal terminal text → Enter → captured output; new session tab → agent start → first task.`,
  );
} finally {
  if (client) await client.request('server.stop').catch(() => {});
  // This process belongs only to the unique test session created above.
  if (server.exitCode === null) server.kill('SIGTERM');
  rmSync(fakeBin, { recursive: true, force: true });
}
