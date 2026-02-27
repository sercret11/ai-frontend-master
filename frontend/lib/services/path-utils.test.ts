import { describe, expect, it } from 'vitest';
import { canonicalizeProjectPath, normalizeProjectFiles, splitProjectPath } from './path-utils';

describe('path-utils', () => {
  it('canonicalizes slashes and dot segments into a stable project path', () => {
    expect(canonicalizeProjectPath(' .\\src//pages/../App.tsx ')).toBe('src/App.tsx');
    expect(canonicalizeProjectPath('/src/./components//Button.tsx')).toBe('src/components/Button.tsx');
    expect(canonicalizeProjectPath('')).toBe('');
  });

  it('splits canonical paths into segments', () => {
    expect(splitProjectPath('./src\\routes/../App.tsx')).toEqual(['src', 'App.tsx']);
    expect(splitProjectPath('   ')).toEqual([]);
  });

  it('normalizes file arrays and removes canonical duplicates', () => {
    const normalized = normalizeProjectFiles([
      { path: './src/App.tsx', content: 'first' },
      { path: 'src//App.tsx', content: 'second' },
      { path: 'src\\main.tsx', content: 'main' },
      { path: '', content: 'ignored' },
    ]);

    expect(normalized).toEqual([
      { path: 'src/App.tsx', content: 'second' },
      { path: 'src/main.tsx', content: 'main' },
    ]);
  });
});
