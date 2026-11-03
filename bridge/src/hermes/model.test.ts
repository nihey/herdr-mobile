import { describe, expect, it } from 'vitest';
import { codexModel } from './model.js';

describe("codex's default model", () => {
  it("reads codex's top-level model", () => {
    expect(
      codexModel(
        'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "xhigh"\n[profiles.x]\nmodel = "o"',
      ),
    ).toBe('gpt-6.1-sol');
  });
  it('ignores models inside tables', () => {
    expect(codexModel('[a]\nmodel = "x"')).toBeNull();
  });
  it('reads single quotes and skips comments', () => {
    expect(codexModel("# model = 'old'\nmodel = 'gpt-6.1-sol' # note")).toBe(
      'gpt-6.1-sol',
    );
  });
});
