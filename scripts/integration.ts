import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { HerdrClient } from '../bridge/src/socket.js';
import { createBridge } from '../bridge/src/server.js';

// Always create a private named session. Never target the user's default socket.
const name = `herdr-mobile-test-${process.pid}`;
const server = spawn('herdr', ['--session', name, 'server'], {
  stdio: ['ignore', 'pipe', 'pipe'],
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
  const created = await client.request<{ root_pane: { pane_id: string } }>(
    'workspace.create',
    { label: 'Mobile verification', cwd: '/tmp', focus: false },
  );
  const paneId = created.root_pane.pane_id;
  const session = await execute<{
    session: { version: string; panes: { id: string }[] };
  }>('{ session { version panes { id } } }');
  assert(session.session.panes.some((p) => p.id === paneId));
  await delay(400);
  await execute(
    'mutation($id:ID!,$text:String!){sendText(paneId:$id,text:$text){ok}}',
    { id: paneId, text: "printf '%s\\n' 'HERDR_'MOBILE_OK" },
  );
  await execute(
    'mutation($id:ID!){sendKeys(target:$id,keys:["enter"],raw:true){ok}}',
    { id: paneId },
  );
  let matched = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await execute<{ output: { text: string } }>(
      'query($id:ID!){output(target:$id,raw:true,lines:200){text}}',
      { id: paneId },
    );
    if (
      result.output.text
        .split('\n')
        .some((line) => line.trim() === 'HERDR_MOBILE_OK')
    ) {
      matched = true;
      break;
    }
    await delay(100);
  }
  assert(matched, 'Command output did not appear in the selected pane.');
  console.log(
    `Live integration passed against Herdr ${session.session.version}: authenticated snapshot → literal terminal text → Enter → captured output.`,
  );
} finally {
  if (client) await client.request('server.stop').catch(() => {});
  // This process belongs only to the unique test session created above.
  if (server.exitCode === null) server.kill('SIGTERM');
}
