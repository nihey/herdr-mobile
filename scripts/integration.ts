import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { HerdrClient } from '../bridge/src/socket.js';
import { createBridge } from '../bridge/src/server.js';
import { createActions, defaultStartTiming } from '../bridge/src/actions.js';
import {
  COORDINATOR_INSTRUCTIONS,
  createCoordinator,
  type Conversation,
} from '../bridge/src/hermes/coordinator.js';
import { startFakeModel } from '../bridge/src/hermes/fake-model.js';
import { spawnHost } from '../bridge/src/hermes/host.js';
import { createTools } from '../bridge/src/hermes/tools.js';

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
// Home terminals open here instead of the developer's real home folder.
const fakeHome = mkdtempSync(join(tmpdir(), 'herdr-mobile-home-'));
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
  const app = createBridge({
    token,
    request: client.request.bind(client),
    homeDir: fakeHome,
  });
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
  // Plain terminal in the project: a new tab with a shell, nothing typed.
  const opened = await execute<{
    startTerminal: { paneId: string; tabId: string; ready: boolean };
  }>('mutation($w:ID){startTerminal(workspaceId:$w){paneId tabId ready}}', {
    w: workspaceId,
  });
  const terminal = opened.startTerminal;
  assert.equal(
    terminal.ready,
    true,
    'startTerminal did not wait for the shell.',
  );
  // Home terminals: the first creates the phone workspace, the second reuses it.
  const homeQuery = 'mutation{startTerminal{paneId tabId workspaceId ready}}';
  type Started = {
    startTerminal: {
      paneId: string;
      tabId: string;
      workspaceId: string;
      ready: boolean;
    };
  };
  const firstHome = (await execute<Started>(homeQuery)).startTerminal;
  const secondHome = (await execute<Started>(homeQuery)).startTerminal;
  assert.equal(secondHome.workspaceId, firstHome.workspaceId);
  assert.notEqual(secondHome.tabId, firstHome.tabId);
  const layout = await execute<{
    homeFolder: string;
    session: {
      workspaces: { id: string; label: string }[];
      tabs: { id: string; label: string }[];
      panes: { id: string; cwd: string | null }[];
    };
  }>(
    '{ homeFolder session { workspaces { id label } tabs { id label } panes { id cwd } } }',
  );
  assert.equal(layout.homeFolder, fakeHome);
  assert.equal(
    layout.session.workspaces.filter((w) => w.label === 'phone').length,
    1,
  );
  assert.equal(
    layout.session.workspaces.find((w) => w.id === firstHome.workspaceId)
      ?.label,
    'phone',
  );
  assert.equal(
    layout.session.tabs.find((t) => t.id === terminal.tabId)?.label,
    'terminal',
  );
  const cwdOf = (id: string) =>
    layout.session.panes.find((p) => p.id === id)?.cwd;
  assert.equal(cwdOf(terminal.paneId), '/tmp');
  assert.equal(cwdOf(firstHome.paneId), fakeHome);
  assert.equal(cwdOf(secondHome.paneId), fakeHome);
  // Run a harmless marker in the new shell the way the app's Run does.
  await execute(
    'mutation($id:ID!,$text:String!){sendText(paneId:$id,text:$text){ok}}',
    { id: terminal.paneId, text: "printf '%s\\n' 'HERDR_'TERMINAL_OK" },
  );
  await execute(
    'mutation($id:ID!){sendKeys(target:$id,keys:["enter"],raw:true){ok}}',
    { id: terminal.paneId },
  );
  assert(
    await waitFor(terminal.paneId, (text) =>
      text.split('\n').some((line) => line.trim() === 'HERDR_TERMINAL_OK'),
    ),
    'The new terminal did not run the command.',
  );
  // Any folder: browse to one that is not open in Herdr, start a session there
  // (a new workspace named after it), then a terminal in the same folder (a
  // new tab in that now-open project, not a second workspace).
  const project = join(realpathSync(fakeHome), 'devel', 'notes-app');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(fakeHome, 'devel', '.hidden'));
  const browsed = await execute<{
    folders: { path: string; folders: { name: string; path: string }[] };
  }>('{ folders(path: "~/devel") { path folders { name path } } }');
  assert.deepEqual(browsed.folders.folders, [
    { name: 'notes-app', path: project },
    { name: '.hidden', path: join(dirname(project), '.hidden') },
  ]);
  const before = await execute<{ session: { workspaces: { id: string }[] } }>(
    '{ session { workspaces { id } } }',
  );
  const inFolder = (
    await execute<{
      startSession: { paneId: string; workspaceId: string; ready: boolean };
    }>(
      'mutation($f:String!){startSession(folder:$f,kind:"codex",name:"folder-session"){paneId workspaceId ready}}',
      { f: '~/devel/notes-app' },
    )
  ).startSession;
  assert.equal(inFolder.ready, true, 'The folder session did not start.');
  const folderTerminal = (
    await execute<Started>(
      'mutation($f:String!){startTerminal(folder:$f){paneId tabId workspaceId ready}}',
      { f: project },
    )
  ).startTerminal;
  assert.equal(folderTerminal.workspaceId, inFolder.workspaceId);
  const folderLayout = await execute<{
    session: {
      workspaces: { id: string; label: string }[];
      panes: { id: string; cwd: string | null }[];
    };
  }>('{ session { workspaces { id label } panes { id cwd } } }');
  assert.equal(
    folderLayout.session.workspaces.length,
    before.session.workspaces.length + 1,
  );
  assert.equal(
    folderLayout.session.workspaces.find((w) => w.id === inFolder.workspaceId)
      ?.label,
    'notes-app',
  );
  for (const id of [inFolder.paneId, folderTerminal.paneId])
    assert.equal(
      folderLayout.session.panes.find((p) => p.id === id)?.cwd,
      project,
    );
  // Hermes coordinator: the real host with a scripted fake model (no model
  // calls), acting only on this disposable session through the bridge tools.
  const hermesPython = join(homedir(), '.hermes/hermes-agent/venv/bin/python');
  let hermesSummary = ' Hermes skipped (Hermes is not installed).';
  if (existsSync(hermesPython)) {
    const hermesHome = mkdtempSync(join(tmpdir(), 'herdr-mobile-hermes-'));
    const send = (message: string) => ({
      tool: 'send_to_agent',
      args: { agent_id: sessionPane, message },
    });
    const model = await startFakeModel([
      { tool: 'list_agents' },
      { text: 'One agent is idle.' },
      send('HERMES_SEND_OK'),
      { text: 'Sent.' },
      send('HERMES_CAP_1'),
      send('HERMES_CAP_2'),
      send('HERMES_CAP_3'),
      send('HERMES_CAP_4'),
      { text: 'Sent three.' },
      {
        tool: 'start_agent',
        args: { kind: 'codex', first_task: 'HERMES_START_OK' },
      },
      { text: 'Started.' },
    ]);
    const coordinator = createCoordinator({
      spawn: () =>
        spawnHost({
          python: hermesPython,
          env: { ...process.env, HERMES_HOME: hermesHome },
        }),
      tools: createTools(
        createActions(
          client.request.bind(client),
          defaultStartTiming,
          fakeHome,
        ),
        (kind) => `${kind}-hermes`,
      ),
      stateFile: join(hermesHome, 'bridge-state.json'),
      readCodexConfig: () => null,
      instructions: COORDINATOR_INSTRUCTIONS,
      // A fresh HERMES_HOME makes newer Hermes install its dependencies first.
      startTimeoutMs: 300000,
      model: {
        model: 'fake-model',
        provider: 'custom',
        baseUrl: model.baseUrl,
        apiKey: 'dummy',
      },
    });
    const settle = async (done: (c: Conversation) => boolean) => {
      for (let attempt = 0; attempt < 3000; attempt++) {
        const conversation = coordinator.conversation();
        if (done(conversation)) return conversation;
        await delay(100);
      }
      throw new Error('Hermes did not settle in time.');
    };
    const ask = async (text: string) => {
      coordinator.send(text);
      return (await settle((c) => !c.working)).messages.at(-1);
    };
    const lines = (text: string, value: string) =>
      text.split('\n').filter((line) => line.trim() === `received: ${value}`)
        .length;
    try {
      assert.equal(
        (await settle((c) => c.status !== 'starting')).status,
        'ready',
      );
      await ask('what is running?');
      assert(
        JSON.stringify(model.requests.at(-1)).includes(sessionPane),
        'Hermes did not get the agent list.',
      );
      const sent = await ask('tell it HERMES_SEND_OK');
      assert.deepEqual(
        sent?.chips.map((c) => [c.kind, c.paneId]),
        [['sent', sessionPane]],
      );
      assert(
        await waitFor(
          sessionPane,
          (text) => lines(text, 'HERMES_SEND_OK') === 1,
        ),
      );
      await ask('tell it four things');
      assert(
        await waitFor(sessionPane, (text) => lines(text, 'HERMES_CAP_3') === 1),
      );
      const capped = await readPane(sessionPane);
      assert.equal(
        lines(capped, 'HERMES_CAP_4'),
        0,
        'The fourth send got through.',
      );
      assert(
        JSON.stringify(model.requests.at(-1)).includes(
          'at most 3 agents per request',
        ),
        'Hermes was not told about the limit.',
      );
      const started = await ask('start a codex at home');
      const chip = started?.chips.find((c) => c.kind === 'started');
      assert(chip, 'No started chip.');
      assert(
        await waitFor(
          chip.paneId,
          (text) => lines(text, 'HERMES_START_OK') === 1,
        ),
      );
      const kinds = await execute<{
        session: {
          agents: { kind: string | null }[];
          workspaces: { id: string; label: string }[];
          panes: { id: string; workspaceId: string }[];
        };
      }>(
        '{ session { agents { kind } workspaces { id label } panes { id workspaceId } } }',
      );
      assert(
        !kinds.session.agents.some((a) => a.kind === 'hermes'),
        'Hermes showed up as an agent.',
      );
      const home = kinds.session.workspaces.find((w) => w.label === 'phone');
      assert.equal(
        kinds.session.panes.find((p) => p.id === chip.paneId)?.workspaceId,
        home?.id,
        'Hermes did not start the agent in the home workspace.',
      );
      hermesSummary =
        ' Hermes: list → send once → 3-agent limit → start at home with its first task.';
    } finally {
      coordinator.close();
      await model.close();
      rmSync(hermesHome, { recursive: true, force: true });
    }
  }
  console.log(
    `Live integration passed against Herdr ${session.session.version}: authenticated snapshot → literal terminal text → Enter → captured output; new session tab → agent start → first task; terminal tab → command; home workspace → reused; folder browse → new workspace → its project reused.${hermesSummary}`,
  );
} finally {
  if (client) await client.request('server.stop').catch(() => {});
  // This process belongs only to the unique test session created above.
  if (server.exitCode === null) server.kill('SIGTERM');
  rmSync(fakeBin, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
}
