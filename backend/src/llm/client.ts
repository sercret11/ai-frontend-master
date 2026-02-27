/**
 * LLMClient - 统一 LLM 调用客户端
 *
 * 通过 ProviderAdapter 模式隔离各提供商 API 差异，
 * 集成 RetryEngine 实现自动重试，支持 AbortSignal 取消。
 *
 * 需求: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R8.1, R8.4, R8.5
 */

import type {
  ProviderID,
  LLMRequestParams,
  LLMResponse,
  LLMStreamResult,
  LLMError,
  StreamEvent,
  ToolCall,
  LLMMessage,
  ContentBlock,
  ToolExecutor,
} from './types.js';
import type { ProviderAdapter } from './adapters/types.js';
import { RetryEngine } from './retry.js';
import { StreamHandler } from './stream-handler.js';

export class LLMClient {
  private streamHandler: StreamHandler;

  constructor(
    private adapters: Map<ProviderID, ProviderAdapter>,
    private retryEngine: RetryEngine,
    streamHandler?: StreamHandler,
  ) {
    this.streamHandler = streamHandler ?? new StreamHandler();
  }

  /**
   * Non-streaming LLM completion.
   *
   * 1. Look up adapter for params.provider
   * 2. adapter.buildRequest(params) → { url, headers, body }
   * 3. retryEngine.execute() wraps the fetch with retry logic
   * 4. fetch(url, { method: 'POST', headers, body, signal })
   * 5. On non-ok response → adapter.convertError(status, body) → throw
   * 6. Parse JSON → adapter.parseResponse(json) → LLMResponse
   */
  async complete(params: LLMRequestParams): Promise<LLMResponse> {
    const adapter = this.adapters.get(params.provider);
    if (!adapter) {
      throw this.makeProviderNotFoundError(params.provider);
    }

    const { url, headers, body } = adapter.buildRequest(params);

    return this.retryEngine.execute(async (signal: AbortSignal) => {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(errorBody);
        } catch {
          parsedBody = errorBody;
        }
        throw adapter.convertError(response.status, parsedBody);
      }

      const json: unknown = await response.json();
      return adapter.parseResponse(json);
    }, params.abortSignal);
  }

  /**
   * Streaming LLM completion.
   *
   * 1. Look up adapter for params.provider
   * 2. adapter.buildRequest(params) — inject `stream: true` into body
   * 3. fetch(url, { method: 'POST', headers, body, signal })
   * 4. StreamHandler.parseSSEStream(response, adapter) → AsyncGenerator<StreamEvent>
   * 5. Wrapper yields events, accumulates text + tool calls
   * 6. On `done` event → resolve the response promise with final LLMResponse
   * 7. Mid-stream disconnection triggers a retry
   *
   * Returns { events, response } where events is AsyncIterable<StreamEvent>
   * and response is a Promise that resolves when the stream completes.
   *
   * 需求: R5.3, R5.4, R8.4
   */
  stream(params: LLMRequestParams): LLMStreamResult {
    const adapter = this.adapters.get(params.provider);
    if (!adapter) {
      throw this.makeProviderNotFoundError(params.provider);
    }

    const { url, headers, body } = adapter.buildRequest(params);

    // Inject stream: true into the request body
    const streamBody = typeof body === 'object' && body !== null
      ? { ...(body as Record<string, unknown>), stream: true }
      : body;

    let resolveResponse!: (value: LLMResponse) => void;
    let rejectResponse!: (reason: unknown) => void;
    const responsePromise = new Promise<LLMResponse>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });

    // Capture references for the closure (adapter is guaranteed non-null here)
    const resolvedAdapter = adapter;
    const streamHandlerRef = this.streamHandler;
    const retryEngineRef = this.retryEngine;
    const isAbortErrorFn = this.isAbortError;
    const maxStreamRetries = 2;

    async function* generateEvents(): AsyncGenerator<StreamEvent> {
      let attempt = 0;

      while (attempt <= maxStreamRetries) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(streamBody),
            signal: params.abortSignal,
          });

          if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            let parsedBody: unknown;
            try {
              parsedBody = JSON.parse(errorBody);
            } catch {
              parsedBody = errorBody;
            }
            throw resolvedAdapter.convertError(response.status, parsedBody);
          }

          // Accumulate text and tool calls from the stream
          let accumulatedText = '';
          const toolCallMap = new Map<string, { id: string; name: string; args: string }>();
          let finalResponse: LLMResponse | null = null;

          const sseStream = streamHandlerRef.parseSSEStream(response, resolvedAdapter);

          for await (const event of sseStream) {
            switch (event.type) {
              case 'text_delta':
                accumulatedText += event.text;
                break;
              case 'tool_call_start':
                toolCallMap.set(event.id, { id: event.id, name: event.name, args: '' });
                break;
              case 'tool_call_delta': {
                const tc = toolCallMap.get(event.id);
                if (tc) {
                  tc.args += event.argumentsDelta;
                }
                break;
              }
              case 'tool_call_end':
                // No additional accumulation needed
                break;
              case 'done':
                finalResponse = event.response;
                break;
            }

            yield event;
          }

          // Stream completed successfully — resolve the response promise
          if (finalResponse) {
            resolveResponse(finalResponse);
          } else {
            // No done event received — build response from accumulated data
            const toolCalls: ToolCall[] = [];
            for (const tc of toolCallMap.values()) {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(tc.args) as Record<string, unknown>;
              } catch {
                // leave as empty object if args aren't valid JSON
              }
              toolCalls.push({ id: tc.id, name: tc.name, arguments: parsedArgs });
            }

            const fallbackResponse: LLMResponse = {
              text: accumulatedText,
              toolCalls,
              finishReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            };
            resolveResponse(fallbackResponse);
          }

          // Stream completed — exit the retry loop
          return;
        } catch (error: unknown) {
          // If aborted, don't retry
          if (isAbortErrorFn(error)) {
            rejectResponse(error);
            throw error;
          }

          // If retryable and we have attempts left, retry
          if (retryEngineRef.isRetryable(error) && attempt < maxStreamRetries) {
            attempt++;
            continue;
          }

          // Non-retryable or exhausted retries
          rejectResponse(error);
          throw error;
        }
      }
    }

    const events = generateEvents();

    return { events, response: responsePromise };
  }

  /**
   * LLM completion with tool calling loop.
   *
   * Loop logic:
   * 1. Call LLM with current messages
   * 2. Check finishReason:
   *    - If 'stop' or 'max_tokens' or 'error' → return response
   *    - If 'tool_use' → execute tools → inject tool results → call LLM again
   * 3. Repeat until finishReason is not 'tool_use' or maxRounds reached
   *
   * Features:
   * - Supports multiple tool calls in single response (parallel execution)
   * - Tool execution errors returned as tool_result with isError: true
   * - Empty response (no text and no tool calls) auto-retries once
   * - maxRounds parameter prevents infinite loops (default 10)
   *
   * 需求: R7.1, R7.2, R7.3, R7.4, R7.5, R8.6
   */
  async completeWithTools(
    params: LLMRequestParams,
    toolExecutor: ToolExecutor,
    maxRounds: number = 10,
  ): Promise<LLMResponse> {
    // Clone messages to avoid mutating the original
    const messages: LLMMessage[] = [...params.messages];
    let emptyResponseRetried = false;
    let round = 0;

    while (round < maxRounds) {
      // Build request params with current messages
      const currentParams: LLMRequestParams = {
        ...params,
        messages,
      };

      // Call LLM
      const response = await this.complete(currentParams);

      // Check for empty response (no text and no tool calls)
      const isEmpty = !response.text.trim() && response.toolCalls.length === 0;
      if (isEmpty && !emptyResponseRetried) {
        // Auto-retry once for empty response (R8.6)
        emptyResponseRetried = true;
        continue;
      }

      // If not tool_use, return the response
      if (response.finishReason !== 'tool_use' || response.toolCalls.length === 0) {
        return response;
      }

      // Execute tools in parallel (R7.3)
      const toolResults = await this.executeToolsInParallel(
        response.toolCalls,
        toolExecutor,
      );

      // Add assistant message with tool calls to conversation
      const assistantContent: ContentBlock[] = [];
      if (response.text) {
        assistantContent.push({ type: 'text', text: response.text });
      }
      for (const toolCall of response.toolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.arguments,
        });
      }
      messages.push({
        role: 'assistant',
        content: assistantContent,
      });

      // Add tool results to conversation (R7.2, R7.4)
      const toolResultContent: ContentBlock[] = toolResults.map((result) => ({
        type: 'tool_result' as const,
        toolUseId: result.toolUseId,
        content: result.content,
        isError: result.isError,
      }));
      messages.push({
        role: 'tool_result',
        content: toolResultContent,
      });

      round++;
      // Reset empty response retry flag for next round
      emptyResponseRetried = false;
    }

    // maxRounds reached - return the last response or a synthetic one
    // Make one final call to get a response without expecting more tool calls
    const finalParams: LLMRequestParams = {
      ...params,
      messages,
    };
    return this.complete(finalParams);
  }

  /**
   * Execute multiple tool calls in parallel.
   * Returns results in the same order as input tool calls.
   * Errors are captured and returned as isError: true (R7.4).
   */
  private async executeToolsInParallel(
    toolCalls: ToolCall[],
    toolExecutor: ToolExecutor,
  ): Promise<Array<{ toolUseId: string; content: string; isError?: boolean }>> {
    const results = await Promise.all(
      toolCalls.map(async (toolCall) => {
        try {
          const result = await toolExecutor(toolCall.name, toolCall.arguments);
          return {
            toolUseId: toolCall.id,
            content: result.content,
            isError: result.isError,
          };
        } catch (error: unknown) {
          // Tool execution error - return as tool_result with isError: true (R7.4)
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          return {
            toolUseId: toolCall.id,
            content: `Tool execution error: ${errorMessage}`,
            isError: true,
          };
        }
      }),
    );
    return results;
  }

  private isAbortError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true;
    }
    if (error != null && typeof error === 'object' && 'name' in error) {
      return (error as { name: string }).name === 'AbortError';
    }
    return false;
  }

  private makeProviderNotFoundError(provider: string): LLMError {
    const err = new Error(
      `No adapter registered for provider: ${provider}`,
    ) as LLMError;
    err.provider = provider as ProviderID;
    err.statusCode = 0;
    err.retryable = false;
    return err;
  }
}
