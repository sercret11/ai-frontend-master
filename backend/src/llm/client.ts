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

const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 600_000;

export class LLMClient {
  private streamHandler: StreamHandler;
  private requestTimeoutMs: number;

  constructor(
    private adapters: Map<ProviderID, ProviderAdapter>,
    private retryEngine: RetryEngine,
    streamHandler?: StreamHandler,
  ) {
    this.streamHandler = streamHandler ?? new StreamHandler();
    this.requestTimeoutMs = this.resolveRequestTimeoutMs();
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
      const requestSignal = this.createRequestSignal(signal, params.abortSignal);
      const response = await Promise.race([
        fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: requestSignal,
        }),
        this.rejectAfter(
          this.requestTimeoutMs,
          `LLM request timed out before response headers (provider=${params.provider}, model=${params.model})`,
        ),
      ]);

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

      const rawBody = await Promise.race([
        response.text(),
        this.rejectAfter(
          this.requestTimeoutMs,
          `LLM response body timed out (provider=${params.provider}, model=${params.model})`,
        ),
      ]);
      const bodyText = typeof rawBody === 'string' ? rawBody : '';
      const parsedSse = this.extractResponseFromSSE(bodyText);
      if (parsedSse != null) {
        return adapter.parseResponse(parsedSse);
      }

      const trimmed = bodyText.trim();
      const json: unknown = trimmed.length > 0 ? JSON.parse(trimmed) : {};
      return adapter.parseResponse(json);
    }, params.abortSignal);
  }

  /**
   * Streaming-first completion used by multi-agent runtime paths.
   *
   * This method drains stream events and returns the final aggregated response.
   * If the stream path fails for non-abort reasons, it falls back to one
   * non-stream completion for compatibility.
   */
  async completeStreaming(params: LLMRequestParams): Promise<LLMResponse> {
    const { events, response } = this.stream(params);
    try {
      for await (const _event of events) {
        // Drain stream events to drive response aggregation.
      }
      return await response;
    } catch (error: unknown) {
      // Avoid unhandled rejection from the response promise when stream throws.
      await response.catch(() => undefined);
      if (this.isAbortError(error)) {
        throw error;
      }
      return this.complete(params);
    }
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
    const createRequestSignalFn = this.createRequestSignal.bind(this);
    const rejectAfterFn = this.rejectAfter.bind(this);
    const extractResponseFromSSEFn = this.extractResponseFromSSE.bind(this);
    const requestTimeoutMs = this.requestTimeoutMs;
    const maxStreamRetries = 2;

    async function* generateEvents(): AsyncGenerator<StreamEvent> {
      let attempt = 0;

      while (attempt <= maxStreamRetries) {
        try {
          const requestSignal = createRequestSignalFn(params.abortSignal);
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(streamBody),
            signal: requestSignal,
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

          const contentType = response.headers.get('content-type') ?? '';
          const isSse = contentType.toLowerCase().includes('text/event-stream');
          if (!isSse) {
            const rawBody = await Promise.race([
              response.text(),
              rejectAfterFn(
                requestTimeoutMs,
                `LLM stream fallback body timed out (provider=${params.provider}, model=${params.model})`,
              ),
            ]);
            const bodyText = typeof rawBody === 'string' ? rawBody : '';
            const parsedSse = extractResponseFromSSEFn(bodyText);
            if (parsedSse != null) {
              resolveResponse(resolvedAdapter.parseResponse(parsedSse));
              return;
            }
            const trimmed = bodyText.trim();
            const json: unknown = trimmed.length > 0 ? JSON.parse(trimmed) : {};
            resolveResponse(resolvedAdapter.parseResponse(json));
            return;
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
      const response = await this.completeStreaming(currentParams);

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
    return this.completeStreaming(finalParams);
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

  private resolveRequestTimeoutMs(): number {
    const timeoutMs = Number(
      process.env.LLM_REQUEST_TIMEOUT_MS ?? DEFAULT_LLM_REQUEST_TIMEOUT_MS,
    );
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return DEFAULT_LLM_REQUEST_TIMEOUT_MS;
    }
    return Math.floor(timeoutMs);
  }

  private extractResponseFromSSE(bodyText: string): Record<string, unknown> | null {
    if (!bodyText || !bodyText.includes('event:')) {
      return null;
    }

    const blocks = bodyText.split(/\r?\n\r?\n/);
    let latestResponse: Record<string, unknown> | null = null;
    const textDeltas: string[] = [];
    const functionCalls = new Map<
      string,
      { id: string; name: string; argumentsDeltas: string[] }
    >();

    for (const block of blocks) {
      if (!block.trim()) {
        continue;
      }
      const lines = block.split(/\r?\n/);
      let eventName = '';
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }

      if (dataLines.length === 0) {
        continue;
      }
      const dataPayload = dataLines.join('\n').trim();
      if (!dataPayload || dataPayload === '[DONE]') {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(dataPayload);
      } catch {
        continue;
      }

      if (!parsed || typeof parsed !== 'object') {
        continue;
      }

      const record = parsed as Record<string, unknown>;
      const parsedEventType =
        typeof record.type === 'string' ? record.type : '';
      const eventType = eventName || parsedEventType;
      const responseCandidate = record.response;
      if (responseCandidate && typeof responseCandidate === 'object' && !Array.isArray(responseCandidate)) {
        latestResponse = responseCandidate as Record<string, unknown>;
        if (eventType === 'response.completed') {
          break;
        }
        continue;
      }

      if (
        eventType === 'response.output_text.delta' ||
        eventType === 'response.content_part.delta'
      ) {
        const delta =
          typeof record.delta === 'string' ? record.delta : '';
        if (delta) {
          textDeltas.push(delta);
        }
      }

      if (eventType === 'response.output_item.added') {
        const item = record.item as Record<string, unknown> | undefined;
        if (item && item.type === 'function_call') {
          const id =
            typeof item.call_id === 'string'
              ? item.call_id
              : typeof item.id === 'string'
                ? item.id
                : '';
          const name = typeof item.name === 'string' ? item.name : '';
          const existing = functionCalls.get(id) ?? {
            id,
            name,
            argumentsDeltas: [],
          };
          if (name && !existing.name) {
            existing.name = name;
          }
          functionCalls.set(id, existing);
        }
      }

      if (eventType === 'response.function_call_arguments.delta') {
        const id =
          typeof record.item_id === 'string' ? record.item_id : '';
        if (id) {
          const existing = functionCalls.get(id) ?? {
            id,
            name: '',
            argumentsDeltas: [],
          };
          const delta =
            typeof record.delta === 'string' ? record.delta : '';
          if (delta) {
            existing.argumentsDeltas.push(delta);
          }
          functionCalls.set(id, existing);
        }
      }

      if (eventType === 'response.completed') {
        const outputCandidate = record.output;
        if (Array.isArray(outputCandidate)) {
          latestResponse = record;
          break;
        }
        continue;
      }
    }

    if (latestResponse) {
      return latestResponse;
    }

    if (textDeltas.length === 0 && functionCalls.size === 0) {
      return null;
    }

    const output: Array<Record<string, unknown>> = [];
    if (textDeltas.length > 0) {
      output.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: textDeltas.join('') }],
      });
    }

    for (const fnCall of functionCalls.values()) {
      output.push({
        type: 'function_call',
        call_id: fnCall.id,
        name: fnCall.name,
        arguments: fnCall.argumentsDeltas.join(''),
      });
    }

    return {
      id: 'sse-fallback-response',
      output,
      status: 'completed',
    };
  }

  private createRequestSignal(...signals: Array<AbortSignal | undefined>): AbortSignal {
    const activeSignals = signals.filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );
    return AbortSignal.any([
      ...activeSignals,
      AbortSignal.timeout(this.requestTimeoutMs),
    ]);
  }

  private rejectAfter(ms: number, message: string): Promise<never> {
    return new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        const timeoutError = new Error(message) as Error & { name: string };
        timeoutError.name = 'TimeoutError';
        reject(timeoutError);
      }, ms);
      timer.unref?.();
    });
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
