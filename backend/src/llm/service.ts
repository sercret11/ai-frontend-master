/**
 * LLM Service - LLM Streaming with Vercel AI SDK
 * Ported from OpenCode with modifications for ai-frontend-master
 *
 * Integrates with Vercel AI SDK for streaming LLM responses with tool calling
 * Supports configurable AI providers and models via environment variables
 */

import { stepCountIs, streamText, tool, type ToolExecutionOptions } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI, type OpenAILanguageModelResponsesOptions } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { ToolRegistry } from '../tool/registry';
import { enforcePermission } from '../tool/permission-policy';
import { Agent } from '../agent/agent';
import { ModeRouter } from '../prompt/router';
import { getSmartBuilder } from '../context/integration/smart-builder';
import { config, getProviderApiKey, getProviderConfig } from '../config';
import type {
  ToolInfo,
  ToolContext,
  ToolMetadata,
  PromptBuildDiagnostics,
  InputLanguage,
  PermissionRequest,
} from '@ai-frontend/shared-types';

/**
 * LLM Service namespace
 */
export namespace LLMService {
  /**
   * Stream input parameters
   */
  export interface StreamInput {
    /** Session ID */
    sessionID: string;
    /** Message ID */
    messageID: string;
    /** Agent ID（可选，不传则自动路由） */
    agentId?: string;
    /** User message */
    userMessage: string;
    /** 可选模式提�?*/
    mode?: 'creator' | 'implementer';
    /** 可选平台提�?*/
    platform?: 'web' | 'mobile' | 'desktop' | 'miniprogram';
    /** 可选技术栈提示 */
    techStack?: string[];
    /** Model provider (optional, uses config default if not specified) */
    modelProvider?: 'anthropic' | 'openai' | 'google';
    /** Model ID (optional, uses config default if not specified) */
    modelId?: string;
    /** API key (optional, loaded from .env if not specified) */
    apiKey?: string;
    /** API base URL (optional, loaded from config if not specified) */
    baseURL?: string;
    /** Abort signal */
    abort?: AbortSignal;
    /** Maximum tool calls allowed for current stream iteration */
    maxToolCalls?: number;
    /** Conversation history */
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    /** Tool call callback (triggered when tools are executed) */
    onToolCall?: (call: { toolName: string; callID: string; args: Record<string, unknown> }) => void;
    /** Tool result callback (triggered when tool execution completes) */
    onToolResult?: (result: {
      toolName: string;
      callID: string;
      title: string;
      output: string;
      metadata?: any;
    }) => void;
    /** Prompt/上下文构建诊�?*/
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

  function extractLastUserMessage(
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>
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

  function shouldRequireToolUsage(input: {
    userMessage: string;
    mode: 'creator' | 'implementer';
    toolsCount: number;
  }): boolean {
    if (input.toolsCount === 0) return false;
    return input.mode === 'creator';
  }

  function reducePrototypeToolSet(toolSet: Record<string, any>): Record<string, any> {
    const entries = Object.entries(toolSet);
    if (entries.length <= 3) {
      return toolSet;
    }

    const focusedTools = new Set(['read', 'write', 'apply_diff']);
    const focusedEntries = entries.filter(([toolName]) => focusedTools.has(toolName));
    if (focusedEntries.length === focusedTools.size) {
      return Object.fromEntries(focusedEntries);
    }

    const preferredTools = new Set(['read', 'write', 'apply_diff']);
    const preferredEntries = entries.filter(([toolName]) => preferredTools.has(toolName));
    if (preferredEntries.length >= 2) {
      return Object.fromEntries(preferredEntries);
    }

    const exploratoryTools = new Set([
      'webfetch',
      'design_search',
      'get_color_palette',
      'get_design_style',
      'get_typography_pair',
      'get_component_list',
    ]);
    const reducedEntries = entries.filter(([toolName]) => !exploratoryTools.has(toolName));
    return reducedEntries.length > 0 ? Object.fromEntries(reducedEntries) : toolSet;
  }

  function prioritizeWriteToolSet(toolSet: Record<string, any>): Record<string, any> {
    const entries = Object.entries(toolSet);
    const writeFirstTools = new Set(['write', 'apply_diff']);
    const writeFocusedEntries = entries.filter(([toolName]) => writeFirstTools.has(toolName));
    return writeFocusedEntries.length > 0 ? Object.fromEntries(writeFocusedEntries) : toolSet;
  }

  /**
   * Execute a tool call
   */
  async function executeTool(
    toolName: string,
    args: Record<string, unknown>,
    ctx: {
      sessionID: string;
      messageID: string;
      agent: string;
      abort: AbortSignal;
      callID?: string;
      onToolCall?: (call: { toolName: string; callID: string; args: Record<string, unknown> }) => void;
      onToolResult?: (result: {
        toolName: string;
        callID: string;
        title: string;
        output: string;
        metadata?: any;
      }) => void;
    }
  ): Promise<{ title: string; output: string; metadata?: ToolMetadata }> {
    const toolInfo = await ToolRegistry.getById(toolName);

    if (!toolInfo) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const initialized = await toolInfo.init();
    const callID =
      ctx.callID?.trim() ||
      `${ctx.messageID}-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create tool context
    const toolCtx: Omit<ToolContext, 'callID'> & { callID?: string } = {
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      agent: ctx.agent,
      abort: ctx.abort,
      callID,
      metadata: data => {
        // Emit metadata event (would be sent via WebSocket in production)
        console.log(`[Tool] ${toolName} metadata:`, data);
      },
      ask: async (req: PermissionRequest) => {
        await enforcePermission(req, {
          source: 'llm-service',
          agent: ctx.agent,
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID,
          toolName,
        });
      },
      onToolCall: ctx.onToolCall,
    };

    // Notify about tool call immediately
    if (ctx.onToolCall) {
      ctx.onToolCall({
        toolName,
        callID,
        args,
      });
    }

    // Execute tool
    const result = await initialized.execute(args, toolCtx as ToolContext);

    // Trigger tool result callback if provided
    if (ctx.onToolResult) {
      ctx.onToolResult({
        toolName,
        callID,
        title: result.title,
        output: result.output,
        metadata: result.metadata,
      });
    }

    return result;
  }

  /**
   * Stream LLM response with tool calling
   *
   * @param input - Stream parameters
   * @returns Stream result
   */
  export async function stream(input: StreamInput): Promise<any> {
    const effectiveUserMessage = input.userMessage?.trim()
      ? input.userMessage
      : extractLastUserMessage(input.messages);

    // 自动路由（当请求未传 agentId 或 agentId 不存在时）
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
    if (!resolvedAgentId) {
      throw new Error('Failed to resolve agentId');
    }

    const agent = Agent.get(resolvedAgentId);
    if (!agent) {
      throw new Error(`Agent not found: ${resolvedAgentId}`);
    }
    // 显式指定 agent 时，始终锁定为该 agent �?mode，避免与 smart-context 自动判定冲突
    const effectiveRequestedMode = hasValidRequestedAgent ? agent.mode : input.mode;

    // Use config defaults if not specified
    const modelProvider = input.modelProvider || (config.ai.defaultProvider as any);
    const modelId = input.modelId || config.ai.defaultModel;

    // Load API key from server-side config only.
    // Client-supplied keys are ignored to prevent credential passthrough.
    const apiKey = getProviderApiKey(modelProvider);

    // Smart context 轻量解析（模�?平台/技术栈�?
    let contextResolution:
      | {
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
        }
      | undefined;

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
    } catch (error) {
      console.warn('[LLM] Smart context resolution failed, fallback to defaults:', error);
    }

    // Build system prompt（注入动态上下文�?
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
      platform: (contextResolution?.platform as 'web' | 'mobile' | 'desktop' | 'miniprogram') || input.platform,
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

    console.log('[LLM] System prompt length:', systemPrompt.prompt?.length || 0);
    console.log('[LLM] System prompt preview:', systemPrompt.prompt?.substring ? systemPrompt.prompt.substring(0, 500) : '(empty)');

    // Get available tools
    const tools = await ToolRegistry.getForProvider(modelProvider, modelId, resolvedAgentId);

    console.log('[LLM] Available tools:', tools.map(t => t.id));

    // Convert tools to Vercel AI SDK format
    const toolSet: Record<string, any> = {};

    for (const toolInfo of tools) {
      const initialized = await toolInfo.init();
      console.log('[LLM] Tool:', toolInfo.id, 'description length:', initialized.description?.length || 0);

      toolSet[toolInfo.id] = tool({
        description: initialized.description,
        // 传递原始的 Zod schema，让 Vercel AI SDK 自己转换
        inputSchema: initialized.parameters as any,
        execute: async (
          args: Record<string, unknown>,
          options?: ToolExecutionOptions
        ) => {
          // Execute the tool
          const result = await executeTool(toolInfo.id, args, {
            sessionID: input.sessionID,
            messageID: input.messageID,
            agent: resolvedAgentId,
            abort: input.abort || new AbortController().signal,
            callID: options?.toolCallId,
            onToolCall: input.onToolCall,
            onToolResult: input.onToolResult,
          });

          return result.output;
        },
      } as any);
    }

    // Get provider configuration
    const providerConfig = getProviderConfig(modelProvider);
    const resolveProviderBaseURL = (rawBaseURL: string): string => {
      const trimmed = rawBaseURL.trim();
      if (!trimmed || modelProvider !== 'openai') {
        return trimmed;
      }

      try {
        const parsed = new URL(trimmed);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');
        if (!normalizedPath || normalizedPath === '/') {
          parsed.pathname = '/v1';
          return parsed.toString().replace(/\/$/, '');
        }
        return trimmed;
      } catch {
        if (/\/v\d+$/i.test(trimmed)) {
          return trimmed;
        }
        return `${trimmed.replace(/\/+$/, '')}/v1`;
      }
    };
    const providerBaseURL = resolveProviderBaseURL(providerConfig.baseURL || '');

    // Create provider instance with custom base URL if provided
    let provider: any;
    let openaiFactory: ReturnType<typeof createOpenAI> | undefined;
    let usingOpenAIChatFallback = false;
    switch (modelProvider) {
      case 'anthropic': {
        const anthropic = createAnthropic({
          apiKey,
          baseURL: providerBaseURL,
        });
        provider = anthropic(modelId);
        break;
      }

      case 'openai': {
        const openai = createOpenAI({
          apiKey,
          baseURL: providerBaseURL,
        });
        openaiFactory = openai;
        const isThirdPartyOpenAICompatibleBaseURL =
          providerBaseURL.length > 0 &&
          !/^https?:\/\/api\.openai\.com\/v1\/?$/i.test(providerBaseURL);
        if (isThirdPartyOpenAICompatibleBaseURL) {
          provider = openai(modelId);
          console.warn(
            `[LLM] Detected third-party OpenAI-compatible baseURL, keeping responses endpoint by default and enabling compatibility fallback (model=${modelId})`
          );
        } else {
          provider = openai(modelId);
        }
        break;
      }

      case 'google': {
        const google = createGoogleGenerativeAI({
          apiKey,
          baseURL: providerBaseURL,
        });
        provider = google(modelId);
        break;
      }

      case 'zhipuai': {
        const zhipuai = createOpenAI({
          apiKey,
          baseURL: providerBaseURL,
        });
        provider = zhipuai(modelId);
        break;
      }

      case 'dashscope': {
        const dashscope = createOpenAI({
          apiKey,
          baseURL: providerBaseURL,
        });
        provider = dashscope(modelId);
        break;
      }

      default:
        throw new Error(`Unsupported provider: ${modelProvider}`);
    }

    // Build messages array（确保本轮用户消息被纳入上下文）
    const messages = input.messages?.length ? [...input.messages] : [];
    if (effectiveUserMessage) {
      const last = messages[messages.length - 1];
      const sameAsLastUser =
        last?.role === 'user' && typeof last.content === 'string' && last.content === effectiveUserMessage;
      if (!sameAsLastUser) {
        messages.push({ role: 'user', content: effectiveUserMessage });
      }
    }

    if (messages.length === 0) {
      messages.push({ role: 'user', content: input.userMessage || '' });
    }

    console.log('[LLM] Starting stream with:', {
      agentId: resolvedAgentId,
      modelProvider,
      modelId,
      apiKey: apiKey ? '***' : undefined,
      baseURL: providerBaseURL,
      messagesCount: messages.length,
      toolsCount: Object.keys(toolSet).length,
      reasoningEffort: modelProvider === 'openai' ? config.ai.reasoningEffort : undefined,
    });

    const buildProviderOptions = (): { openai: OpenAILanguageModelResponsesOptions } | undefined => {
      if (modelProvider !== 'openai') {
        return undefined;
      }
      if (usingOpenAIChatFallback) {
        return undefined;
      }
      return {
        openai: {
          reasoningEffort: config.ai.reasoningEffort,
          store: true,
          parallelToolCalls: false,
        },
      };
    };

    const effectiveMode = contextResolution?.mode || effectiveRequestedMode || agent.mode;
    const shouldForceToolUsageForAgent = resolvedAgentId === 'frontend-implementer';
    const shouldRequirePrototypeToolUsage =
      shouldForceToolUsageForAgent ||
      shouldRequireToolUsage({
        userMessage: effectiveUserMessage || '',
        mode: effectiveMode,
        toolsCount: Object.keys(toolSet).length,
      });
    let streamToolSet = toolSet;
    const shouldReducePrototypeToolSet = shouldRequirePrototypeToolUsage;
    const shouldPrioritizeWritePhase = shouldReducePrototypeToolSet;
    if (shouldReducePrototypeToolSet) {
      streamToolSet = reducePrototypeToolSet(streamToolSet);
    }
    if (shouldPrioritizeWritePhase) {
      streamToolSet = prioritizeWriteToolSet(streamToolSet);
    }

    const toolChoice = shouldRequirePrototypeToolUsage ? 'required' : 'auto';
    console.log('[LLM] Tool choice strategy:', {
      toolChoice,
      shouldReducePrototypeToolSet,
      shouldPrioritizeWritePhase,
      shouldRequirePrototypeToolUsage,
      effectiveMode,
      enabledTools: Object.keys(streamToolSet),
    });
    const maxToolCallsPerStream = Math.max(
      1,
      Math.min(
        Math.floor(input.maxToolCalls ?? config.tools.maxCallsPerMessage),
        shouldRequirePrototypeToolUsage ? 16 : Number.POSITIVE_INFINITY
      )
    );

    const isRetriableError = (error: any): boolean => {
      const statusCode = Number(error?.statusCode ?? error?.status ?? 0);
      if ([429, 500, 502, 503, 504].includes(statusCode)) {
        return true;
      }
      const code = typeof error?.code === 'string' ? error.code : '';
      return ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code);
    };

    // Retry logic with exponential backoff + jitter
    let retryCount = 0;
    let emptyResultRetryCount = 0;
    const maxRetries = 3;
    const retryDelay = 2000;
    const maxEmptyResultRetries = 2;
    let streamToolChoice: 'auto' | 'required' = toolChoice;
    let noOutputFallbackUsed = false;
    let responsesToChatFallbackUsed = false;
    let chatToResponsesRecoveryUsed = false;

    const isNoOutputGeneratedError = (error: any): boolean => {
      if (!error) return false;
      const name = typeof error?.name === 'string' ? error.name : '';
      const message = typeof error?.message === 'string' ? error.message : '';
      const code = typeof error?.code === 'string' ? error.code : '';
      return /NoOutputGeneratedError|AI_NoOutputGeneratedError/i.test(
        `${name} ${code} ${message}`
      );
    };
    const collectErrorSignals = (root: any): string => {
      if (!root) return '';
      const queue: any[] = [root];
      const visited = new Set<any>();
      const signals: string[] = [];

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || visited.has(current)) {
          continue;
        }
        if (typeof current !== 'object' && typeof current !== 'function') {
          continue;
        }
        visited.add(current);

        for (const key of ['name', 'message', 'code', 'reason', 'url', 'responseBody']) {
          const value = current[key];
          if (typeof value === 'string' && value.trim()) {
            signals.push(value);
          }
        }

        const statusValue = current?.statusCode ?? current?.status;
        if (typeof statusValue === 'number') {
          signals.push(`status:${statusValue}`);
        }

        if (Array.isArray(current?.errors)) {
          queue.push(...current.errors);
        }
        if (current?.lastError) {
          queue.push(current.lastError);
        }
        if (current?.cause) {
          queue.push(current.cause);
        }
      }

      return signals.join(' ');
    };
    const isOpenAIResponsesToolContextError = (error: any): boolean => {
      const signal = collectErrorSignals(error);
      return /function_call_output requires item_reference ids matching each call_id/i.test(
        signal
      );
    };
    const isOpenAIResponsesTransportError = (error: any): boolean => {
      const signal = collectErrorSignals(error).toLowerCase();
      if (!signal) return false;
      const touchesResponses =
        signal.includes('/responses') || signal.includes('responses-language-model');
      if (!touchesResponses) return false;
      const unsupportedStatus =
        /status[:= ](?:400|404|405|415|422|501)\b/.test(signal) ||
        /statuscode[:= ](?:400|404|405|415|422|501)\b/.test(signal);

      // Only fallback when the endpoint is clearly unsupported by provider contract.
      // Transient network failures should stay on the current endpoint and be handled by retry logic.
      return unsupportedStatus;
    };

    while (retryCount <= maxRetries) {
      let lastStreamError: any;
      let lastFinishReason: string | undefined;
      let lastFinishOutputTokens = 0;
      const isOpenAIReasoningModel =
        modelProvider === 'openai' && /(gpt-5|o1|o3|o4|codex)/i.test(modelId);
      try {
        // Stream the response
        const result = streamText({
          model: provider,
          system: systemPrompt.prompt,
          messages,
          tools: streamToolSet,
          toolChoice: streamToolChoice,
          temperature: isOpenAIReasoningModel
            ? undefined
            : (agent.temperature ?? config.ai.temperature),
          topP: isOpenAIReasoningModel ? undefined : (agent.topP ?? config.ai.topP),
          maxOutputTokens: agent.maxTokens ?? config.ai.maxTokens,
          stopWhen: stepCountIs(maxToolCallsPerStream),
          providerOptions: buildProviderOptions(),
          abortSignal: input.abort,
          onFinish: ({ finishReason, usage, text }) => {
            lastFinishReason = finishReason;
            lastFinishOutputTokens = usage?.outputTokens ?? 0;
            console.log('[LLM] Stream finished', {
              finishReason,
              outputTokens: usage?.outputTokens ?? 0,
              textLength: typeof text === 'string' ? text.length : 0,
            });
          },
          onError: ({ error }) => {
            lastStreamError = error;
            console.error('[LLM] Stream emitted error event:', error);
          },
        });
        const textIterator = result.textStream[Symbol.asyncIterator]();
        const firstDelta = await textIterator.next();
        if (!firstDelta.done) {
          const replayTextStream = (async function* () {
            yield firstDelta.value;
            while (true) {
              const nextDelta = await textIterator.next();
              if (nextDelta.done) break;
              yield nextDelta.value;
            }
          })();
          const proxiedResult = new Proxy(result as object, {
            get(target, property, receiver) {
              if (property === 'textStream') {
                return replayTextStream;
              }
              return Reflect.get(target, property, receiver);
            },
          });
          console.log('[LLM] Stream started successfully with incremental output');
          return proxiedResult;
        }

        const [finalText, rawToolCalls, finalFinishReason] = await Promise.all([
          result.text,
          result.toolCalls,
          result.finishReason,
        ]);
        const toolCalls = Array.isArray(rawToolCalls) ? rawToolCalls : [];
        if (
          modelProvider === 'openai' &&
          !usingOpenAIChatFallback &&
          openaiFactory &&
          lastStreamError
        ) {
          if (isOpenAIResponsesToolContextError(lastStreamError) && toolCalls.length > 0) {
            console.warn(
              '[LLM] Responses tool context mismatch occurred after tool execution; accepting partial tool results for this iteration'
            );
          } else if (
            !responsesToChatFallbackUsed &&
            isOpenAIResponsesToolContextError(lastStreamError)
          ) {
            responsesToChatFallbackUsed = true;
            usingOpenAIChatFallback = true;
            provider = openaiFactory.chat(modelId as any);
            streamToolChoice = toolChoice;
            noOutputFallbackUsed = false;
            emptyResultRetryCount = 0;
            console.warn(
              '[LLM] Responses tool context mismatch observed via onError event; retrying with OpenAI chat endpoint fallback'
            );
            continue;
          }

          if (
            !responsesToChatFallbackUsed &&
            isOpenAIResponsesTransportError(lastStreamError)
          ) {
            responsesToChatFallbackUsed = true;
            usingOpenAIChatFallback = true;
            provider = openaiFactory.chat(modelId as any);
            streamToolChoice = toolChoice;
            noOutputFallbackUsed = false;
            emptyResultRetryCount = 0;
            console.warn(
              '[LLM] Responses transport issue observed via onError event; retrying with OpenAI chat endpoint fallback'
            );
            continue;
          }
        }
        const normalizedText = typeof finalText === 'string' ? finalText.trim() : '';
        const resolvedFinishReason = finalFinishReason || lastFinishReason;
        const isHardEmptyCompletion =
          normalizedText.length === 0 &&
          toolCalls.length === 0 &&
          (resolvedFinishReason === 'stop' || resolvedFinishReason === 'other') &&
          lastFinishOutputTokens === 0;

        if (
          modelProvider === 'openai' &&
          usingOpenAIChatFallback &&
          !chatToResponsesRecoveryUsed &&
          openaiFactory &&
          isHardEmptyCompletion
        ) {
          chatToResponsesRecoveryUsed = true;
          usingOpenAIChatFallback = false;
          provider = openaiFactory(modelId);
          streamToolChoice = toolChoice;
          noOutputFallbackUsed = false;
          emptyResultRetryCount = 0;
          console.warn(
            '[LLM] Chat fallback returned empty completion, retrying once with OpenAI responses endpoint'
          );
          continue;
        }
        const isSilentCompletion =
          finalFinishReason === 'other' && normalizedText.length === 0 && toolCalls.length === 0;

        if (isSilentCompletion && emptyResultRetryCount < maxEmptyResultRetries) {
          emptyResultRetryCount += 1;
          const waitTime = 400 + Math.floor(Math.random() * 400);
          console.warn(
            `[LLM] Empty completion detected (finishReason=other), retry ${emptyResultRetryCount}/${maxEmptyResultRetries} after ${waitTime}ms`
          );
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        if (isSilentCompletion) {
          console.error('[LLM] Empty completion persisted after retries', {
            finishReason: finalFinishReason,
            textLength: normalizedText.length,
            toolCallsCount: toolCalls.length,
          });
        } else {
          console.log('[LLM] Stream completed without text deltas but has terminal payload', {
            finishReason: finalFinishReason,
            textLength: normalizedText.length,
            toolCallsCount: toolCalls.length,
          });
        }

        return result;
      } catch (error: any) {
        const fallbackProbeError =
          isNoOutputGeneratedError(error) && lastStreamError ? lastStreamError : error;

        if (
          modelProvider === 'openai' &&
          !usingOpenAIChatFallback &&
          !responsesToChatFallbackUsed &&
          openaiFactory &&
          isOpenAIResponsesToolContextError(fallbackProbeError)
        ) {
          responsesToChatFallbackUsed = true;
          usingOpenAIChatFallback = true;
          provider = openaiFactory.chat(modelId as any);
          streamToolChoice = toolChoice;
          console.warn(
            '[LLM] Responses tool context mismatch detected; retrying with OpenAI chat endpoint fallback'
          );
          continue;
        }

        if (
          modelProvider === 'openai' &&
          !usingOpenAIChatFallback &&
          !responsesToChatFallbackUsed &&
          openaiFactory &&
          isOpenAIResponsesTransportError(fallbackProbeError)
        ) {
          responsesToChatFallbackUsed = true;
          usingOpenAIChatFallback = true;
          provider = openaiFactory.chat(modelId as any);
          streamToolChoice = toolChoice;
          noOutputFallbackUsed = false;
          emptyResultRetryCount = 0;
          console.warn(
            '[LLM] Responses endpoint unavailable for current provider; retrying with OpenAI chat endpoint fallback'
          );
          continue;
        }

        if (
          isNoOutputGeneratedError(error) &&
          streamToolChoice === 'required' &&
          !noOutputFallbackUsed
        ) {
          noOutputFallbackUsed = true;
          streamToolChoice = 'auto';
          console.warn(
            '[LLM] No output generated under toolChoice=required, fallback to toolChoice=auto and retry once'
          );
          continue;
        }

        if (isRetriableError(error) && retryCount < maxRetries) {
          retryCount++;
          const baseDelay = retryDelay * Math.pow(2, retryCount - 1);
          const jitter = Math.floor(Math.random() * 500);
          const waitTime = baseDelay + jitter;
          console.warn(
            `[LLM] transient error, retry ${retryCount}/${maxRetries} after ${waitTime}ms`,
            {
              statusCode: error?.statusCode ?? error?.status,
              code: error?.code,
            }
          );

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        // For other errors or max retries exceeded
        console.error('[LLM] Stream failed:', error);
        throw error;
      }
    }

    // Should not reach here, but TypeScript needs it
    throw new Error('Max retries exceeded');
  }
}



