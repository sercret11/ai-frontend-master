/**
 * LLM Module Entry Point / Factory
 *
 * Provides factory functions to create LLMClient instances with the appropriate
 * ProviderAdapters and RetryEngine. Also exports a convenience singleton and
 * a backward-compatible LLMService wrapper that delegates to LLMClient.
 *
 * 需求: R5.1, R5.2, R9.3, R9.4, R10.4
 */

import type { ProviderID } from './types.js';
import type { ProviderAdapter } from './adapters/types.js';
import { LLMClient } from './client.js';
import { RetryEngine, DEFAULT_RETRY_CONFIG } from './retry.js';
import { AnthropicAdapter } from './adapters/anthropic.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { GoogleAdapter } from './adapters/google.js';

// Re-export key types and classes for convenience
export { LLMClient } from './client.js';
export { RetryEngine, DEFAULT_RETRY_CONFIG } from './retry.js';
export { StreamHandler } from './stream-handler.js';
export type {
  ProviderID,
  LLMRequestParams,
  LLMMessage,
  ContentBlock,
  ToolDefinition,
  LLMResponse,
  ToolCall,
  TokenUsage,
  StreamEvent,
  LLMStreamResult,
  LLMError,
  ToolExecutor,
  FinishReason,
} from './types.js';
export type { ProviderAdapter, AdapterRequest } from './adapters/types.js';
export { AnthropicAdapter } from './adapters/anthropic.js';
export { OpenAIAdapter } from './adapters/openai.js';
export { GoogleAdapter } from './adapters/google.js';

// ============================================================================
// Factory
// ============================================================================

export interface CreateLLMClientOptions {
  /** Override for OpenAI API key (defaults to process.env.OPENAI_API_KEY) */
  openaiApiKey?: string;
  /** Override for OpenAI base URL (defaults to process.env.OPENAI_BASE_URL) */
  openaiBaseUrl?: string;
  /** Override for Anthropic API key (defaults to process.env.ANTHROPIC_API_KEY) */
  anthropicApiKey?: string;
  /** Override for Anthropic base URL (defaults to process.env.ANTHROPIC_BASE_URL) */
  anthropicBaseUrl?: string;
  /** Override for Google API key (defaults to process.env.GOOGLE_API_KEY) */
  googleApiKey?: string;
  /** Override for Google base URL (defaults to process.env.GOOGLE_BASE_URL) */
  googleBaseUrl?: string;
  /** Override for Zhipu AI API key (defaults to process.env.ZHIPUAI_API_KEY) */
  zhipuaiApiKey?: string;
  /** Override for Zhipu AI base URL (defaults to process.env.ZHIPUAI_BASE_URL) */
  zhipuaiBaseUrl?: string;
  /** Override for DashScope API key (defaults to process.env.DASHSCOPE_API_KEY) */
  dashscopeApiKey?: string;
  /** Override for DashScope base URL (defaults to process.env.DASHSCOPE_BASE_URL) */
  dashscopeBaseUrl?: string;
  /** Partial retry config overrides */
  retryConfig?: Partial<typeof DEFAULT_RETRY_CONFIG>;
}

/**
 * Create a new LLMClient with all three provider adapters and a RetryEngine.
 *
 * Reads API keys and base URLs from environment variables by default.
 * Adapters whose API key is missing are silently skipped — the client will
 * throw at call-time if a missing provider is requested.
 */
export function createLLMClient(options: CreateLLMClientOptions = {}): LLMClient {
  const adapters = new Map<ProviderID, ProviderAdapter>();

  // --- OpenAI ---
  const openaiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '';
  if (openaiKey) {
    const openaiBase = options.openaiBaseUrl ?? process.env.OPENAI_BASE_URL;
    adapters.set(
      'openai',
      new OpenAIAdapter({
        apiKey: openaiKey,
        baseUrl: openaiBase || undefined,
        protocol: 'responses', // default to Responses API per design doc
        providerId: 'openai',
      }),
    );
  }

  // --- Anthropic ---
  const anthropicKey = options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  if (anthropicKey) {
    const anthropicBase = options.anthropicBaseUrl ?? process.env.ANTHROPIC_BASE_URL;
    adapters.set(
      'anthropic',
      new AnthropicAdapter({
        apiKey: anthropicKey,
        baseUrl: anthropicBase || undefined,
      }),
    );
  }

  // --- Google ---
  const googleKey = options.googleApiKey ?? process.env.GOOGLE_API_KEY ?? '';
  if (googleKey) {
    const googleBase = options.googleBaseUrl ?? process.env.GOOGLE_BASE_URL;
    adapters.set(
      'google',
      new GoogleAdapter({
        apiKey: googleKey,
        baseUrl: googleBase || undefined,
      }),
    );
  }

  // --- Zhipu AI ---
  const zhipuaiKey = options.zhipuaiApiKey ?? process.env.ZHIPUAI_API_KEY ?? '';
  if (zhipuaiKey) {
    const zhipuaiBase = options.zhipuaiBaseUrl ?? process.env.ZHIPUAI_BASE_URL;
    adapters.set(
      'zhipuai',
      new OpenAIAdapter({
        apiKey: zhipuaiKey,
        baseUrl: zhipuaiBase || undefined,
        protocol: 'chat-completions',
        providerId: 'zhipuai',
      }),
    );
  }

  // --- DashScope ---
  const dashscopeKey = options.dashscopeApiKey ?? process.env.DASHSCOPE_API_KEY ?? '';
  if (dashscopeKey) {
    const dashscopeBase = options.dashscopeBaseUrl ?? process.env.DASHSCOPE_BASE_URL;
    adapters.set(
      'dashscope',
      new OpenAIAdapter({
        apiKey: dashscopeKey,
        baseUrl: dashscopeBase || undefined,
        protocol: 'chat-completions',
        providerId: 'dashscope',
      }),
    );
  }

  const retryEngine = new RetryEngine(options.retryConfig);

  return new LLMClient(adapters, retryEngine);
}

// ============================================================================
// Singleton
// ============================================================================

let _defaultClient: LLMClient | null = null;

/**
 * Lazily-initialized default LLMClient singleton.
 * Reads configuration from environment variables on first access.
 */
export function getDefaultLLMClient(): LLMClient {
  if (!_defaultClient) {
    _defaultClient = createLLMClient();
  }
  return _defaultClient;
}

/**
 * Reset the default singleton (useful for testing).
 */
export function resetDefaultLLMClient(): void {
  _defaultClient = null;
}

// ============================================================================
// LLMService Compatibility Wrapper
// ============================================================================
//
// Provides the same high-level `LLMService.stream()` interface that existing
// consumers (runner.ts, self-repair-agent.ts, project-validator.ts) rely on,
// but delegates the actual LLM call to LLMClient.
//
// This wrapper preserves the agent routing, prompt building, tool setup, and
// callback-based tool execution that the old LLMService.stream() provided.
// The old service.ts will be removed in task 13.1.

import { ToolRegistry } from '../tool/registry';
import { Agent } from '../agent/agent';
import { ModeRouter } from '../prompt/router';
import { getSmartBuilder } from '../context/integration/smart-builder';
import { config } from '../config/index';
import type {
  ToolMetadata,
  PromptBuildDiagnostics,
  InputLanguage,
} from '@ai-frontend/shared-types';
import type { ToolDefinition as LLMToolDefinition } from './types.js';

/**
 * LLMService compatibility namespace.
 *
 * Drop-in replacement for the old `LLMService` from `./service.ts`.
 * Internally delegates to `LLMClient` via `getDefaultLLMClient()`.
 */
export namespace LLMService {
  /**
   * Stream input parameters — same interface as the original LLMService.
   */
  export interface StreamInput {
    sessionID: string;
    messageID: string;
    agentId?: string;
    userMessage: string;
    mode?: 'creator' | 'implementer';
    platform?: 'web' | 'mobile' | 'desktop' | 'miniprogram';
    techStack?: string[];
    modelProvider?: ProviderID;
    modelId?: string;
    apiKey?: string;
    baseURL?: string;
    abort?: AbortSignal;
    maxToolCalls?: number;
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    onToolCall?: (call: { toolName: string; callID: string; args: Record<string, unknown> }) => void;
    onToolResult?: (result: {
      toolName: string;
      callID: string;
      title: string;
      output: string;
      metadata?: any;
    }) => void;
    onPromptDiagnostics?: (diagnostics: {
      agentId: string;
      promptDiagnostics?: PromptBuildDiagnostics;
      contextResolution?: {
        mode: 'creator' | 'implementer';
        platform: string;
        techStack: string[];
        reason: string;
        confidence: number;
        score?: number;
        version?: string;
        language?: InputLanguage;
        techSignals?: string[];
      };
    }) => void;
  }

  /** Stream result shape (backward-compatible) */
  export interface StreamResult {
    textStream: AsyncIterable<string>;
    text: Promise<string>;
    toolCalls: Promise<Array<{ toolName: string; toolCallId: string; args: Record<string, unknown> }>>;
  }

  function extractLastUserMessage(
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): string {
    if (!messages?.length) return '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === 'user' && message.content?.trim()) {
        return message.content;
      }
    }
    return '';
  }

  async function executeTool(
    toolName: string,
    args: Record<string, unknown>,
    ctx: {
      providerID: ProviderID;
      modelID: string;
      sessionID: string;
      messageID: string;
      agent: string;
      abort: AbortSignal;
      callID?: string;
      onToolResult?: StreamInput['onToolResult'];
    },
  ): Promise<{ title: string; output: string; metadata?: ToolMetadata }> {
    const result = await ToolRegistry.executeWithPolicy(toolName, args, {
      providerID: ctx.providerID,
      modelID: ctx.modelID,
      agentID: ctx.agent,
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      abort: ctx.abort,
      callID: ctx.callID,
      permissionSource: 'llm-service',
      onToolResult: ctx.onToolResult as any,
    });
    return {
      title: result.title,
      output: result.output,
      metadata: result.metadata,
    };
  }

  /**
   * Stream LLM response with tool calling — LLMClient-backed implementation.
   *
   * Preserves the same high-level interface as the original LLMService.stream(),
   * including agent routing, prompt building, tool setup, and callback-based
   * tool execution.
   */
  export async function stream(input: StreamInput): Promise<StreamResult> {
    const effectiveUserMessage = input.userMessage?.trim()
      ? input.userMessage
      : extractLastUserMessage(input.messages);

    // --- Agent routing ---
    let resolvedAgentId = input.agentId?.trim();
    const hasValidRequestedAgent = Boolean(resolvedAgentId && Agent.has(resolvedAgentId));
    let detectedRoute: ReturnType<typeof ModeRouter.detectAgent> | undefined;
    if (!hasValidRequestedAgent) {
      detectedRoute = ModeRouter.detectAgent({
        userQuery: effectiveUserMessage || '',
        hasPRD: false,
        hasTechStack: false,
        hasFigma: false,
        hasDetailedRequirements: false,
        hasBusinessContext: false,
      });
      resolvedAgentId = detectedRoute.agentId;
    }
    if (!resolvedAgentId) throw new Error('Failed to resolve agentId');

    const agent = Agent.get(resolvedAgentId);
    if (!agent) throw new Error(`Agent not found: ${resolvedAgentId}`);

    const effectiveRequestedMode = hasValidRequestedAgent ? agent.mode : input.mode;

    // --- Provider / model ---
    const modelProvider = (input.modelProvider || config.ai.defaultProvider) as ProviderID;
    const modelId = input.modelId || config.ai.defaultModel;

    // --- Smart context ---
    let contextResolution: {
      mode: 'creator' | 'implementer';
      platform: string;
      techStack: string[];
      sources: {
        mode: 'request' | 'smart-context';
        platform: 'request' | 'smart-context' | 'default';
        techStack: 'request' | 'smart-context' | 'default';
      };
      routing: {
        confidence: number;
        reason: string;
        score?: number;
        version?: string;
        language?: InputLanguage;
        techSignals?: string[];
      };
    } | undefined;

    try {
      const smartBuilder = await getSmartBuilder();
      const resolved = smartBuilder.resolvePromptContext({
        userInput: effectiveUserMessage || '',
        mode: effectiveRequestedMode,
        platform: input.platform,
        techStack: input.techStack,
      });
      contextResolution = {
        mode: resolved.mode,
        platform: resolved.platform,
        techStack: resolved.techStack,
        sources: resolved.sources,
        routing: {
          confidence: resolved.routing.confidence,
          reason: resolved.routing.reason,
          score: resolved.routing.score,
          version: resolved.routing.version,
          language: resolved.routing.language,
          techSignals: resolved.routing.techSignals,
        },
      };
    } catch {
      console.warn('[LLM] Smart context resolution failed, fallback to defaults');
    }

    // --- System prompt ---
    const fallbackRouting = detectedRoute
      ? {
          reason: detectedRoute.reasons.join('; '),
          confidence: detectedRoute.confidence / 100,
          score: detectedRoute.score,
          version: detectedRoute.version,
          language: detectedRoute.language,
          techSignals: detectedRoute.techSignals,
        }
      : undefined;

    const systemPrompt = await Agent.buildAgentPrompt(agent, {
      userMessage: effectiveUserMessage,
      mode: contextResolution?.mode || effectiveRequestedMode || agent.mode,
      platform:
        (contextResolution?.platform as 'web' | 'mobile' | 'desktop' | 'miniprogram') ||
        input.platform,
      techStack: contextResolution?.techStack || input.techStack || [],
      contextSources: contextResolution?.sources,
      routing: contextResolution?.routing || fallbackRouting,
    });

    input.onPromptDiagnostics?.({
      agentId: resolvedAgentId,
      promptDiagnostics: systemPrompt.diagnostics,
      contextResolution: contextResolution
        ? {
            mode: contextResolution.mode,
            platform: contextResolution.platform,
            techStack: contextResolution.techStack,
            reason: contextResolution.routing.reason,
            confidence: contextResolution.routing.confidence,
            score: contextResolution.routing.score,
            version: contextResolution.routing.version,
            language: contextResolution.routing.language,
            techSignals: contextResolution.routing.techSignals,
          }
        : fallbackRouting
          ? {
              mode: effectiveRequestedMode || agent.mode,
              platform: input.platform || 'web',
              techStack: input.techStack || [],
              reason: fallbackRouting.reason,
              confidence: fallbackRouting.confidence,
              score: fallbackRouting.score,
              version: fallbackRouting.version,
              language: fallbackRouting.language,
              techSignals: fallbackRouting.techSignals,
            }
          : undefined,
    });

    // --- Tools ---
    const registeredTools = await ToolRegistry.getForProvider(modelProvider, modelId, resolvedAgentId);
    const toolDefs: LLMToolDefinition[] = [];
    for (const t of registeredTools) {
      const init = await t.init();
      // Convert Zod schemas or plain objects to JSON Schema for LLMClient
      let inputSchema: Record<string, unknown>;
      const params = init.parameters as any;
      if (params && typeof params === 'object') {
        if (typeof params.toJSON === 'function') {
          inputSchema = params.toJSON();
        } else if (params._def) {
          inputSchema = JSON.parse(JSON.stringify(params));
        } else {
          inputSchema = params as unknown as Record<string, unknown>;
        }
      } else {
        inputSchema = {};
      }
      toolDefs.push({
        name: t.id,
        description: init.description,
        inputSchema,
      });
    }

    // --- Build messages ---
    const llmMessages: Array<{ role: 'user' | 'assistant'; content: string }> = input.messages?.length
      ? [...input.messages]
      : [];
    if (effectiveUserMessage) {
      const last = llmMessages[llmMessages.length - 1];
      const sameAsLastUser =
        last?.role === 'user' && last.content === effectiveUserMessage;
      if (!sameAsLastUser) {
        llmMessages.push({ role: 'user', content: effectiveUserMessage });
      }
    }
    if (llmMessages.length === 0) {
      llmMessages.push({ role: 'user', content: input.userMessage || '' });
    }

    console.log('[LLM] Starting LLMClient stream with:', {
      agentId: resolvedAgentId,
      modelProvider,
      modelId,
      messagesCount: llmMessages.length,
      toolsCount: toolDefs.length,
    });

    // --- Call LLMClient ---
    const client = getDefaultLLMClient();
    const isReasoningModel = modelProvider === 'openai' && /(gpt-5|o1|o3|o4|codex)/i.test(modelId);

    const streamResult = client.stream({
      provider: modelProvider,
      model: modelId,
      systemPrompt: systemPrompt.prompt || '',
      messages: llmMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      temperature: isReasoningModel ? undefined : (agent.temperature ?? config.ai.temperature),
      topP: isReasoningModel ? undefined : (agent.topP ?? config.ai.topP),
      maxOutputTokens: agent.maxTokens ?? config.ai.maxTokens,
      abortSignal: input.abort,
    });

    // --- Build backward-compatible stream result ---
    // We need to split the stream events into a textStream and collect tool calls.
    // Tool execution is handled via completeWithTools in a separate path, but for
    // backward compatibility we process tool calls from the stream events here.

    let fullText = '';
    const collectedToolCalls: Array<{
      toolName: string;
      toolCallId: string;
      args: Record<string, unknown>;
    }> = [];

    // Partial tool call accumulator
    const partialToolCalls = new Map<string, { name: string; argChunks: string[] }>();
    const executedToolCallIDs = new Set<string>();
    const pendingToolExecutions: Promise<void>[] = [];

    let textResolve: (value: string) => void;
    let toolCallsResolve: (
      value: Array<{ toolName: string; toolCallId: string; args: Record<string, unknown> }>,
    ) => void;

    const textPromise = new Promise<string>((resolve) => {
      textResolve = resolve;
    });
    const toolCallsPromise = new Promise<
      Array<{ toolName: string; toolCallId: string; args: Record<string, unknown> }>
    >((resolve) => {
      toolCallsResolve = resolve;
    });

    // Create an async generator that yields text deltas and drives the promises
    const textStream = (async function* () {
      try {
        for await (const event of streamResult.events) {
          switch (event.type) {
            case 'text_delta':
              fullText += event.text;
              yield event.text;
              break;
            case 'tool_call_start':
              partialToolCalls.set(event.id, { name: event.name, argChunks: [] });
              break;
            case 'tool_call_delta': {
              const partial = partialToolCalls.get(event.id);
              if (partial) partial.argChunks.push(event.argumentsDelta);
              break;
            }
            case 'tool_call_end': {
              const partial = partialToolCalls.get(event.id);
              if (partial) {
                let parsedArgs: Record<string, unknown> = {};
                try {
                  parsedArgs = JSON.parse(partial.argChunks.join(''));
                } catch { /* empty */ }
                if (!executedToolCallIDs.has(event.id)) {
                  executedToolCallIDs.add(event.id);
                  collectedToolCalls.push({
                    toolName: partial.name,
                    toolCallId: event.id,
                    args: parsedArgs,
                  });

                  try {
                    input.onToolCall?.({
                      toolName: partial.name,
                      callID: event.id,
                      args: parsedArgs,
                    });
                  } catch (callbackError) {
                    console.error('[LLM] onToolCall callback failed:', callbackError);
                  }

                  const toolExecution = (async () => {
                    try {
                      await executeTool(partial.name, parsedArgs, {
                        providerID: modelProvider,
                        modelID: modelId,
                        sessionID: input.sessionID,
                        messageID: input.messageID,
                        agent: resolvedAgentId!,
                        abort: input.abort || new AbortController().signal,
                        callID: event.id,
                        onToolResult: input.onToolResult,
                      });
                    } catch (err) {
                      const errorMessage = err instanceof Error ? err.message : String(err);
                      try {
                        input.onToolResult?.({
                          toolName: partial.name,
                          callID: event.id,
                          title: 'Tool Error',
                          output: `Tool execution failed: ${errorMessage}`,
                          metadata: {
                            toolExecutionFailed: true,
                            error: errorMessage,
                          },
                        });
                      } catch (callbackError) {
                        console.error('[LLM] onToolResult callback failed:', callbackError);
                      }
                      console.error(`[LLM] Tool execution error for ${partial.name}:`, err);
                    }
                  })();

                  pendingToolExecutions.push(toolExecution);
                }

                partialToolCalls.delete(event.id);
              }
              break;
            }
            case 'done':
              // Final event — resolve promises
              break;
          }
        }
      } finally {
        await Promise.all(pendingToolExecutions);
        textResolve!(fullText);
        toolCallsResolve!(collectedToolCalls);
      }
    })();

    return {
      textStream,
      text: textPromise,
      toolCalls: toolCallsPromise,
    };
  }
}
