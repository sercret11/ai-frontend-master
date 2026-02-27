/**
 * Tool Registry - Central Tool Management System
 * Ported from OpenCode with modifications for ai-frontend-master
 *
 * This module provides a centralized registry for all available tools,
 * with filtering and discovery capabilities.
 */

import type {
  ToolInfo,
  ToolRegistration,
  ToolFilterOptions,
  ToolContext,
  ToolMetadata,
  ToolExecutionResult,
} from '@ai-frontend/shared-types';
import { Agent } from '../agent/agent';
import {
  enforcePermission,
  buildToolExecutionPermissionRequest,
  type PermissionPolicyContext,
} from './permission-policy';

/**
 * Tool Registry namespace
 */
export namespace ToolRegistry {
  /**
   * Internal storage for registered tools
   */
  const registry = new Map<string, ToolRegistration>();

  export interface ToolExecutionPolicyOptions {
    providerID?: string;
    modelID?: string;
    agentID: string;
    sessionID: string;
    messageID: string;
    abort: AbortSignal;
    callID?: string;
    permissionSource?: PermissionPolicyContext['source'];
    onToolCall?: ToolContext['onToolCall'];
    onToolResult?: ToolContext['onToolResult'];
  }

  interface AccessDecision {
    allowed: boolean;
    reason?: string;
  }

  function evaluateProviderAccess(
    registration: ToolRegistration,
    providerID?: string
  ): AccessDecision {
    if (!providerID || !registration.supportedProviders?.length) {
      return { allowed: true };
    }

    if (registration.supportedProviders.includes(providerID)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Tool "${registration.id}" is not available for provider "${providerID}"`,
    };
  }

  function evaluateAgentAccess(toolID: string, agentID?: string): AccessDecision {
    if (!agentID) {
      return { allowed: true };
    }

    const agent = Agent.get(agentID);
    if (!agent) {
      return { allowed: true };
    }

    const enabled = agent.enabledTools?.length ? new Set(agent.enabledTools) : undefined;
    if (enabled && !enabled.has(toolID)) {
      return {
        allowed: false,
        reason: `Tool "${toolID}" is not enabled for agent "${agentID}"`,
      };
    }

    const disabled = agent.disabledTools?.length ? new Set(agent.disabledTools) : undefined;
    if (disabled?.has(toolID)) {
      return {
        allowed: false,
        reason: `Tool "${toolID}" is disabled for agent "${agentID}"`,
      };
    }

    return { allowed: true };
  }

  export function assertExecutable(
    id: string,
    options: Pick<ToolExecutionPolicyOptions, 'providerID' | 'agentID'>
  ): ToolRegistration {
    const registration = registry.get(id);
    if (!registration) {
      throw new Error(`Tool not found: ${id}`);
    }

    if (!registration.enabled) {
      throw new Error(`Tool is disabled: ${id}`);
    }

    const providerAccess = evaluateProviderAccess(registration, options.providerID);
    if (!providerAccess.allowed) {
      throw new Error(providerAccess.reason || `Tool "${id}" is not executable`);
    }

    const agentAccess = evaluateAgentAccess(id, options.agentID);
    if (!agentAccess.allowed) {
      throw new Error(agentAccess.reason || `Tool "${id}" is not executable`);
    }

    return registration;
  }

  /**
   * Register a tool
   *
   * @param tool - Tool info object
   * @param options - Registration options
   */
  export function register(
    tool: ToolInfo,
    options: {
      enabled?: boolean;
      supportedProviders?: string[];
    } = {}
  ): void {
    registry.set(tool.id, {
      id: tool.id,
      info: tool,
      enabled: options.enabled ?? true,
      supportedProviders: options.supportedProviders,
    });
  }

  /**
   * Unregister a tool
   *
   * @param id - Tool ID
   */
  export function unregister(id: string): void {
    registry.delete(id);
  }

  /**
   * Get a tool by ID
   *
   * @param id - Tool ID
   * @returns Tool info or undefined if not found
   */
  export async function getById(id: string): Promise<ToolInfo | undefined> {
    const registration = registry.get(id);
    return registration?.info;
  }

  /**
   * Check if a tool is registered
   *
   * @param id - Tool ID
   * @returns True if tool exists
   */
  export function has(id: string): boolean {
    return registry.has(id);
  }

  /**
   * Get all registered tools
   *
   * @param options - Filter options
   * @returns Array of tool info objects
   */
  export async function getAll(options?: ToolFilterOptions): Promise<ToolInfo[]> {
    let tools = Array.from(registry.values());

    // Apply filters
    if (options) {
      // Filter by enabled status
      if (options.enabledOnly) {
        tools = tools.filter(t => t.enabled);
      }

      // Filter by provider
      if (options.providerID) {
        tools = tools.filter(t => evaluateProviderAccess(t, options.providerID).allowed);
      }

      // Filter by agent (if agent has specific tool restrictions)
      if (options.agentID) {
        tools = tools.filter(t => evaluateAgentAccess(t.id, options.agentID).allowed);
      }
    }

    return tools.map(t => t.info);
  }

  /**
   * Get tools for a specific provider/model
   *
   * @param providerID - Provider ID (e.g., 'anthropic', 'openai', 'google')
   * @param modelID - Model ID (e.g., 'claude-sonnet-4', 'gpt-4')
   * @returns Array of compatible tool info objects
   */
  export async function getForProvider(
    providerID: string,
    modelID?: string,
    agentID?: string
  ): Promise<ToolInfo[]> {
    return getAll({ providerID, modelID, agentID });
  }

  /**
   * Get tool count
   *
   * @param options - Filter options
   * @returns Number of tools matching the filter
   */
  export async function count(options?: ToolFilterOptions): Promise<number> {
    const tools = await getAll(options);
    return tools.length;
  }

  /**
   * List all tool IDs
   *
   * @returns Array of tool IDs
   */
  export function listIds(): string[] {
    return Array.from(registry.keys());
  }

  /**
   * Clear all registered tools
   * Useful for testing
   */
  export function clear(): void {
    registry.clear();
  }

  /**
   * Get registration info for a tool
   *
   * @param id - Tool ID
   * @returns Registration info or undefined
   */
  export function getRegistration(id: string): ToolRegistration | undefined {
    return registry.get(id);
  }

  /**
   * Enable or disable a tool
   *
   * @param id - Tool ID
   * @param enabled - Whether to enable the tool
   */
  export function setEnabled(id: string, enabled: boolean): void {
    const registration = registry.get(id);
    if (registration) {
      registration.enabled = enabled;
    }
  }

  /**
   * Check if a tool is enabled
   *
   * @param id - Tool ID
   * @returns True if tool is enabled
   */
  export function isEnabled(id: string): boolean {
    const registration = registry.get(id);
    return registration?.enabled ?? false;
  }

  export async function executeWithPolicy(
    id: string,
    args: Record<string, unknown>,
    options: ToolExecutionPolicyOptions
  ): Promise<ToolExecutionResult<ToolMetadata>> {
    const registration = assertExecutable(id, {
      providerID: options.providerID,
      agentID: options.agentID,
    });

    const initialized = await registration.info.init({ agent: options.agentID });
    const callID =
      options.callID?.trim() ||
      `${options.messageID}-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const permissionContext: PermissionPolicyContext = {
      source: options.permissionSource ?? 'llm-service',
      agent: options.agentID,
      sessionID: options.sessionID,
      messageID: options.messageID,
      callID,
      toolName: id,
    };

    options.onToolCall?.({
      toolName: id,
      callID,
      args,
    });

    await enforcePermission(buildToolExecutionPermissionRequest(id, args), permissionContext);

    const toolContext: ToolContext = {
      sessionID: options.sessionID,
      messageID: options.messageID,
      agent: options.agentID,
      abort: options.abort,
      callID,
      metadata: (data) => {
        console.log(`[Tool] ${id} metadata:`, data);
      },
      ask: async request => {
        await enforcePermission(request, permissionContext);
      },
      onToolCall: options.onToolCall,
      onToolResult: options.onToolResult,
    };

    const result = await initialized.execute(args, toolContext);

    options.onToolResult?.({
      toolName: id,
      callID,
      title: result.title,
      output: result.output,
      metadata: result.metadata,
    });

    return result;
  }
}

// ============================================================================
// Tool Imports
// ============================================================================

import { ReadTool } from './tools/read';
import { WriteTool } from './tools/write';
import { GrepTool } from './tools/grep';
import { GlobTool } from './tools/glob';
import { BashTool } from './tools/bash';
import { WebFetchTool } from './tools/webfetch';
import { DesignSearchTool } from './tools/design-search';
import { ApplyDiffTool } from './tools/apply-diff';
import { GetColorPaletteTool, GetDesignStyleTool, GetTypographyPairTool, GetComponentListTool } from './tools/design-resources';

// ============================================================================
// Auto-register all tools
// ============================================================================

ToolRegistry.register(ReadTool);
ToolRegistry.register(WriteTool);
ToolRegistry.register(GrepTool);
ToolRegistry.register(GlobTool);
ToolRegistry.register(BashTool);
ToolRegistry.register(WebFetchTool);
ToolRegistry.register(DesignSearchTool);
ToolRegistry.register(ApplyDiffTool);

// Design Resources Tools
ToolRegistry.register(GetColorPaletteTool);
ToolRegistry.register(GetDesignStyleTool);
ToolRegistry.register(GetTypographyPairTool);
ToolRegistry.register(GetComponentListTool);
