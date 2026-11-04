import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
import { isOutdated } from './sessions';

/**
 * The bridge answered, but Herdr's socket is missing or refused it: Herdr is
 * not running. Other connection failures may be a frozen Herdr and are never
 * offered a start.
 */
export function herdrDown(error: unknown) {
  return (
    CombinedGraphQLErrors.is(error) &&
    error.errors.some((item) => item.extensions?.code === 'not_running')
  );
}

/**
 * Whether the home screen shows the start card: while Herdr is not running,
 * and through a start or its failure even if the poll's error changes
 * meanwhile (e.g. a timeout while Herdr restores). Hidden once agents load.
 */
export function herdrCardVisible(
  error: unknown,
  starting: boolean,
  message: string,
) {
  return !!error && (herdrDown(error) || starting || !!message);
}

/** Why `startHerdr` failed, in words for the home screen. */
export function startHerdrError(error: unknown) {
  if (isOutdated(error))
    return 'Update the bridge on this computer to start Herdr from the phone.';
  if (CombinedGraphQLErrors.is(error))
    return error.errors.map((item) => item.message).join('\n');
  if (ServerError.is(error) && error.statusCode === 401)
    return 'Pairing token rejected. Forget this connection and pair again with the current token.';
  // The bridge never starts a second Herdr, so tapping again is safe.
  return 'Lost the bridge while starting Herdr. Refresh to see whether it came up; tapping start again is safe.';
}
