import { describe, expect, it } from 'vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import {
  attentionOrder,
  cleanTitle,
  kindChoices,
  listedProjects,
  shortPath,
  suggestName,
  terminalsSupported,
  validAgentName,
} from './sessions';
import { clearHandoff, handOff, peekHandoff } from './handoff';
import type { Agent } from './types';

const agent = (
  paneId: string,
  workspaceId: string,
  kind: string | null,
  status = 'idle',
  name: string | null = null,
): Agent => ({
  paneId,
  workspaceId,
  tabId: `${workspaceId}:t1`,
  name,
  kind,
  title: null,
  cwd: null,
  status,
  interactiveReady: true,
});

describe('new session choices', () => {
  const agents = [
    agent('a', 'w1', 'codex'),
    agent('b', 'w2', 'claude'),
    agent('c', 'w3', 'claude'),
    agent('d', 'w1', 'codex'),
    agent('e', 'w1', 'claude'),
    agent('f', 'w2', null),
  ];
  const supported = ['pi', 'claude', 'codex', 'gemini'];

  it('puts the kinds used in the project first, then the rest of the session', () => {
    expect(kindChoices(agents, 'w1', supported)).toEqual({
      primary: ['codex', 'claude'],
      more: ['pi', 'gemini'],
    });
    expect(kindChoices(agents, 'w2', supported).primary).toEqual([
      'claude',
      'codex',
    ]);
  });
  it('falls back to supported kinds when nothing runs yet', () => {
    expect(kindChoices([], 'w1', supported)).toEqual({
      primary: ['pi', 'claude', 'codex'],
      more: ['gemini'],
    });
    expect(kindChoices([], 'w1', []).primary).toEqual(['claude', 'codex']);
  });
  it('suggests the lowest free name that Herdr accepts', () => {
    expect(suggestName('claude', [])).toBe('claude-1');
    expect(suggestName('claude', ['claude-1', null, 'claude-3'])).toBe(
      'claude-2',
    );
    const long = 'a'.repeat(32);
    expect(validAgentName(suggestName(long, []))).toBe(true);
    expect(suggestName(long, []).length).toBeLessThanOrEqual(32);
  });
  it('validates names the way the bridge does', () => {
    expect(validAgentName('claude-2')).toBe(true);
    expect(validAgentName('Claude')).toBe(false);
    expect(validAgentName('2claude')).toBe(false);
    expect(validAgentName('')).toBe(false);
  });
});

describe('home ordering', () => {
  it('moves agents needing input first and keeps Herdr order otherwise', () => {
    const ordered = attentionOrder([
      agent('a', 'w1', 'codex', 'working'),
      agent('b', 'w1', 'codex', 'blocked'),
      agent('c', 'w1', 'codex', 'idle'),
      agent('d', 'w1', 'codex', 'blocked'),
    ]);
    expect(ordered.map((a) => a.paneId)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('display helpers', () => {
  it('shortens home directories', () => {
    expect(shortPath('/home/someone/devel/app')).toBe('~/devel/app');
    expect(shortPath('/Users/someone')).toBe('~');
    expect(shortPath('/srv/app')).toBe('/srv/app');
    expect(shortPath('/homeless/app')).toBe('/homeless/app');
    expect(shortPath(null)).toBe('');
  });
  it('drops spinner glyphs from terminal titles', () => {
    expect(cleanTitle('✳ Fix login bug')).toBe('Fix login bug');
    expect(cleanTitle('⠐ Fix login bug')).toBe('Fix login bug');
    expect(cleanTitle('  ')).toBe('');
    expect(cleanTitle('~/devel/app')).toBe('~/devel/app');
    expect(cleanTitle('(venv) build')).toBe('(venv) build');
    expect(cleanTitle('./run')).toBe('./run');
    expect(cleanTitle(null)).toBe('');
  });
});

describe('draft handoff', () => {
  it('keeps a restored draft until the screen clears it', () => {
    handOff('m1/p1', { draft: 'fix it', notice: 'check first' });
    expect(peekHandoff('m1/p1')).toEqual({
      draft: 'fix it',
      notice: 'check first',
    });
    expect(peekHandoff('m1/p1')).toBeDefined();
    expect(peekHandoff('m2/p1')).toBeUndefined();
    clearHandoff('m1/p1');
    expect(peekHandoff('m1/p1')).toBeUndefined();
  });
});

describe('terminals and the home folder', () => {
  it('hides the phone workspace from the project list', () => {
    const projects = [
      { id: 'w1', label: 'api', cwd: '/a' },
      { id: 'w7', label: 'phone', cwd: '/h' },
    ];
    expect(listedProjects(projects).map((p) => p.id)).toEqual(['w1']);
  });
  it('treats an old bridge as not supporting terminals', () => {
    const old = new CombinedGraphQLErrors({
      errors: [{ message: 'Cannot query field "homeFolder" on type "Query".' }],
    });
    expect(terminalsSupported(old)).toBe(false);
    expect(terminalsSupported(null)).toBe(true);
    expect(terminalsSupported(new Error('Network request failed'))).toBe(true);
  });
});
