/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('palette', () => {
  it('keeps colors in the theme', () => {
    const files = tsxFiles(root).filter(
      (file) => !file.endsWith(join('components', 'ui.tsx')),
    );
    expect(files.length).toBeGreaterThan(5);
    for (const file of files)
      expect({
        file,
        colors: readFileSync(file, 'utf8').match(/['"]#[0-9A-Fa-f]{3,8}['"]/g),
      }).toEqual({ file, colors: null });
  });
});
