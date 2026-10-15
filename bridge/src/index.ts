import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { loadConfig } from './config.js';
import { createBridge } from './server.js';
import { HerdrClient } from './socket.js';

const config = loadConfig();
if (process.argv.includes('--pairing')) {
  console.log(
    `Bridge URL: http://${config.host}:${config.port}\nPairing token: ${config.token}`,
  );
} else {
  const client = new HerdrClient(config.socketPath);
  const app = createBridge({
    token: config.token,
    request: client.request.bind(client),
  });
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000 },
    async (incoming, outgoing) => {
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers))
          if (value)
            headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        const init: RequestInit & { duplex?: 'half' } = {
          method: incoming.method,
          headers,
        };
        if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
          init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
          init.duplex = 'half';
        }
        const response = await app(
          new Request(`http://localhost${incoming.url ?? '/'}`, init),
        );
        outgoing.writeHead(
          response.status,
          Object.fromEntries(response.headers),
        );
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        outgoing.writeHead(500, { 'content-type': 'application/json' });
        outgoing.end('{"errors":[{"message":"Bridge request failed."}]}');
      }
    },
  );
  server.maxConnections = 32;
  server.timeout = 45000;
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
      `Bridge could not listen (${error.code ?? 'unknown'}). Check Tailscale and the configured port.`,
    );
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    console.log(
      `Herdr Mobile bridge: http://${config.host}:${config.port}/graphql\nPairing token file: ${config.tokenFile}\nShow pairing settings: npm run pairing -w bridge\nHerdr socket: ${config.socketPath}`,
    );
  });
  const shutdown = () => {
    server.close();
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
