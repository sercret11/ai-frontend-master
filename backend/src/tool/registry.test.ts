import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from './registry';
import { Agent } from '../agent/agent';
import type { AgentConfig } from '@ai-frontend/shared-types';

const TEST_TOOL_IDS = [
  'test_policy_disabled',
  'test_policy_provider',
  'test_policy_agent',
  'test_policy_bash_guard',
];

describe('ToolRegistry agent filtering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const id of TEST_TOOL_IDS) {
      ToolRegistry.unregister(id);
    }
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

  it('blocks execution when tool is disabled', async () => {
    const executeSpy = vi.fn(async () => ({
      title: 'ok',
      output: 'ok',
      metadata: {},
    }));

    ToolRegistry.register(
      {
        id: 'test_policy_disabled',
        init: async () => ({
          description: 'disabled test tool',
          parameters: z.object({}),
          execute: executeSpy,
        }),
      },
      { enabled: false },
    );

    await expect(
      ToolRegistry.executeWithPolicy('test_policy_disabled', {}, {
        providerID: 'openai',
        modelID: 'gpt-4o-mini',
        agentID: 'frontend-implementer',
        sessionID: 's-1',
        messageID: 'm-1',
        abort: new AbortController().signal,
      }),
    ).rejects.toThrow('Tool is disabled');

    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('blocks execution when provider or agent policy disallows the tool', async () => {
    const executeSpy = vi.fn(async () => ({
      title: 'ok',
      output: 'ok',
      metadata: {},
    }));

    ToolRegistry.register(
      {
        id: 'test_policy_provider',
        init: async () => ({
          description: 'provider test tool',
          parameters: z.object({}),
          execute: executeSpy,
        }),
      },
      { supportedProviders: ['anthropic'] },
    );

    await expect(
      ToolRegistry.executeWithPolicy('test_policy_provider', {}, {
        providerID: 'openai',
        modelID: 'gpt-4o-mini',
        agentID: 'frontend-implementer',
        sessionID: 's-2',
        messageID: 'm-2',
        abort: new AbortController().signal,
      }),
    ).rejects.toThrow('not available for provider');
    expect(executeSpy).not.toHaveBeenCalled();

    ToolRegistry.register({
      id: 'test_policy_agent',
      init: async () => ({
        description: 'agent test tool',
        parameters: z.object({}),
        execute: executeSpy,
      }),
    });

    const realAgentGet = Agent.get;
    const baseImplementer = realAgentGet('frontend-implementer');
    if (!baseImplementer) {
      throw new Error('frontend-implementer agent not found');
    }

    const restrictedAgent: AgentConfig = {
      ...baseImplementer,
      id: 'test-agent-no-tool',
      enabledTools: ['read'],
      disabledTools: [],
    };

    vi.spyOn(Agent, 'get').mockImplementation((agentId: string) => {
      if (agentId === restrictedAgent.id) {
        return restrictedAgent;
      }
      return realAgentGet(agentId);
    });

    await expect(
      ToolRegistry.executeWithPolicy('test_policy_agent', {}, {
        providerID: 'openai',
        modelID: 'gpt-4o-mini',
        agentID: restrictedAgent.id,
        sessionID: 's-3',
        messageID: 'm-3',
        abort: new AbortController().signal,
      }),
    ).rejects.toThrow('not enabled for agent');

    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('blocks untrusted high-risk tool execution before tool code runs', async () => {
    const executeSpy = vi.fn(async () => ({
      title: 'ok',
      output: 'ok',
      metadata: {},
    }));

    ToolRegistry.register({
      id: 'test_policy_bash_guard',
      init: async () => ({
        description: 'high-risk permission test tool',
        parameters: z.object({}),
        execute: executeSpy,
      }),
    });

    await expect(
      ToolRegistry.executeWithPolicy('test_policy_bash_guard', {}, {
        providerID: 'openai',
        modelID: 'gpt-4o-mini',
        agentID: 'unknown-agent',
        sessionID: 's-4',
        messageID: 'm-4',
        abort: new AbortController().signal,
      }),
    ).rejects.toThrow('[PermissionDenied:tool-permission-v1]');

    expect(executeSpy).not.toHaveBeenCalled();
  });
});
