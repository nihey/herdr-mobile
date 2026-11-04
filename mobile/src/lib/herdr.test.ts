import { describe, expect, it } from 'vitest';
import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
import { herdrCardVisible, herdrDown, startHerdrError } from './herdr';

const graphql = (message: string, code?: string) =>
  new CombinedGraphQLErrors({
    errors: [{ message, ...(code ? { extensions: { code } } : {}) }],
  });

describe('Herdr not running', () => {
  it('is the bridge reporting a missing or refused Herdr socket', () => {
    expect(herdrDown(graphql('Cannot connect to Herdr.', 'not_running'))).toBe(
      true,
    );
  });
  it('is not any other connection failure, which may be a frozen Herdr', () => {
    expect(herdrDown(graphql('Cannot connect to Herdr.', 'unavailable'))).toBe(
      false,
    );
  });
  it('is not a slow Herdr, another failure or an unreachable bridge', () => {
    expect(
      herdrDown(graphql('Herdr did not respond in time.', 'timeout')),
    ).toBe(false);
    expect(herdrDown(graphql('Something else.'))).toBe(false);
    expect(herdrDown(new Error('Network request failed'))).toBe(false);
    expect(herdrDown(undefined)).toBe(false);
  });
});

describe('start failures', () => {
  it("shows the bridge's own reason", () => {
    expect(
      startHerdrError(
        graphql('Herdr is running but not responding.', 'herdr_not_responding'),
      ),
    ).toBe('Herdr is running but not responding.');
  });
  it('asks for a bridge update when the bridge predates starting Herdr', () => {
    expect(
      startHerdrError(
        graphql('Cannot query field "startHerdr" on type "Mutation".'),
      ),
    ).toMatch(/update the bridge/i);
  });
  it('says a lost connection is safe to retry by hand', () => {
    expect(startHerdrError(new Error('Network request failed'))).toMatch(
      /refresh/i,
    );
  });
  it('keeps the rejected token message', () => {
    const rejected = new ServerError('Unauthorized', {
      response: new Response(null, { status: 401 }),
      bodyText: '',
    });
    expect(startHerdrError(rejected)).toMatch(/pairing token rejected/i);
  });
});

describe('the start card', () => {
  const down = graphql('Cannot connect to Herdr.', 'not_running');
  const slow = graphql('Herdr did not respond in time.', 'timeout');
  it('shows while Herdr is not running', () => {
    expect(herdrCardVisible(down, false, '')).toBe(true);
  });
  it('stays while starting or with a failure, even if the poll error changes', () => {
    expect(herdrCardVisible(slow, true, '')).toBe(true);
    expect(herdrCardVisible(slow, false, 'Could not start Herdr.')).toBe(true);
  });
  it('hides once the agents load again', () => {
    expect(herdrCardVisible(undefined, true, '')).toBe(false);
    expect(herdrCardVisible(undefined, false, 'Could not start Herdr.')).toBe(
      false,
    );
  });
  it('is not offered for other failures', () => {
    expect(herdrCardVisible(slow, false, '')).toBe(false);
  });
});
