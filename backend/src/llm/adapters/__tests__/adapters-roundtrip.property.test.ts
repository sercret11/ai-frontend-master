/**
 * 属性 P2：LLM 请求/响应往返一致性
 *
 * - OpenAIAdapter: buildRequest → fetch → parseResponse 完整往返（真实 LLM 端点）
 * - AnthropicAdapter & GoogleAdapter: buildRequest 输出格式的结构一致性
 *
 * 验证: 需求 R12.3, R12.4
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { config } from 'dotenv';
import { resolve } from 'path';
import { AnthropicAdapter } from '../anthropic.js';
import { OpenAIAdapter } from '../openai.js';
import { GoogleAdapter } from '../google.js';
import type { LLMRequestParams, ToolDefinition, LLMMessage } from '../../types.js';

config({ path: resolve(process.cwd(), '.env') });

// ---------------------------------------------------------------------------
// Arbitraries for generating valid LLMRequestParams
// ---------------------------------------------------------------------------

const simpleStringArb = fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0);

const toolDefArb: fc.Arbitrary<ToolDefinition> = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9_]{0,19}$/),
  description: simpleStringArb,
  inputSchema: fc.constant({
    type: 'object',
    properties: { input: { type: 'string' } },
    required: ['input'],
  }),
});

const userMessageArb: fc.Arbitrary<LLMMessage> = fc.record({
  role: fc.constant('user' as const),
  content: simpleStringArb,
});

const requestParamsArb = (provider: 'anthropic' | 'openai' | 'google'): fc.Arbitrary<LLMRequestParams> =>
  fc.record({
    provider: fc.constant(provider),
    model: fc.constant(provider === 'openai' ? (process.env.AI_DEFAULT_MODEL ?? 'gpt-4') : 'test-model'),
    systemPrompt: simpleStringArb,
    messages: fc.tuple(userMessageArb).map(([m]) => [m]),
    tools: fc.option(fc.array(toolDefArb, { minLength: 1, maxLength: 2 }), { nil: undefined }),
    temperature: fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: undefined }),
    topP: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    maxOutputTokens: fc.option(fc.integer({ min: 1, max: 4096 }), { nil: undefined }),
  });

// ---------------------------------------------------------------------------
// AnthropicAdapter – buildRequest structural consistency
// ---------------------------------------------------------------------------

describe('P2: AnthropicAdapter buildRequest structural consistency', () => {
  const adapter = new AnthropicAdapter({ apiKey: 'test-key' });

  it('buildRequest always produces valid structure for any params', () => {
    fc.assert(
      fc.property(requestParamsArb('anthropic'), (params) => {
        const req = adapter.buildRequest(params);

        // URL is always the messages endpoint
        expect(req.url).toContain('/v1/messages');

        // Headers always present
        expect(req.headers['x-api-key']).toBe('test-key');
        expect(req.headers['Content-Type']).toBe('application/json');

        // Body structure
        const body = req.body as Record<string, unknown>;
        expect(body.model).toBe('test-model');
        expect(typeof body.system).toBe('string');
        expect(body.system).toBe(params.systemPrompt);
        expect(Array.isArray(body.messages)).toBe(true);
        expect(typeof body.max_tokens).toBe('number');

        // Messages should not contain system role
        const messages = body.messages as Array<Record<string, unknown>>;
        for (const msg of messages) {
          expect(msg.role).not.toBe('system');
        }

        // Tools present only when provided
        if (params.tools && params.tools.length > 0) {
          const tools = body.tools as Array<Record<string, unknown>>;
          expect(tools).toHaveLength(params.tools.length);
          for (const t of tools) {
            expect(t).toHaveProperty('name');
            expect(t).toHaveProperty('description');
            expect(t).toHaveProperty('input_schema');
          }
        } else {
          expect(body.tools).toBeUndefined();
        }
      }),
      { numRuns: 5 },
    );
  });

  it('parseResponse(JSON.parse(JSON.stringify(response))) is idempotent', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          type: fc.constant('message'),
          role: fc.constant('assistant'),
          content: fc.array(
            fc.oneof(
              fc.record({ type: fc.constant('text' as const), text: simpleStringArb }),
              fc.record({
                type: fc.constant('tool_use' as const),
                id: fc.uuid(),
                name: fc.stringMatching(/^[a-z_]{1,20}$/),
                input: fc.constant({ key: 'value' }),
              }),
            ),
            { minLength: 1, maxLength: 3 },
          ),
          stop_reason: fc.constantFrom('end_turn' as const, 'tool_use' as const, 'max_tokens' as const),
          usage: fc.record({
            input_tokens: fc.nat({ max: 10000 }),
            output_tokens: fc.nat({ max: 10000 }),
          }),
        }),
        (rawResponse) => {
          const parsed1 = adapter.parseResponse(rawResponse);
          const serialized = JSON.parse(JSON.stringify(parsed1));
          // The serialized LLMResponse should be structurally identical
          expect(serialized).toEqual(parsed1);
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// OpenAIAdapter – buildRequest structural consistency
// ---------------------------------------------------------------------------

describe('P2: OpenAIAdapter buildRequest structural consistency', () => {
  describe('Responses API', () => {
    const adapter = new OpenAIAdapter({ apiKey: 'test-key', protocol: 'responses' });

    it('buildRequest always produces valid Responses API structure', () => {
      fc.assert(
        fc.property(requestParamsArb('openai'), (params) => {
          const req = adapter.buildRequest(params);

          expect(req.url).toContain('/v1/responses');
          expect(req.headers['Authorization']).toBe('Bearer test-key');

          const body = req.body as Record<string, unknown>;
          expect(body.model).toBeDefined();
          expect(Array.isArray(body.input)).toBe(true);

          // System prompt goes to instructions, not in input
          if (params.systemPrompt) {
            expect(body.instructions).toBe(params.systemPrompt);
          }

          // Tools in flat format
          if (params.tools && params.tools.length > 0) {
            const tools = body.tools as Array<Record<string, unknown>>;
            expect(tools).toHaveLength(params.tools.length);
            for (const t of tools) {
              expect(t.type).toBe('function');
              expect(t).toHaveProperty('name');
              expect(t).toHaveProperty('parameters');
            }
          }
        }),
        { numRuns: 5 },
      );
    });
  });

  describe('Chat Completions API', () => {
    const adapter = new OpenAIAdapter({ apiKey: 'test-key', protocol: 'chat-completions' });

    it('buildRequest always produces valid Chat Completions structure', () => {
      fc.assert(
        fc.property(requestParamsArb('openai'), (params) => {
          const req = adapter.buildRequest(params);

          expect(req.url).toContain('/v1/chat/completions');

          const body = req.body as Record<string, unknown>;
          expect(body.model).toBeDefined();
          const messages = body.messages as Array<Record<string, unknown>>;
          expect(Array.isArray(messages)).toBe(true);

          // First message should be system
          if (params.systemPrompt) {
            expect(messages[0].role).toBe('system');
            expect(messages[0].content).toBe(params.systemPrompt);
          }

          // Tools in nested format
          if (params.tools && params.tools.length > 0) {
            const tools = body.tools as Array<Record<string, unknown>>;
            for (const t of tools) {
              expect(t.type).toBe('function');
              expect(t).toHaveProperty('function');
            }
          }
        }),
        { numRuns: 5 },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// GoogleAdapter – buildRequest structural consistency
// ---------------------------------------------------------------------------

describe('P2: GoogleAdapter buildRequest structural consistency', () => {
  const adapter = new GoogleAdapter({ apiKey: 'test-key' });

  it('buildRequest always produces valid Gemini API structure', () => {
    fc.assert(
      fc.property(requestParamsArb('google'), (params) => {
        const req = adapter.buildRequest(params);

        expect(req.url).toContain('/v1beta/models/test-model:generateContent');
        expect(req.headers['x-goog-api-key']).toBe('test-key');

        const body = req.body as Record<string, unknown>;
        expect(Array.isArray(body.contents)).toBe(true);

        // System prompt in systemInstruction
        if (params.systemPrompt) {
          const si = body.systemInstruction as Record<string, unknown>;
          expect(si).toBeDefined();
          expect(Array.isArray(si.parts)).toBe(true);
        }

        // Contents should not have system role
        const contents = body.contents as Array<Record<string, unknown>>;
        for (const c of contents) {
          expect(c.role).not.toBe('system');
          expect(['user', 'model']).toContain(c.role);
        }

        // Tools as functionDeclarations
        if (params.tools && params.tools.length > 0) {
          const tools = body.tools as Array<Record<string, unknown>>;
          expect(tools).toHaveLength(1); // Google wraps in single object
          const decls = tools[0].functionDeclarations as Array<Record<string, unknown>>;
          expect(decls).toHaveLength(params.tools.length);
        }
      }),
      { numRuns: 5 },
    );
  });

  it('parseResponse(JSON.parse(JSON.stringify(response))) is idempotent', () => {
    fc.assert(
      fc.property(
        fc.record({
          candidates: fc.tuple(
            fc.record({
              content: fc.record({
                parts: fc.array(
                  fc.oneof(
                    fc.record({ text: simpleStringArb }),
                    fc.record({
                      functionCall: fc.record({
                        name: fc.stringMatching(/^[a-z_]{1,20}$/),
                        args: fc.constant({ key: 'value' }),
                      }),
                    }),
                  ),
                  { minLength: 1, maxLength: 3 },
                ),
              }),
              finishReason: fc.constantFrom('STOP', 'MAX_TOKENS'),
            }),
          ).map(([c]) => [c]),
          usageMetadata: fc.record({
            promptTokenCount: fc.nat({ max: 10000 }),
            candidatesTokenCount: fc.nat({ max: 10000 }),
            totalTokenCount: fc.nat({ max: 20000 }),
          }),
        }),
        (rawResponse) => {
          const parsed1 = adapter.parseResponse(rawResponse);
          const serialized = JSON.parse(JSON.stringify(parsed1));
          expect(serialized).toEqual(parsed1);
        },
      ),
      { numRuns: 10 },
    );
  });
});


// ---------------------------------------------------------------------------
// OpenAIAdapter – Real LLM round-trip property test
// ---------------------------------------------------------------------------

describe('P2: OpenAIAdapter real LLM round-trip (Responses API)', () => {
  const baseUrl = process.env.OPENAI_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.AI_DEFAULT_MODEL ?? 'gpt-4';
  const canRun = !!baseUrl && !!apiKey && apiKey !== 'your_openai_api_key_here';

  const itReal = canRun ? it : it.skip;

  let adapter: OpenAIAdapter;

  beforeAll(() => {
    if (canRun) {
      adapter = new OpenAIAdapter({ baseUrl, apiKey: apiKey!, protocol: 'responses' });
    }
  });

  itReal(
    'buildRequest → fetch → parseResponse produces valid LLMResponse for random prompts',
    async () => {
      // We use a small set of random prompts to keep API costs low
      const prompts = ['Say hi.', 'Count to 3.', 'Name a color.'];

      for (const prompt of prompts) {
        const params: LLMRequestParams = {
          provider: 'openai',
          model,
          systemPrompt: 'Reply in 5 words or fewer.',
          messages: [{ role: 'user', content: prompt }],
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

        // Structural invariants that must hold for any valid response
        expect(typeof parsed.text).toBe('string');
        expect(parsed.text.length).toBeGreaterThan(0);
        expect(Array.isArray(parsed.toolCalls)).toBe(true);
        expect(['stop', 'tool_use', 'max_tokens', 'error']).toContain(parsed.finishReason);
        expect(typeof parsed.usage.inputTokens).toBe('number');
        expect(typeof parsed.usage.outputTokens).toBe('number');
        expect(typeof parsed.usage.totalTokens).toBe('number');
        expect(parsed.usage.inputTokens).toBeGreaterThan(0);
        expect(parsed.usage.outputTokens).toBeGreaterThan(0);

        // Round-trip: the parsed response should survive JSON serialization
        const roundTripped = JSON.parse(JSON.stringify(parsed));
        expect(roundTripped).toEqual(parsed);
      }
    },
    60_000,
  );
});
