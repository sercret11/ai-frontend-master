import { describe, expect, it } from 'vitest';
import { runResearchAgent } from './research-agent';
import type { ExternalDependencyChecklist } from './types';

describe('context7 mcp fallback behavior', () => {
  it('falls back to preset mode when MCP endpoint is unavailable', async () => {
    const dependencies: ExternalDependencyChecklist[] = [
      {
        framework: 'react',
        packageName: 'react',
        topics: ['useEffect', 'cleanup'],
      },
    ];

    const digest = await runResearchAgent(dependencies, {
      mcpUrl: 'http://127.0.0.1:1/mcp',
      timeoutMs: 500,
    });

    expect(digest.summary).toContain('source=preset');
    expect(digest.dependencies).toHaveLength(1);
    expect(digest.apiSignatures.length).toBeGreaterThan(0);
  });
});
