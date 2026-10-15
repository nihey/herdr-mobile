export type Connection = { url: string; token: string };
export function normalizeConnection(
  endpoint: string,
  pairingToken: string,
): Connection {
  let parsed: URL;
  try {
    parsed = new URL(endpoint.trim());
  } catch {
    throw new Error('Enter a full bridge URL, such as http://100.x.x.x:8787.');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !['/', '/graphql', ''].includes(parsed.pathname)
  ) {
    throw new Error(
      'Use an HTTP or HTTPS bridge address without credentials, query parameters, or extra paths.',
    );
  }
  const token = pairingToken.trim();
  if (!token) throw new Error('Enter the pairing token from your computer.');
  return { url: parsed.origin, token };
}
