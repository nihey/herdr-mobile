import { describe, expect, it } from 'vitest';
import { normalizeConnection } from './connection';
describe('connection settings', () => {
  it('normalizes a tailnet origin and trims pasted settings', () => {
    expect(
      normalizeConnection(' http://100.64.0.1:8787/ ', ' token '),
    ).toEqual({ url: 'http://100.64.0.1:8787', token: 'token' });
    expect(
      normalizeConnection('https://desktop.tail123.ts.net/graphql', 'secret')
        .url,
    ).toBe('https://desktop.tail123.ts.net');
  });
  it.each([
    'ftp://host',
    'not-a-host',
    'http://user:pass@host',
    'https://host?token=x',
    'https://host/#token',
    'https://host/other',
  ])('rejects unsafe or ambiguous endpoint %s', (url) => {
    expect(() => normalizeConnection(url, 'secret')).toThrow();
  });
  it('requires a token', () => {
    expect(() => normalizeConnection('http://host:8787', ' ')).toThrow('token');
  });
});
