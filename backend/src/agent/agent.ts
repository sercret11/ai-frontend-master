/**
 * Agent System - AI Agent Configuration and Management
 * Custom implementation for ai-frontend-master
 *
 * This module provides agent definitions that integrate with the
 * prompt engineering system (prompt-docs index + modular sections)
 */

import { PromptBuilder } from '../prompt/builder';
import type { AgentPromptBuildContext } from '../prompt/builder';
import type { AgentConfig, SessionMode, PromptBuildResult } from '@ai-frontend/shared-types';

/**
 * Agent namespace
 */
export namespace Agent {
  /**
   * Predefined agents
   */
  const AGENTS: Record<string, AgentConfig> = {
    'frontend-creator': {
      id: 'frontend-creator',
      name: 'Frontend Creator',
      description:
        'AI agent for creating new frontend projects with auto-completion of design decisions',
      mode: 'creator',
      sections: [
        'core-identity-and-scope',
        'core-platform-capabilities',
        'core-mode-routing',
        'core-tool-calling-policy',
        'creator-design-strategy',
        'creator-ux-heuristics',
        'creator-visual-language',
        'platform-web-shadcn-ui',
        'reference-workflow',
      ],
      resources: ['design-styles', 'color-palettes', 'typography-pairs'],
      temperature: 0.3, // 降低温度以提高工具调用稳定性
      topP: 0.9,
      maxTokens: 128000, // 128K output tokens for full project generation
      enabledTools: [
        'design_search',
        'get_design_style',
        'get_color_palette',
        'get_typography_pair',
        'get_component_list',
        'read',
        'apply_diff',
        'write',
        'webfetch',
      ],
    },

    'frontend-implementer': {
      id: 'frontend-implementer',
      name: 'Frontend Implementer',
      description: 'AI agent for implementing frontend projects based on detailed specifications',
      mode: 'implementer',
      sections: [
        'core-identity-and-scope',
        'core-platform-capabilities',
        'core-tool-calling-policy',
        'implementer-engineering-standards',
        'implementer-thinking-protocol',
        'implementer-rule-priority',
        'implementer-testing-verification',
        'platform-web-react',
        'platform-web-nextjs',
      ],
      temperature: 0.2,
      topP: 0.7,
      maxTokens: 8192,
      enabledTools: ['read', 'apply_diff', 'write', 'grep', 'glob', 'bash'],
    },

    'ux-advisor': {
      id: 'ux-advisor',
      name: 'UX Advisor',
      description: 'Specialized agent for UX/UI design advice and best practices',
      mode: 'creator',
      sections: [
        'creator-design-strategy',
        'creator-ux-heuristics',
        'creator-visual-language',
        'core-tool-calling-policy',
      ],
      resources: ['design-styles', 'color-palettes', 'typography-pairs'],
      temperature: 0.6,
      topP: 0.8,
      maxTokens: 4096,
      enabledTools: ['design_search', 'webfetch'],
    },

    'code-architect': {
      id: 'code-architect',
      name: 'Code Architect',
      description: 'Specialized agent for code architecture and structural decisions',
      mode: 'implementer',
      sections: ['core-identity-and-scope', 'implementer-thinking-protocol'],
      temperature: 0.4,
      topP: 0.8,
      maxTokens: 4096,
      enabledTools: ['read', 'grep', 'glob'],
    },
  };

  /**
   * Get an agent by ID
   *
   * @param agentId - Agent ID
   * @returns Agent config or undefined
   */
  export function get(agentId: string): AgentConfig | undefined {
    return AGENTS[agentId];
  }

  /**
   * List all available agents
   *
   * @returns Array of agent configs
   */
  export function listAll(): AgentConfig[] {
    return Object.values(AGENTS);
  }

  /**
   * List agents by mode
   *
   * @param mode - Creator or Implementer mode
   * @returns Array of agent configs
   */
  export function listByMode(mode: SessionMode): AgentConfig[] {
    return listAll().filter(agent => agent.mode === mode);
  }

  /**
   * Check if an agent exists
   *
   * @param agentId - Agent ID
   * @returns True if agent exists
   */
  export function has(agentId: string): boolean {
    return agentId in AGENTS;
  }

  /**
   * Build the complete system prompt for an agent
   *
   * @param agent - Agent config
   * @returns Built prompt result
   */
  export async function buildAgentPrompt(
    agent: AgentConfig,
    context: AgentPromptBuildContext = {}
  ): Promise<PromptBuildResult> {
    return await PromptBuilder.buildForAgent(agent, context);
  }

  /**
   * Get the default agent for a mode
   *
   * @param mode - Creator or Implementer mode
   * @returns Default agent ID
   */
  export function getDefaultForMode(mode: SessionMode): string {
    return mode === 'creator' ? 'frontend-creator' : 'frontend-implementer';
  }

  /**
   * Get agent statistics
   *
   * @param agentId - Agent ID
   * @returns Agent statistics
   */
  export async function getStats(agentId: string) {
    const agent = get(agentId);
    if (!agent) return null;

    const promptResult = await buildAgentPrompt(agent);

    return {
      id: agent.id,
      name: agent.name,
      mode: agent.mode,
      sectionCount: agent.sections?.length || 0,
      resourceCount: agent.resources?.length || 0,
      enabledToolCount: agent.enabledTools?.length || 0,
      estimatedTokens: promptResult.estimatedTokens,
    };
  }
}
