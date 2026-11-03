import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Test utility: a scripted OpenAI-compatible chat completions server, so the
 * Hermes host can be exercised without any real model call. Each POST to
 * /chat/completions consumes the next step; other requests get 404.
 */
export type FakeStep =
  | { text: string; slowMs?: number }
  | { tool: string; args?: Record<string, unknown> }
  | { status: number; body: unknown };
export type FakeModel = {
  baseUrl: string;
  /** Bodies of the chat completion requests received, in order. */
  requests: Record<string, unknown>[];
  close(): Promise<void>;
};

export async function startFakeModel(steps: FakeStep[]): Promise<FakeModel> {
  const requests: Record<string, unknown>[] = [];
  let next = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      void (async () => {
        if (req.method !== 'POST' || !req.url?.includes('chat/completions')) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end('{}');
          return;
        }
        const body = JSON.parse(raw) as Record<string, unknown>;
        requests.push(body);
        const step = steps[next++];
        if (!step) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end('{"error":{"message":"fake model ran out of steps"}}');
          return;
        }
        if ('status' in step) {
          res.writeHead(step.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(step.body));
          return;
        }
        const id = `chatcmpl-${next}`;
        const model = body.model;
        const chunk = (delta: unknown, finish: string | null = null) => ({
          id,
          object: 'chat.completion.chunk',
          created: 1,
          model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        });
        const call = 'tool' in step && {
          id: `call_${next}`,
          type: 'function',
          function: {
            name: step.tool,
            arguments: JSON.stringify(step.args ?? {}),
          },
        };
        if (!body.stream) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              id,
              object: 'chat.completion',
              created: 1,
              model,
              choices: [
                {
                  index: 0,
                  message: call
                    ? { role: 'assistant', content: null, tool_calls: [call] }
                    : {
                        role: 'assistant',
                        content: (step as { text: string }).text,
                      },
                  finish_reason: call ? 'tool_calls' : 'stop',
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
          );
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (value: unknown) =>
          res.write(`data: ${JSON.stringify(value)}\n\n`);
        if (call) {
          send(
            chunk({ role: 'assistant', tool_calls: [{ index: 0, ...call }] }),
          );
          send(chunk({}, 'tool_calls'));
        } else {
          const { text, slowMs } = step as { text: string; slowMs?: number };
          for (const word of text.split(/(?<= )/)) {
            if (res.destroyed) return;
            send(chunk({ content: word }));
            if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
          }
          send(chunk({}, 'stop'));
        }
        res.write('data: [DONE]\n\n');
        res.end();
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
