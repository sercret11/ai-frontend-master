import { describe, expect, it } from 'vitest';
import { DependencyValidator } from './dependency-validator';

describe('DependencyValidator.normalizeImportPackage', () => {
  it('normalizes non-scoped package subpaths', () => {
    expect(DependencyValidator.normalizeImportPackage('react-dom/client')).toBe('react-dom');
    expect(DependencyValidator.normalizeImportPackage('lodash/fp')).toBe('lodash');
  });

  it('normalizes scoped package subpaths', () => {
    expect(DependencyValidator.normalizeImportPackage('@radix-ui/react-slot')).toBe(
      '@radix-ui/react-slot'
    );
    expect(
      DependencyValidator.normalizeImportPackage('@radix-ui/react-slot/dist/index.js')
    ).toBe('@radix-ui/react-slot');
  });

  it('keeps relative and absolute local paths unchanged', () => {
    expect(DependencyValidator.normalizeImportPackage('./local/module')).toBe('./local/module');
    expect(DependencyValidator.normalizeImportPackage('/src/local/module')).toBe(
      '/src/local/module'
    );
  });
});
