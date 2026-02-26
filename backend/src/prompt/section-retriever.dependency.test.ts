import { describe, expect, it } from 'vitest';
import { SectionRetriever } from './section-retriever';

describe('section retriever dependencies', () => {
  it('loads dependent sections when selecting tech-specific sections', async () => {
    const retriever = new SectionRetriever();
    const result = await retriever.retrieve({
      mode: 'creator',
      platform: 'web',
      techStack: ['shadcn-ui'],
      maxTokens: 12000,
      userQuery: 'shadcn ui component library',
    });

    const reactIndex = result.selectedIds.indexOf('platform-web-react');
    const shadcnIndex = result.selectedIds.indexOf('platform-web-shadcn-ui');

    expect(shadcnIndex).toBeGreaterThanOrEqual(0);
    expect(reactIndex).toBeGreaterThanOrEqual(0);
    expect(reactIndex).toBeLessThan(shadcnIndex);
  });

  it('loads query-relevant sections when userQuery is provided', async () => {
    const retriever = new SectionRetriever();

    const baseline = await retriever.retrieve({
      mode: 'creator',
      platform: 'web',
      techStack: [],
      maxTokens: 12000,
    });

    const withQuery = await retriever.retrieve({
      mode: 'creator',
      platform: 'web',
      techStack: [],
      maxTokens: 12000,
      userQuery: 'build dashboard with shadcn ui and tailwind css',
    });

    expect(withQuery.selectedIds).toContain('platform-web-shadcn-ui');
    expect(baseline.selectedIds).not.toContain('platform-web-shadcn-ui');
  });
});
