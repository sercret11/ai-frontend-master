/**
 * LLMClient Unit Tests — complete() method
 *
 * Tests non-streaming completion: adapter lookup, request building,
 * fetch → parse pipeline, retry integration, AbortSignal cancellation,
 * and error handling.
 *
 * 需求: R5.1, R5.2, R5.5, R5.6, R8.1, R8.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClient } from '../client.js';
import { RetryEngine } from '../retry.js';
import type { ProviderAdapter } from '../adapters/types.js';
import type { LLMRequestParams, LLMResponse, LLMError, ProviderID } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParams(overrides?: Partial<LLMRequestParams>): LLMRequestParams {
  return {
    provider: 'openai',
    model: 'gpt-4',
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

const MOCK_RESPONSE: LLMResponse = {
  text: 'Hello there!',
  toolCalls: [],
  finishReason: 'stop',
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
};

function makeMockAdapter(overrides?: Partial<ProviderAdapter>): ProviderAdapter {
  return {
    id: 'openai',
    buildRequest: vi.fn().mockReturnValue({
      url: 'https://api.example.com/v1/responses',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: { model: 'gpt-4', input: [{ role: 'user', content: 'Hello' }] },
    }),
    parseResponse: vi.fn().mockReturnValue(MOCK_RESPONSE),
    parseSSEEvent: vi.fn().mockReturnValue(null),
    convertToolDefinition: vi.fn(),
    convertError: vi.fn().mockImplementation((status: number, body: unknown) => {
      const err = new Error(`HTTP ${status}`) as LLMError;
      err.provider = 'openai';
      err.statusCode = status;
      err.retryable = [429, 500, 502, 503, 504].includes(status);
      err.raw = body;
      return err;
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLMClient timeout defaults', () => {
  const originalTimeout = process.env.LLM_REQUEST_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.LLM_REQUEST_TIMEOUT_MS;
      return;
    }
    process.env.LLM_REQUEST_TIMEOUT_MS = originalTimeout;
  });

  it('uses 10-minute default timeout when env is unset', () => {
    delete process.env.LLM_REQUEST_TIMEOUT_MS;
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    expect((client as unknown as { requestTimeoutMs: number }).requestTimeoutMs).toBe(600000);
  });

  it('uses env timeout override when it is valid', () => {
    process.env.LLM_REQUEST_TIMEOUT_MS = '45000';
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    expect((client as unknown as { requestTimeoutMs: number }).requestTimeoutMs).toBe(45000);
  });
});

describe('LLMClient.complete', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls adapter.buildRequest and returns parsed LLMResponse on success', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'resp-1', output: [] }), { status: 200 }),
    );

    const params = makeParams();
    const result = await client.complete(params);

    expect(adapter.buildRequest).toHaveBeenCalledWith(params);
    expect(adapter.parseResponse).toHaveBeenCalledWith({ id: 'resp-1', output: [] });
    expect(result).toEqual(MOCK_RESPONSE);
  });

  it('accepts SSE payload in complete() by extracting response body', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    const sseBody = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"resp-1"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"resp-1","output":[]}}',
      '',
    ].join('\n');

    fetchSpy.mockResolvedValueOnce(
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const result = await client.complete(makeParams());

    expect(adapter.parseResponse).toHaveBeenCalledWith({ id: 'resp-1', output: [] });
    expect(result).toEqual(MOCK_RESPONSE);
  });

  it('builds fallback response from SSE deltas when response object is absent', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    const sseBody = [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":" world"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n');

    fetchSpy.mockResolvedValueOnce(
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const result = await client.complete(makeParams());

    const parsedInput = (adapter.parseResponse as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(parsedInput).toBeDefined();
    const output = parsedInput?.output as Array<Record<string, unknown>>;
    expect(Array.isArray(output)).toBe(true);
    expect(output[0]).toEqual({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello world' }],
    });
    expect(result).toEqual(MOCK_RESPONSE);
  });

  it('sends correct fetch options (method, headers, body, signal)', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await client.complete(makeParams());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/responses');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'gpt-4',
      input: [{ role: 'user', content: 'Hello' }],
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws LLMError when provider adapter is not registered', async () => {
    const client = new LLMClient(new Map(), new RetryEngine({ maxRetries: 0 }));

    try {
      await client.complete(makeParams({ provider: 'anthropic' }));
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('No adapter registered for provider: anthropic');
      expect(err.provider).toBe('anthropic');
      expect(err.retryable).toBe(false);
    }
  });

  it('calls adapter.convertError and throws on non-ok response', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );

    try {
      await client.complete(makeParams());
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(adapter.convertError).toHaveBeenCalledWith(401, { error: 'unauthorized' });
      expect(err.statusCode).toBe(401);
    }
  });

  it('retries on retryable errors via RetryEngine', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(
      adapters,
      new RetryEngine({ maxRetries: 2, baseDelayMs: 1, maxJitterMs: 0 }),
    );

    // First two calls return 429, third succeeds
    fetchSpy
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const result = await client.complete(makeParams());

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result).toEqual(MOCK_RESPONSE);
  });

  it('throws after all retries exhausted on retryable errors', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(
      adapters,
      new RetryEngine({ maxRetries: 1, baseDelayMs: 1, maxJitterMs: 0 }),
    );

    fetchSpy.mockResolvedValue(new Response('server error', { status: 500 }));

    try {
      await client.complete(makeParams());
      expect.unreachable('should have thrown');
    } catch (err: any) {
      // 1 initial + 1 retry = 2 calls
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(err.statusCode).toBe(500);
    }
  });

  it('supports AbortSignal cancellation', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    const controller = new AbortController();
    controller.abort(new DOMException('Cancelled', 'AbortError'));

    await expect(
      client.complete(makeParams({ abortSignal: controller.signal })),
    ).rejects.toThrow();
  });

  it('parses non-JSON error body as string', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    fetchSpy.mockResolvedValueOnce(
      new Response('plain text error', { status: 400 }),
    );

    try {
      await client.complete(makeParams());
      expect.unreachable('should have thrown');
    } catch {
      // convertError should receive the plain text string since it's not valid JSON
      expect(adapter.convertError).toHaveBeenCalledWith(400, 'plain text error');
    }
  });
});

// ---------------------------------------------------------------------------
// Stream Tests — LLMClient.stream()
// 需求: R5.3, R5.4, R8.4
// ---------------------------------------------------------------------------

/**
 * Helper: create a Response whose body is an SSE stream from the given lines.
 * Each line is sent as a separate chunk.
 */
function makeSSEResponse(lines: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + '\n'));
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('LLMClient.stream', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when provider adapter is not registered', () => {
    const client = new LLMClient(new Map(), new RetryEngine({ maxRetries: 0 }));

    expect(() => client.stream(makeParams({ provider: 'anthropic' }))).toThrow(
      /No adapter registered for provider: anthropic/,
    );
  });

  it('injects stream: true into the request body', async () => {
    const adapter = makeMockAdapter({
      parseSSEEvent: vi.fn()
        .mockReturnValueOnce({ type: 'text_delta', text: 'Hi' } as any)
        .mockReturnValueOnce({
          type: 'done',
          response: MOCK_RESPONSE,
        } as any),
    });
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    const sseResponse = makeSSEResponse([
      'data: {"type":"text"}',
      '',
      'data: {"type":"done"}',
      '',
      'data: [DONE]',
    ]);
    fetchSpy.mockResolvedValueOnce(sseResponse);

    const result = client.stream(makeParams());

    // Consume events to trigger the fetch
    for await (const _ of result.events) { /* drain */ }

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.stream).toBe(true);
  });

  it('yields text_delta events and resolves response on done', async () => {
    const adapter = makeMockAdapter({
      parseSSEEvent: vi.fn()
        .mockReturnValueOnce({ type: 'text_delta', text: 'Hello' })
        .mockReturnValueOnce({ type: 'text_delta', text: ' world' })
        .mockReturnValueOnce({
          type: 'done',
          response: {
            text: 'Hello world',
            toolCalls: [],
            finishReason: 'stop',
            usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
          },
        }),
    });
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    const sseResponse = makeSSEResponse([
      'data: {"delta":"Hello"}',
      '',
      'data: {"delta":" world"}',
      '',
      'data: {"done":true}',
      '',
      'data: [DONE]',
    ]);
    fetchSpy.mockResolvedValueOnce(sseResponse);

    const { events, response } = client.stream(makeParams());

    const collected: any[] = [];
    for await (const event of events) {
      collected.push(event);
    }

    expect(collected).toHaveLength(3);
    expect(collected[0]).toEqual({ type: 'text_delta', text: 'Hello' });
    expect(collected[1]).toEqual({ type: 'text_delta', text: ' world' });
    expect(collected[2].type).toBe('done');

    const finalResponse = await response;
    expect(finalResponse.text).toBe('Hello world');
    expect(finalResponse.finishReason).toBe('stop');
  });

  it('accumulates tool calls and builds fallback response when no done event', async () => {
    const adapter = makeMockAdapter({
      parseSSEEvent: vi.fn()
        .mockReturnValueOnce({ type: 'tool_call_start', id: 'tc-1', name: 'get_weather' })
        .mockReturnValueOnce({ type: 'tool_call_delta', id: 'tc-1', argumentsDelta: '{"city":' })
        .mockReturnValueOnce({ type: 'tool_call_delta', id: 'tc-1', argumentsDelta: '"NYC"}' })
        .mockReturnValueOnce({ type: 'tool_call_end', id: 'tc-1' }),
    });
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    // No done event, stream just ends after tool_call_end
    const sseResponse = makeSSEResponse([
      'data: {"tc":"start"}',
      '',
      'data: {"tc":"delta1"}',
      '',
      'data: {"tc":"delta2"}',
      '',
      'data: {"tc":"end"}',
      '',
      'data: [DONE]',
    ]);
    fetchSpy.mockResolvedValueOnce(sseResponse);

    const { events, response } = client.stream(makeParams());

    const collected: any[] = [];
    for await (const event of events) {
      collected.push(event);
    }

    expect(collected).toHaveLength(4);

    const finalResponse = await response;
    expect(finalResponse.toolCalls).toHaveLength(1);
    expect(finalResponse.toolCalls[0]).toEqual({
      id: 'tc-1',
      name: 'get_weather',
      arguments: { city: 'NYC' },
    });
    expect(finalResponse.finishReason).toBe('tool_use');
  });

  it('retries on retryable HTTP errors during stream fetch', async () => {
    const adapter = makeMockAdapter({
      parseSSEEvent: vi.fn()
        .mockReturnValueOnce({ type: 'text_delta', text: 'OK' })
        .mockReturnValueOnce({ type: 'done', response: MOCK_RESPONSE }),
    });
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    // First call returns 429 (retryable), second succeeds
    fetchSpy
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(
        makeSSEResponse([
          'data: {"text":"OK"}',
          '',
          'data: {"done":true}',
          '',
          'data: [DONE]',
        ]),
      );

    const { events, response } = client.stream(makeParams());

    const collected: any[] = [];
    for await (const event of events) {
      collected.push(event);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(collected).toHaveLength(2);

    const finalResponse = await response;
    expect(finalResponse).toEqual(MOCK_RESPONSE);
  });

  it('throws on non-retryable HTTP errors', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );

    const { events, response } = client.stream(makeParams());

    const collected: any[] = [];
    try {
      for await (const event of events) {
        collected.push(event);
      }
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
    }

    // response promise should also reject
    await expect(response).rejects.toThrow();
  });

  it('rejects response promise when stream errors', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    fetchSpy.mockResolvedValueOnce(
      new Response('server error', { status: 500 }),
    );

    const { events, response } = client.stream(makeParams());

    try {
      for await (const _ of events) { /* drain */ }
    } catch {
      // expected
    }

    await expect(response).rejects.toThrow();
  });
});


// ---------------------------------------------------------------------------
// completeWithTools Tests — LLMClient.completeWithTools()
// 需求: R7.1, R7.2, R7.3, R7.4, R7.5, R8.6
// ---------------------------------------------------------------------------

describe('LLMClient.completeWithTools', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns response immediately when finishReason is not tool_use', async () => {
    const adapter = makeMockAdapter();
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    const toolExecutor = vi.fn();
    const result = await client.completeWithTools(makeParams(), toolExecutor);

    expect(result).toEqual(MOCK_RESPONSE);
    expect(toolExecutor).not.toHaveBeenCalled();
  });

  it('executes tools and continues loop when finishReason is tool_use (R7.1, R7.2)', async () => {
    const toolCallResponse: LLMResponse = {
      text: '',
      toolCalls: [{ id: 'tc-1', name: 'get_weather', arguments: { city: 'NYC' } }],
      finishReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    const finalResponse: LLMResponse = {
      text: 'The weather in NYC is sunny.',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    };

    const adapter = makeMockAdapter({
      parseResponse: vi.fn()
        .mockReturnValueOnce(toolCallResponse)
        .mockReturnValueOnce(finalResponse),
    });
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const toolExecutor = vi.fn().mockResolvedValue({ content: 'Sunny, 72°F', isError: false });
    const result = await client.completeWithTools(makeParams(), toolExecutor);

    expect(toolExecutor).toHaveBeenCalledWith('get_weather', { city: 'NYC' });
    expect(result).toEqual(finalResponse);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('executes multiple tools in parallel (R7.3)', async () => {
    const toolCallResponse: LLMResponse = {
      text: '',
      toolCalls: [
        { id: 'tc-1', name: 'get_weather', arguments: { city: 'NYC' } },
        { id: 'tc-2', name: 'get_time', arguments: { timezone: 'EST' } },
      ],
      finishReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    const finalResponse: LLMResponse = {
      text: 'NYC weather is sunny, time is 3pm.',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    };

    const adapter = makeMockAdapter({
      parseResponse: vi.fn()
        .mockReturnValueOnce(toolCallResponse)
        .mockReturnValueOnce(finalResponse),
    });
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const executionOrder: string[] = [];
    const toolExecutor = vi.fn().mockImplementation(async (name: string) => {
      executionOrder.push(`start-${name}`);
      await new Promise((r) => setTimeout(r, 10));
      executionOrder.push(`end-${name}`);
      return { content: `Result for ${name}`, isError: false };
    });

    await client.completeWithTools(makeParams(), toolExecutor);

    expect(toolExecutor).toHaveBeenCalledTimes(2);
    // Both tools should start before either ends (parallel execution)
    expect(executionOrder[0]).toBe('start-get_weather');
    expect(executionOrder[1]).toBe('start-get_time');
  });

  it('returns tool errors as isError: true (R7.4)', async () => {
    const toolCallResponse: LLMResponse = {
      text: '',
      toolCalls: [{ id: 'tc-1', name: 'failing_tool', arguments: {} }],
      finishReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    const finalResponse: LLMResponse = {
      text: 'I encountered an error.',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    };

    const adapter = makeMockAdapter({
      parseResponse: vi.fn()
        .mockReturnValueOnce(toolCallResponse)
        .mockReturnValueOnce(finalResponse),
    });
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const toolExecutor = vi.fn().mockRejectedValue(new Error('Tool failed'));
    const result = await client.completeWithTools(makeParams(), toolExecutor);

    expect(result).toEqual(finalResponse);
    // The second request should contain the error result
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('respects maxRounds limit (R7.5)', async () => {
    const toolCallResponse: LLMResponse = {
      text: '',
      toolCalls: [{ id: 'tc-1', name: 'loop_tool', arguments: {} }],
      finishReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    const adapter = makeMockAdapter({
      parseResponse: vi.fn().mockReturnValue(toolCallResponse),
    });
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    // Return a new Response for each call to avoid "body already read" error
    fetchSpy.mockImplementation(() => 
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    );

    const toolExecutor = vi.fn().mockResolvedValue({ content: 'Keep going', isError: false });
    await client.completeWithTools(makeParams(), toolExecutor, 3);

    // 3 rounds + 1 final call = 4 total
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(toolExecutor).toHaveBeenCalledTimes(3);
  });

  it('auto-retries once on empty response (R8.6)', async () => {
    const emptyResponse: LLMResponse = {
      text: '',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
    };

    const validResponse: LLMResponse = {
      text: 'Hello!',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    const adapter = makeMockAdapter({
      parseResponse: vi.fn()
        .mockReturnValueOnce(emptyResponse)
        .mockReturnValueOnce(validResponse),
    });
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const toolExecutor = vi.fn();
    const result = await client.completeWithTools(makeParams(), toolExecutor);

    expect(result).toEqual(validResponse);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns empty response after single retry if still empty (R8.6)', async () => {
    const emptyResponse: LLMResponse = {
      text: '   ',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
    };

    const adapter = makeMockAdapter({
      parseResponse: vi.fn().mockReturnValue(emptyResponse),
    });
    const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);
    const client = new LLMClient(adapters, new RetryEngine({ maxRetries: 0 }));

    // Return a new Response for each call to avoid "body already read" error
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    );

    const toolExecutor = vi.fn();
    const result = await client.completeWithTools(makeParams(), toolExecutor);

    // First call empty, retry once, still empty -> return
    expect(result).toEqual(emptyResponse);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
