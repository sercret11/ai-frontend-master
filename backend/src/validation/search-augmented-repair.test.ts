import { describe, expect, it } from 'vitest';
import { ErrorCategory, type ParsedError } from '@ai-frontend/shared-types';
import { searchAugmentedRepair } from './search-augmented-repair';

function buildErrors(message: string): ParsedError[] {
  return [
    {
      category: ErrorCategory.TYPE_ERROR,
      message,
      raw: message,
    },
  ];
}

describe('search-augmented-repair', () => {
  it('filters out candidate links outside allowed domains', async () => {
    const result = await searchAugmentedRepair(buildErrors('alpha beta gamma'), {
      allowedDomains: ['github.com'],
      candidates: [
        {
          title: 'Allowed',
          url: 'https://github.com/search?q=alpha',
          sourceType: 'community',
        },
        {
          title: 'Blocked',
          url: 'https://example.com/issues?q=alpha',
          sourceType: 'community',
        },
      ],
      fetchExcerptFn: async () => 'alpha beta',
    });

    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]?.hostname).toBe('github.com');
    expect(result.hints[0]?.url).toContain('github.com');
  });

  it('keeps deterministic ordering when scores tie', async () => {
    const result = await searchAugmentedRepair(buildErrors('alpha beta gamma'), {
      allowedDomains: ['github.com'],
      candidates: [
        {
          title: 'Repo-B',
          url: 'https://github.com/org/repo-b',
          sourceType: 'community',
        },
        {
          title: 'Repo-A',
          url: 'https://github.com/org/repo-a',
          sourceType: 'community',
        },
      ],
      fetchExcerptFn: async () => 'alpha beta',
    });

    expect(result.hints).toHaveLength(2);
    expect(result.hints.map(item => item.url)).toEqual([
      'https://github.com/org/repo-a',
      'https://github.com/org/repo-b',
    ]);
  });

  it('maps confidence by deterministic score thresholds', async () => {
    const result = await searchAugmentedRepair(buildErrors('alpha beta gamma'), {
      allowedDomains: ['official.dev', 'medium.dev', 'low.dev'],
      candidates: [
        {
          title: 'Official Doc',
          url: 'https://official.dev/docs/error-v15',
          sourceType: 'official',
        },
        {
          title: 'Community Match',
          url: 'https://medium.dev/answers/1',
          sourceType: 'community',
        },
        {
          title: 'Weak Match',
          url: 'https://low.dev/thread/general',
          sourceType: 'community',
        },
      ],
      fetchExcerptFn: async (url: string) => {
        if (url.includes('official.dev')) {
          return 'alpha beta gamma v15';
        }
        if (url.includes('medium.dev')) {
          return 'alpha';
        }
        return '';
      },
    });

    expect(result.hints).toHaveLength(3);
    expect(result.hints.map(item => item.confidence)).toEqual(['high', 'medium', 'low']);
    expect(result.hints.map(item => item.hostname)).toEqual(['official.dev', 'medium.dev', 'low.dev']);
  });

  it('injects visual summary with payload control', async () => {
    const largeImage = `data:image/png;base64,${'a'.repeat(20_000)}`;
    const result = await searchAugmentedRepair(buildErrors('button overlap in dashboard'), {
      allowedDomains: ['github.com'],
      candidates: [
        {
          title: 'Issue',
          url: 'https://github.com/org/repo/issues/1',
          sourceType: 'community',
        },
      ],
      fetchExcerptFn: async () => 'layout overlap fix',
      visualDiffBundleRef: {
        diffImage: largeImage,
        domContext: `
          <div class="page">
            <section class="header"></section>
            <section class="chart overlap"></section>
          </div>
        `,
        hotspotHint: 'chart overlaps header after resize',
      },
      maxVisualPayloadChars: 800,
    });

    expect(result.summary).toContain('visualSummary=present');
    expect(result.query.length).toBeLessThanOrEqual(260);
    expect(result.hints).toHaveLength(1);
  });
});
