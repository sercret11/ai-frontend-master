import { describe, expect, it } from 'vitest';
import {
  createDependencySignature,
  resolveDependencyMap,
} from './dependency-resolver';

describe('dependency-resolver', () => {
  it('detects added, removed and changed dependencies', () => {
    const previous = JSON.stringify({
      dependencies: {
        react: '^18.2.0',
        lodash: '^4.17.0',
      },
      devDependencies: {
        vite: '^5.0.0',
      },
    });
    const next = JSON.stringify({
      dependencies: {
        react: '^18.3.1',
        zustand: '^4.5.0',
      },
      devDependencies: {
        vite: '^5.0.0',
      },
    });

    const result = resolveDependencyMap(previous, next);

    expect(result.changed).toBe(true);
    expect(result.diff.added).toEqual(['zustand']);
    expect(result.diff.removed).toEqual(['lodash']);
    expect(result.diff.changed).toEqual(['react']);
    expect(result.dependencies).toMatchObject({
      react: '^18.3.1',
      zustand: '^4.5.0',
      vite: '^5.0.0',
    });
  });

  it('creates a stable signature independent from key order', () => {
    const first = createDependencySignature({
      react: '^18.3.1',
      zustand: '^4.5.0',
    });
    const second = createDependencySignature({
      zustand: '^4.5.0',
      react: '^18.3.1',
    });
    expect(first).toBe(second);
  });
});
