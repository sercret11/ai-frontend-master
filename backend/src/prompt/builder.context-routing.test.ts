import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '@ai-frontend/shared-types';
import { PromptBuilder } from './builder';

const TEST_AGENT: AgentConfig = {
  id: 'test-agent-context-routing',
  name: 'Test Agent Context Routing',
  mode: 'implementer',
  sections: ['core-tool-calling-policy'],
};

describe('prompt builder context and routing diagnostics', () => {
  it('records context source mapping into diagnostics', async () => {
    const result = await PromptBuilder.buildForAgent(TEST_AGENT, {
      userMessage: 'Implement dashboard with React and Tailwind',
      platform: 'web',
      techStack: ['react', 'tailwind'],
      contextSources: {
        mode: 'smart-context',
        platform: 'request',
        techStack: 'session',
      },
    });

    expect(result.diagnostics?.resolved.mode).toBe('implementer');
    expect(result.diagnostics?.resolved.platform).toBe('web');
    expect(result.diagnostics?.resolved.techStack).toEqual(['react', 'tailwind']);
    expect(result.diagnostics?.resolved.sources).toEqual({
      mode: 'smart-context',
      platform: 'request',
      techStack: 'session',
    });
  });

  it('records routing diagnostics when routing context is provided', async () => {
    const result = await PromptBuilder.buildForAgent(TEST_AGENT, {
      userMessage: 'Fix form submit bug and add tests',
      platform: 'web',
      techStack: ['react'],
      contextSources: {
        mode: 'request',
        platform: 'default',
        techStack: 'smart-context',
      },
      routing: {
        reason: 'implementation intent detected',
        confidence: 0.91,
        score: 88,
        version: 'router-v2',
        language: 'mixed',
        techSignals: ['react', 'tailwind'],
      },
    });

    expect(result.diagnostics?.routing).toEqual({
      reason: 'implementation intent detected',
      confidence: 0.91,
      score: 88,
      version: 'router-v2',
      language: 'mixed',
      techSignals: ['react', 'tailwind'],
    });
    expect(result.diagnostics?.resolved.sources).toEqual({
      mode: 'request',
      platform: 'default',
      techStack: 'smart-context',
    });
  });
});

