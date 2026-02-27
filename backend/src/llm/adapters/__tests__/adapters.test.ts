/**
 * Provider Adapter Unit Tests
 *
 * - OpenAIAdapter: real LLM call tests via .env (OPENAI_BASE_URL + AI_DEFAULT_MODEL, Responses API)
 * - AnthropicAdapter & GoogleAdapter: request structure validation + response parsing
 * - All adapters: tool definition conversion, error conversion
 *
 * 需求: R6.1, R6.2, R6.3, R6.6
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';
import { AnthropicAdapter } from '../anthropic.js';
import { OpenAIAdapter } from '../openai.js';
import { GoogleAdapter } from '../google.js';
import type { LLMRequestParams, ToolDefinition } from '../../types.js';

// Load .env from project root
config({ path: resolve(process.cwd(), '.env') });

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const sampleTool: ToolDefinition = {
  name: 'get_weather',
  description: 'Get the current weather for a location',
  inputSchema: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name' },
      unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    },
    required: ['location'],
  },
};

function makeSimpleParams(provider: 'anthropic' | 'openai' | 'google'): LLMRequestParams {
  return {
    provider,
    model: provider === 'openai' ? (process.env.AI_DEFAULT_MODEL ?? 'gpt-4') : 'test-model',
    systemPrompt: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.7,
    maxOutputTokens: 256,
  };
}

function makeParamsWithTools(provider: 'anthropic' | 'openai' | 'google'): LLMRequestParams {
  return {
    ...makeSimpleParams(provider),
    tools: [sampleTool],
  };
}

// ---------------------------------------------------------------------------
// AnthropicAdapter
// ---------------------------------------------------------------------------

describe('AnthropicAdapter', () => {
  const adapter = new AnthropicAdapter({
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.com',
  });

  describe('buildRequest', () => {
    it('builds correct request structure for Messages API', () => {
      const req = adapter.buildRequest(makeSimpleParams('anthropic'));

      expect(req.url).toBe('https://api.anthropic.com/v1/messages');
      expect(req.headers['x-api-key']).toBe('test-key');
      expect(req.headers['anthropic-version']).toBe('2023-06-01');
      expect(req.headers['Content-Type']).toBe('application/json');

      const body = req.body as Record<string, unknown>;
      expect(body.model).toBe('test-model');
      expect(body.system).toBe('You are a helpful assistant.');
      expect(body.max_tokens).toBe(256);
      expect(body.temperature).toBe(0.7);
      expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('system prompt is a top-level field, not in messages', () => {
      const req = adapter.buildRequest(makeSimpleParams('anthropic'));
      const body = req.body as Record<string, unknown>;
      const messages = body.messages as Array<Record<string, unknown>>;

      // system should NOT appear in messages
      for (const msg of messages) {
        expect(msg.role).not.toBe('system');
      }
      expect(body.system).toBeDefined();
    });

    it('includes tools in Anthropic format when provided', () => {
      const req = adapter.buildRequest(makeParamsWithTools('anthropic'));
      const body = req.body as Record<string, unknown>;
      const tools = body.tools as Array<Record<string, unknown>>;

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        name: 'get_weather',
        description: 'Get the current weather for a location',
        input_schema: sampleTool.inputSchema,
      });
    });

    it('handles tool_result messages as user messages', () => {
      const params: LLMRequestParams = {
        ...makeSimpleParams('anthropic'),
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'get_weather',
                input: { location: 'Tokyo' },
              },
            ],
          },
          {
            role: 'tool_result',
            content: [
              {
                type: 'tool_result',
                toolUseId: 'call_1',
                content: '25°C, sunny',
              },
            ],
          },
        ],
      };

      const req = adapter.buildRequest(params);
      const body = req.body as Record<string, unknown>;
      const messages = body.messages as Array<Record<string, unknown>>;

      // tool_result should be converted to user role
      expect(messages[2].role).toBe('user');
    });
  });

  describe('parseResponse', () => {
    it('parses text response', () => {
      const raw = {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello there!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const res = adapter.parseResponse(raw);
      expect(res.text).toBe('Hello there!');
      expect(res.toolCalls).toHaveLength(0);
      expect(res.finishReason).toBe('stop');
      expect(res.usage.inputTokens).toBe(10);
      expect(res.usage.outputTokens).toBe(5);
      expect(res.usage.totalTokens).toBe(15);
    });

    it('parses tool_use response', () => {
      const raw = {
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check the weather.' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'get_weather',
            input: { location: 'Tokyo' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 15 },
      };

      const res = adapter.parseResponse(raw);
      expect(res.text).toBe('Let me check the weather.');
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls[0].id).toBe('toolu_1');
      expect(res.toolCalls[0].name).toBe('get_weather');
      expect(res.toolCalls[0].arguments).toEqual({ location: 'Tokyo' });
      expect(res.finishReason).toBe('tool_use');
    });

    it('parses max_tokens finish reason', () => {
      const raw = {
        id: 'msg_3',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Truncated...' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 100 },
      };

      const res = adapter.parseResponse(raw);
      expect(res.finishReason).toBe('max_tokens');
    });
  });

  describe('parseSSEEvent', () => {
    it('parses content_block_delta text_delta', () => {
      const evt = adapter.parseSSEEvent(
        'content_block_delta',
        JSON.stringify({ index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
      );
      expect(evt).toEqual({ type: 'text_delta', text: 'Hello' });
    });

    it('parses content_block_start for tool_use', () => {
      const evt = adapter.parseSSEEvent(
        'content_block_start',
        JSON.stringify({
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather' },
        }),
      );
      expect(evt).toEqual({ type: 'tool_call_start', id: 'toolu_1', name: 'get_weather' });
    });

    it('parses content_block_delta input_json_delta', () => {
      const evt = adapter.parseSSEEvent(
        'content_block_delta',
        JSON.stringify({ index: 1, delta: { type: 'input_json_delta', partial_json: '{"loc' } }),
      );
      expect(evt).toEqual({ type: 'tool_call_delta', id: '1', argumentsDelta: '{"loc' });
    });

    it('parses content_block_stop', () => {
      const evt = adapter.parseSSEEvent(
        'content_block_stop',
        JSON.stringify({ index: 1 }),
      );
      expect(evt).toEqual({ type: 'tool_call_end', id: '1' });
    });

    it('returns null for message_stop', () => {
      const evt = adapter.parseSSEEvent('message_stop', JSON.stringify({}));
      expect(evt).toBeNull();
    });

    it('returns null for [DONE]', () => {
      const evt = adapter.parseSSEEvent('', '[DONE]');
      expect(evt).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const evt = adapter.parseSSEEvent('content_block_delta', 'not-json');
      expect(evt).toBeNull();
    });
  });

  describe('convertToolDefinition', () => {
    it('converts to Anthropic tool format with input_schema', () => {
      const converted = adapter.convertToolDefinition(sampleTool);
      expect(converted).toEqual({
        name: 'get_weather',
        description: 'Get the current weather for a location',
        input_schema: sampleTool.inputSchema,
      });
    });
  });

  describe('convertError', () => {
    it('converts 429 as retryable', () => {
      const err = adapter.convertError(429, { error: { message: 'Rate limited' } });
      expect(err.provider).toBe('anthropic');
      expect(err.statusCode).toBe(429);
      expect(err.retryable).toBe(true);
      expect(err.message).toBe('Rate limited');
    });

    it('converts 400 as non-retryable', () => {
      const err = adapter.convertError(400, { error: { message: 'Bad request' } });
      expect(err.retryable).toBe(false);
      expect(err.statusCode).toBe(400);
    });

    it('converts 500/502/503/504 as retryable', () => {
      for (const status of [500, 502, 503, 504]) {
        const err = adapter.convertError(status, {});
        expect(err.retryable).toBe(true);
      }
    });

    it('uses fallback message when error body is empty', () => {
      const err = adapter.convertError(500, {});
      expect(err.message).toContain('Anthropic API error');
    });
  });
});


// ---------------------------------------------------------------------------
// OpenAIAdapter
// ---------------------------------------------------------------------------

describe('OpenAIAdapter', () => {
  describe('Responses API (default protocol)', () => {
    const adapter = new OpenAIAdapter({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com',
      protocol: 'responses',
    });

    describe('buildRequest', () => {
      it('builds correct Responses API request structure', () => {
        const req = adapter.buildRequest(makeSimpleParams('openai'));

        expect(req.url).toBe('https://api.openai.com/v1/responses');
        expect(req.headers['Authorization']).toBe('Bearer test-key');
        expect(req.headers['Content-Type']).toBe('application/json');

        const body = req.body as Record<string, unknown>;
        expect(body.model).toBe(process.env.AI_DEFAULT_MODEL ?? 'gpt-4');
        expect(body.instructions).toBe('You are a helpful assistant.');
        expect(body.max_output_tokens).toBe(256);
        expect(body.temperature).toBe(0.7);
      });

      it('uses instructions field for system prompt (not in messages)', () => {
        const req = adapter.buildRequest(makeSimpleParams('openai'));
        const body = req.body as Record<string, unknown>;
        expect(body.instructions).toBeDefined();
        // input should not contain a system message
        const input = body.input as Array<Record<string, unknown>>;
        for (const item of input) {
          expect(item.role).not.toBe('system');
        }
      });

      it('includes tools in Responses API format', () => {
        const req = adapter.buildRequest(makeParamsWithTools('openai'));
        const body = req.body as Record<string, unknown>;
        const tools = body.tools as Array<Record<string, unknown>>;

        expect(tools).toHaveLength(1);
        expect(tools[0]).toEqual({
          type: 'function',
          name: 'get_weather',
          description: 'Get the current weather for a location',
          parameters: sampleTool.inputSchema,
        });
      });

      it('converts tool_result messages to function_call_output', () => {
        const params: LLMRequestParams = {
          ...makeSimpleParams('openai'),
          messages: [
            { role: 'user', content: 'What is the weather?' },
            {
              role: 'assistant',
              content: [
                { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { location: 'Tokyo' } },
              ],
            },
            {
              role: 'tool_result',
              content: [
                { type: 'tool_result', toolUseId: 'call_1', content: '25°C, sunny' },
              ],
            },
          ],
        };

        const req = adapter.buildRequest(params);
        const body = req.body as Record<string, unknown>;
        const input = body.input as Array<Record<string, unknown>>;

        const toolOutput = input.find((i) => i.type === 'function_call_output');
        expect(toolOutput).toBeDefined();
        expect(toolOutput!.call_id).toBe('call_1');
        expect(toolOutput!.output).toBe('25°C, sunny');
      });
    });

    describe('parseResponse', () => {
      it('parses Responses API text output', () => {
        const raw = {
          id: 'resp_1',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Hello!' }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        };

        const res = adapter.parseResponse(raw);
        expect(res.text).toBe('Hello!');
        expect(res.toolCalls).toHaveLength(0);
        expect(res.finishReason).toBe('stop');
        expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
      });

      it('parses Responses API function_call output', () => {
        const raw = {
          id: 'resp_2',
          output: [
            {
              type: 'function_call',
              call_id: 'call_abc',
              name: 'get_weather',
              arguments: '{"location":"Tokyo"}',
            },
          ],
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
        };

        const res = adapter.parseResponse(raw);
        expect(res.toolCalls).toHaveLength(1);
        expect(res.toolCalls[0].id).toBe('call_abc');
        expect(res.toolCalls[0].name).toBe('get_weather');
        expect(res.toolCalls[0].arguments).toEqual({ location: 'Tokyo' });
        expect(res.finishReason).toBe('tool_use');
      });

      it('handles mixed text + function_call output', () => {
        const raw = {
          id: 'resp_3',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Checking weather...' }],
            },
            {
              type: 'function_call',
              call_id: 'call_xyz',
              name: 'get_weather',
              arguments: '{"location":"Paris"}',
            },
          ],
          usage: { input_tokens: 15, output_tokens: 12, total_tokens: 27 },
        };

        const res = adapter.parseResponse(raw);
        expect(res.text).toBe('Checking weather...');
        expect(res.toolCalls).toHaveLength(1);
        expect(res.finishReason).toBe('tool_use');
      });
    });

    describe('parseSSEEvent', () => {
      it('parses response.output_text.delta', () => {
        const evt = adapter.parseSSEEvent(
          'response.output_text.delta',
          JSON.stringify({ delta: 'Hello' }),
        );
        expect(evt).toEqual({ type: 'text_delta', text: 'Hello' });
      });

      it('parses response.output_item.added for function_call', () => {
        const evt = adapter.parseSSEEvent(
          'response.output_item.added',
          JSON.stringify({ item: { type: 'function_call', call_id: 'c1', name: 'get_weather' } }),
        );
        expect(evt).toEqual({ type: 'tool_call_start', id: 'c1', name: 'get_weather' });
      });

      it('parses response.function_call_arguments.delta', () => {
        const evt = adapter.parseSSEEvent(
          'response.function_call_arguments.delta',
          JSON.stringify({ item_id: 'c1', delta: '{"loc' }),
        );
        expect(evt).toEqual({ type: 'tool_call_delta', id: 'c1', argumentsDelta: '{"loc' });
      });

      it('parses response.function_call_arguments.done', () => {
        const evt = adapter.parseSSEEvent(
          'response.function_call_arguments.done',
          JSON.stringify({ item_id: 'c1' }),
        );
        expect(evt).toEqual({ type: 'tool_call_end', id: 'c1' });
      });

      it('returns null for response.completed', () => {
        const evt = adapter.parseSSEEvent(
          'response.completed',
          JSON.stringify({ response: {} }),
        );
        expect(evt).toBeNull();
      });

      it('returns null for [DONE]', () => {
        const evt = adapter.parseSSEEvent('', '[DONE]');
        expect(evt).toBeNull();
      });
    });
  });

  describe('Chat Completions API (fallback protocol)', () => {
    const adapter = new OpenAIAdapter({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com',
      protocol: 'chat-completions',
    });

    describe('buildRequest', () => {
      it('builds correct Chat Completions request structure', () => {
        const req = adapter.buildRequest(makeSimpleParams('openai'));

        expect(req.url).toBe('https://api.openai.com/v1/chat/completions');

        const body = req.body as Record<string, unknown>;
        expect(body.model).toBeDefined();
        expect(body.max_completion_tokens).toBe(256);

        const messages = body.messages as Array<Record<string, unknown>>;
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toBe('You are a helpful assistant.');
        expect(messages[1].role).toBe('user');
      });

      it('includes tools in Chat Completions format', () => {
        const req = adapter.buildRequest(makeParamsWithTools('openai'));
        const body = req.body as Record<string, unknown>;
        const tools = body.tools as Array<Record<string, unknown>>;

        expect(tools).toHaveLength(1);
        expect(tools[0]).toEqual({
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather for a location',
            parameters: sampleTool.inputSchema,
          },
        });
      });
    });

    describe('parseResponse', () => {
      it('parses Chat Completions text response', () => {
        const raw = {
          id: 'chatcmpl-1',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hi!' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        };

        const res = adapter.parseResponse(raw);
        expect(res.text).toBe('Hi!');
        expect(res.finishReason).toBe('stop');
        expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 3, totalTokens: 13 });
      });

      it('parses Chat Completions tool_calls response', () => {
        const raw = {
          id: 'chatcmpl-2',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
        };

        const res = adapter.parseResponse(raw);
        expect(res.toolCalls).toHaveLength(1);
        expect(res.toolCalls[0].name).toBe('get_weather');
        expect(res.toolCalls[0].arguments).toEqual({ location: 'NYC' });
        expect(res.finishReason).toBe('tool_use');
      });
    });

    describe('parseSSEEvent (Chat Completions)', () => {
      it('parses text delta from choices', () => {
        const evt = adapter.parseSSEEvent(
          '',
          JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] }),
        );
        expect(evt).toEqual({ type: 'text_delta', text: 'Hi' });
      });

      it('parses tool call start from choices', () => {
        const evt = adapter.parseSSEEvent(
          '',
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { id: 'call_1', function: { name: 'get_weather', arguments: '' } },
                  ],
                },
              },
            ],
          }),
        );
        expect(evt).toEqual({ type: 'tool_call_start', id: 'call_1', name: 'get_weather' });
      });
    });
  });

  describe('convertToolDefinition', () => {
    it('Responses API format: flat function tool', () => {
      const adapter = new OpenAIAdapter({ apiKey: 'k', protocol: 'responses' });
      const converted = adapter.convertToolDefinition(sampleTool) as Record<string, unknown>;
      expect(converted.type).toBe('function');
      expect(converted.name).toBe('get_weather');
      expect(converted.parameters).toEqual(sampleTool.inputSchema);
    });

    it('Chat Completions format: nested function tool', () => {
      const adapter = new OpenAIAdapter({ apiKey: 'k', protocol: 'chat-completions' });
      const converted = adapter.convertToolDefinition(sampleTool) as Record<string, unknown>;
      expect(converted.type).toBe('function');
      const fn = converted.function as Record<string, unknown>;
      expect(fn.name).toBe('get_weather');
      expect(fn.parameters).toEqual(sampleTool.inputSchema);
    });
  });

  describe('convertError', () => {
    const adapter = new OpenAIAdapter({ apiKey: 'k' });

    it('converts 429 as retryable', () => {
      const err = adapter.convertError(429, { error: { message: 'Rate limit exceeded' } });
      expect(err.provider).toBe('openai');
      expect(err.statusCode).toBe(429);
      expect(err.retryable).toBe(true);
    });

    it('converts 401 as non-retryable', () => {
      const err = adapter.convertError(401, { error: { message: 'Invalid API key' } });
      expect(err.retryable).toBe(false);
    });
  });
});


// ---------------------------------------------------------------------------
// GoogleAdapter
// ---------------------------------------------------------------------------

describe('GoogleAdapter', () => {
  const adapter = new GoogleAdapter({
    apiKey: 'test-key',
    baseUrl: 'https://generativelanguage.googleapis.com',
  });

  describe('buildRequest', () => {
    it('builds correct Gemini API request structure', () => {
      const req = adapter.buildRequest({
        ...makeSimpleParams('google'),
        model: 'gemini-pro',
      });

      expect(req.url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
      );
      expect(req.headers['x-goog-api-key']).toBe('test-key');
      expect(req.headers['Content-Type']).toBe('application/json');

      const body = req.body as Record<string, unknown>;
      expect(body.systemInstruction).toEqual({ parts: [{ text: 'You are a helpful assistant.' }] });
      expect(body.contents).toBeDefined();

      const contents = body.contents as Array<Record<string, unknown>>;
      expect(contents).toHaveLength(1);
      expect(contents[0].role).toBe('user');
    });

    it('system prompt is in systemInstruction, not in contents', () => {
      const req = adapter.buildRequest({
        ...makeSimpleParams('google'),
        model: 'gemini-pro',
      });
      const body = req.body as Record<string, unknown>;
      const contents = body.contents as Array<Record<string, unknown>>;

      for (const c of contents) {
        expect(c.role).not.toBe('system');
      }
      expect(body.systemInstruction).toBeDefined();
    });

    it('includes tools as functionDeclarations', () => {
      const req = adapter.buildRequest({
        ...makeParamsWithTools('google'),
        model: 'gemini-pro',
      });
      const body = req.body as Record<string, unknown>;
      const tools = body.tools as Array<Record<string, unknown>>;

      expect(tools).toHaveLength(1);
      const decls = tools[0].functionDeclarations as Array<Record<string, unknown>>;
      expect(decls).toHaveLength(1);
      expect(decls[0]).toEqual({
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: sampleTool.inputSchema,
      });
    });

    it('includes generationConfig when temperature/topP/maxOutputTokens set', () => {
      const req = adapter.buildRequest({
        ...makeSimpleParams('google'),
        model: 'gemini-pro',
        topP: 0.9,
      });
      const body = req.body as Record<string, unknown>;
      const gc = body.generationConfig as Record<string, unknown>;

      expect(gc.temperature).toBe(0.7);
      expect(gc.topP).toBe(0.9);
      expect(gc.maxOutputTokens).toBe(256);
    });

    it('handles tool_result messages as functionResponse parts', () => {
      const params: LLMRequestParams = {
        ...makeSimpleParams('google'),
        model: 'gemini-pro',
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', name: 'get_weather', input: { location: 'Tokyo' } },
            ],
          },
          {
            role: 'tool_result',
            content: [
              { type: 'tool_result', name: 'get_weather', content: '25°C' },
            ],
          },
        ],
      };

      const req = adapter.buildRequest(params);
      const body = req.body as Record<string, unknown>;
      const contents = body.contents as Array<Record<string, unknown>>;

      // The tool_result should be a user-role content with functionResponse
      const toolResultContent = contents[2];
      expect(toolResultContent.role).toBe('user');
      const parts = toolResultContent.parts as Array<Record<string, unknown>>;
      expect(parts[0].functionResponse).toBeDefined();
    });
  });

  describe('parseResponse', () => {
    it('parses text response from candidates', () => {
      const raw = {
        candidates: [
          {
            content: { parts: [{ text: 'Hello from Gemini!' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const res = adapter.parseResponse(raw);
      expect(res.text).toBe('Hello from Gemini!');
      expect(res.toolCalls).toHaveLength(0);
      expect(res.finishReason).toBe('stop');
      expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    });

    it('parses functionCall response', () => {
      const raw = {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: 'get_weather', args: { location: 'London' } } },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 },
      };

      const res = adapter.parseResponse(raw);
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls[0].name).toBe('get_weather');
      expect(res.toolCalls[0].arguments).toEqual({ location: 'London' });
    });

    it('maps SAFETY finish reason to error', () => {
      const raw = {
        candidates: [
          {
            content: { parts: [] },
            finishReason: 'SAFETY',
          },
        ],
      };

      const res = adapter.parseResponse(raw);
      expect(res.finishReason).toBe('error');
    });

    it('maps MAX_TOKENS finish reason', () => {
      const raw = {
        candidates: [
          {
            content: { parts: [{ text: 'Truncated' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
      };

      const res = adapter.parseResponse(raw);
      expect(res.finishReason).toBe('max_tokens');
    });
  });

  describe('parseSSEEvent', () => {
    it('parses text delta from streamed candidate', () => {
      const data = JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'chunk' }] } }],
      });
      const evt = adapter.parseSSEEvent('', data);
      expect(evt).toEqual({ type: 'text_delta', text: 'chunk' });
    });

    it('parses functionCall from streamed candidate', () => {
      const data = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'get_weather', args: { location: 'Berlin' } } }],
            },
          },
        ],
      });
      const evt = adapter.parseSSEEvent('', data);
      expect(evt).not.toBeNull();
      expect(evt!.type).toBe('tool_call_start');
    });

    it('returns null for [DONE]', () => {
      const evt = adapter.parseSSEEvent('', '[DONE]');
      expect(evt).toBeNull();
    });

    it('returns null for empty candidates', () => {
      const evt = adapter.parseSSEEvent('', JSON.stringify({ candidates: [{ content: { parts: [] } }] }));
      expect(evt).toBeNull();
    });
  });

  describe('convertToolDefinition', () => {
    it('converts to Google functionDeclarations format', () => {
      const converted = adapter.convertToolDefinition(sampleTool);
      expect(converted).toEqual({
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: sampleTool.inputSchema,
      });
    });
  });

  describe('convertError', () => {
    it('converts 429 as retryable', () => {
      const err = adapter.convertError(429, { error: { message: 'Quota exceeded' } });
      expect(err.provider).toBe('google');
      expect(err.statusCode).toBe(429);
      expect(err.retryable).toBe(true);
    });

    it('converts 403 as non-retryable', () => {
      const err = adapter.convertError(403, { error: { message: 'Forbidden' } });
      expect(err.retryable).toBe(false);
    });

    it('uses fallback message when error body is empty', () => {
      const err = adapter.convertError(500, {});
      expect(err.message).toContain('Google API error');
    });
  });
});

// ---------------------------------------------------------------------------
// OpenAIAdapter – Real LLM call (Responses API)
// ---------------------------------------------------------------------------

describe('OpenAIAdapter – Real LLM call (Responses API)', () => {
  const baseUrl = process.env.OPENAI_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.AI_DEFAULT_MODEL ?? 'gpt-4';

  const canRunRealTests = !!baseUrl && !!apiKey && apiKey !== 'your_openai_api_key_here';

  // Skip if no real credentials
  const itReal = canRunRealTests ? it : it.skip;

  let adapter: OpenAIAdapter;

  beforeAll(() => {
    if (canRunRealTests) {
      adapter = new OpenAIAdapter({
        baseUrl,
        apiKey: apiKey!,
        protocol: 'responses',
      });
    }
  });

  itReal('buildRequest → fetch → parseResponse round-trip (simple text)', async () => {
    const params: LLMRequestParams = {
      provider: 'openai',
      model,
      systemPrompt: 'Reply with exactly one word.',
      messages: [{ role: 'user', content: 'Say hello.' }],
      maxOutputTokens: 64,
      temperature: 0,
    };

    const req = adapter.buildRequest(params);
    const response = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
    });

    expect(response.ok).toBe(true);
    const raw = await response.json();
    const parsed = adapter.parseResponse(raw);

    expect(parsed.text.length).toBeGreaterThan(0);
    expect(parsed.finishReason).toBe('stop');
    expect(parsed.usage.totalTokens).toBeGreaterThan(0);
  }, 30_000);

  itReal('buildRequest → fetch → parseResponse round-trip (with tool)', async () => {
    const params: LLMRequestParams = {
      provider: 'openai',
      model,
      systemPrompt: 'You must use the get_weather tool to answer weather questions.',
      messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
      tools: [sampleTool],
      maxOutputTokens: 256,
      temperature: 0,
    };

    const req = adapter.buildRequest(params);
    const response = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
    });

    expect(response.ok).toBe(true);
    const raw = await response.json();
    const parsed = adapter.parseResponse(raw);

    // The model should either call the tool or respond with text
    expect(parsed.text.length > 0 || parsed.toolCalls.length > 0).toBe(true);
    if (parsed.toolCalls.length > 0) {
      expect(parsed.finishReason).toBe('tool_use');
      expect(parsed.toolCalls[0].name).toBe('get_weather');
      expect(parsed.toolCalls[0].arguments).toHaveProperty('location');
    }
  }, 30_000);

  itReal('convertError handles real error response format', async () => {
    // Use an invalid model to trigger an error
    const badAdapter = new OpenAIAdapter({
      baseUrl,
      apiKey: apiKey!,
      protocol: 'responses',
    });

    const params: LLMRequestParams = {
      provider: 'openai',
      model: 'nonexistent-model-xyz',
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'test' }],
    };

    const req = badAdapter.buildRequest(params);
    const response = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      const body = await response.json();
      const err = badAdapter.convertError(response.status, body);
      expect(err.provider).toBe('openai');
      expect(err.statusCode).toBe(response.status);
      expect(err.message.length).toBeGreaterThan(0);
    }
    // If it somehow succeeds, that's fine too – the test is about error conversion
  }, 30_000);
});
