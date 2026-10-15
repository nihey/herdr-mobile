import { timingSafeEqual } from 'node:crypto';
import { GraphQLError, NoSchemaIntrospectionCustomRule, visit } from 'graphql';
import { createYoga, type Plugin } from 'graphql-yoga';
import { buildSchema, type RequestHerdr } from './schema.js';
import type { DiscoveredMachine } from './discovery.js';

const MAX_BODY_BYTES = 128 * 1024;
function authenticated(header: string | null, token: string) {
  const candidate = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}
const jsonError = (status: number, message: string) =>
  Response.json({ errors: [{ message }] }, { status });

export function createBridge(options: {
  token: string;
  request: RequestHerdr;
  discover?: () => Promise<DiscoveredMachine[]>;
}) {
  if (options.token.length < 32)
    throw new Error('Bridge token must contain at least 32 characters.');
  const limits: Plugin = {
    onValidate({ params, setResult, addValidationRule }) {
      if (process.env.NODE_ENV !== 'development')
        addValidationRule(NoSchemaIntrospectionCustomRule);
      let fields = 0;
      let fragments = 0;
      let operations = 0;
      visit(params.documentAST, {
        Field() {
          fields++;
        },
        FragmentSpread() {
          fragments++;
        },
        OperationDefinition() {
          operations++;
        },
      });
      if (fields > 100 || fragments > 20 || operations !== 1)
        setResult([new GraphQLError('Request is too complex.')]);
    },
  };
  const yoga = createYoga({
    schema: buildSchema(options.request, options.discover),
    graphqlEndpoint: '/graphql',
    graphiql: false,
    landingPage: false,
    logging: false,
    cors: false,
    batching: false,
    maskedErrors: true,
    plugins: [limits],
  });
  return async (request: Request): Promise<Response> => {
    if (!authenticated(request.headers.get('authorization'), options.token))
      return jsonError(401, 'Invalid pairing token.');
    if (new URL(request.url).pathname !== '/graphql')
      return jsonError(404, 'Use /graphql.');
    if (request.method !== 'POST')
      return jsonError(405, 'Use POST for GraphQL operations.');
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return jsonError(415, 'Use application/json.');
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES)
      return jsonError(413, 'Request is too large.');
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_BODY_BYTES) {
            await reader.cancel();
            return jsonError(413, 'Request is too large.');
          }
          chunks.push(value);
        }
      } catch {
        return jsonError(400, 'Could not read request.');
      }
    }
    const body = Buffer.concat(chunks).toString('utf8');
    try {
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return jsonError(400, 'Send one GraphQL operation.');
    } catch {
      return jsonError(400, 'Invalid JSON.');
    }
    const response = await yoga.fetch(
      new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body,
      }),
    );
    response.headers.set('cache-control', 'no-store');
    return response;
  };
}
