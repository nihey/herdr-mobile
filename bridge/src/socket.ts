import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';

export class HerdrError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class HerdrClient {
  constructor(
    private readonly path: string,
    private readonly options: { timeoutMs?: number; maxBytes?: number } = {},
  ) {}

  request<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = this.options.timeoutMs ?? 8000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const payload = Buffer.from(
        JSON.stringify({ id, method, params }) + '\n',
      );
      if (payload.length > 128 * 1024) {
        reject(new HerdrError('bad_request', 'Request is too large.'));
        return;
      }
      const socket = connect(this.path);
      const mutation = ![
        'ping',
        'session.snapshot',
        'agent.list',
        'agent.read',
        'pane.read',
      ].includes(method);
      let sent = false;
      let settled = false;
      let chunks: Buffer[] = [];
      let size = 0;
      const finish = (error?: HerdrError, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        chunks = [];
        socket.destroy();
        if (error) reject(error);
        else resolve(value as T);
      };
      const transportFailure = (code: string, message: string) =>
        finish(
          new HerdrError(
            sent && mutation ? 'delivery_unknown' : code,
            sent && mutation
              ? 'Delivery is uncertain. Refresh the terminal before retrying; the action may already have reached Herdr.'
              : message,
          ),
        );
      const timer = setTimeout(
        () => transportFailure('timeout', 'Herdr did not respond in time.'),
        timeoutMs,
      );
      socket.once('connect', () => {
        sent = true;
        socket.write(payload);
      });
      socket.on('error', () =>
        transportFailure(
          'unavailable',
          'Cannot connect to Herdr. Check that its server is running and the socket path is correct.',
        ),
      );
      socket.on('end', () =>
        transportFailure(
          'connection_closed',
          'Herdr closed the connection before responding.',
        ),
      );
      socket.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (this.options.maxBytes ?? 8 * 1024 * 1024)) {
          transportFailure(
            'response_too_large',
            'Herdr response exceeded the size limit.',
          );
          return;
        }
        const end = chunk.indexOf(10);
        chunks.push(end < 0 ? chunk : chunk.subarray(0, end));
        if (end < 0) return;
        try {
          const frame = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            id?: string;
            result?: T;
            error?: { code: string; message: string };
          };
          if (frame.id !== id || (!frame.error && frame.result === undefined)) {
            transportFailure(
              'invalid_response',
              'Herdr returned an unexpected response.',
            );
            return;
          }
          if (frame.error)
            finish(new HerdrError(frame.error.code, frame.error.message));
          else finish(undefined, frame.result);
        } catch {
          transportFailure('invalid_response', 'Herdr returned invalid JSON.');
        }
      });
    });
  }
}
