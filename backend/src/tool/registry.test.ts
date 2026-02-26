import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from './registry';
import { Agent } from '../agent/agent';
import type { AgentConfig } from '@ai-frontend/shared-types';

describe('ToolRegistry agent filtering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters tools with built-in agent enabledTools rules', async () => {
    const creatorTools = await ToolRegistry.getAll({ agentID: 'frontend-creator' });
    const creatorIds = new Set(creatorTools.map(tool => tool.id));
    expect(creatorIds.has('read')).toBe(true);
    expect(creatorIds.has('bash')).toBe(false);

    const implementerTools = await ToolRegistry.getAll({ agentID: 'frontend-implementer' });
    const implementerIds = new Set(implementerTools.map(tool => tool.id));
    expect(implementerIds.has('bash')).toBe(true);
    expect(implementerIds.has('design_search')).toBe(false);
  });

  it('applies disabledTools deny list when provided by agent config', async () => {
    const baseImplementer = Agent.get('frontend-implementer');
    if (!baseImplementer) {
      throw new Error('frontend-implementer agent not found');
    }

    const mockedAgent: AgentConfig = {
      ...baseImplementer,
      id: 'test-agent',
      enabledTools: ['read', 'apply_diff', 'bash'],
      disabledTools: ['bash'],
    };

    vi.spyOn(Agent, 'get').mockImplementation((agentId: string) => {
      if (agentId === 'test-agent') {
        return mockedAgent;
      }
      return baseImplementer.id === agentId ? baseImplementer : undefined;
    });

    const tools = await ToolRegistry.getAll({ agentID: 'test-agent' });
    const ids = new Set(tools.map(tool => tool.id));

    expect(ids.has('read')).toBe(true);
    expect(ids.has('apply_diff')).toBe(true);
    expect(ids.has('bash')).toBe(false);
  });

  it('passes agent filtering through getForProvider', async () => {
    const tools = await ToolRegistry.getForProvider('openai', 'gpt-4o-mini', 'frontend-creator');
    const ids = new Set(tools.map(tool => tool.id));

    expect(ids.has('read')).toBe(true);
    expect(ids.has('bash')).toBe(false);
  });
});
