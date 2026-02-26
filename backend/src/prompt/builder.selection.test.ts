import { describe, expect, it } from 'vitest';
import { PromptBuilder } from './builder';

describe('prompt builder section selection', () => {
  it('respects explicit sections and excludeSections together', async () => {
    const result = await PromptBuilder.build({
      mode: 'creator',
      sections: ['core-tool-calling-policy', 'creator-design-strategy'],
      excludeSections: ['creator-design-strategy'],
      variables: {},
    });

    const selectedIds = result.diagnostics.retrieval.selectedIds;
    const excludedIds = result.diagnostics.retrieval.excludedIds;

    expect(selectedIds).toContain('core-tool-calling-policy');
    expect(selectedIds).not.toContain('creator-design-strategy');
    expect(excludedIds).toContain('creator-design-strategy');
    expect(result.sections.some(section => section.id === 'creator-design-strategy')).toBe(false);
  });
});

