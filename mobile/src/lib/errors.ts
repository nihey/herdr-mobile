import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
export function errorMessage(error: unknown, mutation = false): string {
  if (CombinedGraphQLErrors.is(error))
    return error.errors.map((item) => item.message).join('\n');
  if (ServerError.is(error) && error.statusCode === 401)
    return 'Pairing token rejected. Forget this connection and pair again with the current token.';
  if (mutation)
    return 'Delivery is uncertain. Read the refreshed terminal before retrying; your action may already have reached Herdr.';
  return 'Cannot reach the bridge. Check Tailscale on both devices, the bridge address, and that the bridge is running.';
}
