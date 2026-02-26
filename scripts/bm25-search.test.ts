import { describe, expect, it } from 'vitest';
import { DesignStyleSearcher } from './bm25-search.ts';

describe('bm25 style search mapping', () => {
  it('maps search results back to style metadata', () => {
    const searcher = new DesignStyleSearcher('.') as any;
    searcher.styles = [
      {
        id: 'style-minimal',
        name: 'Minimal',
        category: 'saas',
        characteristics: ['minimal', 'clean', 'spacious'],
        useCases: ['dashboard'],
      },
      {
        id: 'style-bold',
        name: 'Bold',
        category: 'marketing',
        characteristics: ['bold', 'colorful'],
        useCases: ['landing page'],
      },
    ];

    const results = searcher.searchStyles('minimal clean dashboard', 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.style?.name).toBe('Minimal');
    expect(results[0]?.score).toBeGreaterThan(0);
  });
});
