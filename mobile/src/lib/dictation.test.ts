import { describe, expect, it } from 'vitest';
import {
  hasLocale,
  joinDictation,
  nextLanguage,
  parseLanguage,
  spokenText,
} from './dictation';

describe('dictation languages', () => {
  it('defaults unknown stored values to English', () => {
    expect(parseLanguage(null)).toBe('en-US');
    expect(parseLanguage('fr-FR')).toBe('en-US');
    expect(parseLanguage('pt-BR')).toBe('pt-BR');
  });

  it('cycles between English and Portuguese', () => {
    expect(nextLanguage('en-US')).toBe('pt-BR');
    expect(nextLanguage('pt-BR')).toBe('en-US');
  });

  it('matches installed locales regardless of separator and case', () => {
    expect(hasLocale(['en-US', 'pt-BR'], 'pt-BR')).toBe(true);
    expect(hasLocale(['pt_br'], 'pt-BR')).toBe(true);
    expect(hasLocale(['pt-PT', 'en-GB'], 'pt-BR')).toBe(false);
    expect(hasLocale([], 'en-US')).toBe(false);
  });
});

describe('dictated text', () => {
  it('joins final segments and the current partial phrase', () => {
    expect(spokenText([], '')).toBe('');
    expect(spokenText([], 'run the')).toBe('run the');
    expect(spokenText(['Run the tests.'], 'then commit')).toBe(
      'Run the tests. then commit',
    );
    expect(spokenText(['Run the tests.', ' '], '')).toBe('Run the tests.');
  });

  it('appends speech to an existing draft with one separating space', () => {
    expect(joinDictation('', 'hello')).toBe('hello');
    expect(joinDictation('Fix the bug', 'in the parser')).toBe(
      'Fix the bug in the parser',
    );
    expect(joinDictation('Fix the bug ', 'now')).toBe('Fix the bug now');
    expect(joinDictation('First line\n', 'second')).toBe('First line\nsecond');
    expect(joinDictation('Keep this', '')).toBe('Keep this');
  });
});
