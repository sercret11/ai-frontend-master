/**
 * 属性 P5：分析层上下文累积
 *
 * 使用真实 LLM 调用执行完整分析层管线，验证第 N 个智能体（N ∈ {1,2,3,4}）
 * 接收到的 `previousDocuments` 长度恰好为 N-1。
 *
 * **Validates: Requirements R1.3, R1.4, R1.5**
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import fc from 'fast-check';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AnalysisLayer, type AnalysisLayerConfig } from '../analysis-layer.js';
import { LLMClient } from '../../llm/client.js';
import { RetryEngine } from '../../llm/retry.js';
import { OpenAIAdapter } from '../../llm/adapters/openai.js';
import type { ProviderAdapter } from '../../llm/adapters/types.js';
import type { ProviderID } from '../../llm/types.js';
import type { AnalysisLayerInput, AnalysisContext } from '../types.js';
import type { RuntimeEvent, RuntimeEventPayload } from '@ai-frontend/shared-types';

// Load .env from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../../.env') });

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://vpsairobot.com';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_DEFAULT_MODEL = process.env.AI_DEFAULT_MODEL || 'gpt-5.3-codex';

const canRun =
  !!OPENAI_API_KEY &&
  OPENAI_API_KEY !== 'your_openai_api_key_here' &&
  !OPENAI_API_KEY.startsWith('your_');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLLMClient(): LLMClient {
  const adapter = new OpenAIAdapter({
    baseUrl: OPENAI_BASE_URL,
    apiKey: OPENAI_API_KEY,
    protocol: 'responses',
  });

  const adapters = new Map<ProviderID, ProviderAdapter>([['openai', adapter]]);

  const retryEngine = new RetryEngine({
    maxRetries: 2,
    baseDelayMs: 1000,
    maxJitterMs: 200,
  });

  return new LLMClient(adapters, retryEngine);
}

function createAnalysisLayer(llmClient: LLMClient): AnalysisLayer {
  return new AnalysisLayer({
    llmClient,
    provider: 'openai',
    model: AI_DEFAULT_MODEL,
    temperature: 0.7,
    maxOutputTokens: 4096,
  });
}

function createMockEmitter(): (event: RuntimeEventPayload) => RuntimeEvent {
  return (event: RuntimeEventPayload): RuntimeEvent =>
    ({ id: `evt-${Date.now()}`, timestamp: Date.now(), ...event }) as unknown as RuntimeEvent;
}

// Arbitrary for user messages – short, varied prompts to exercise the pipeline
const userMessageArb = fc.constantFrom(
  '创建一个简单的待办事项应用',
  '创建一个天气查询应用',
  '创建一个博客系统首页',
);

// ---------------------------------------------------------------------------
// Property Test
// ---------------------------------------------------------------------------

describe('P5: Analysis layer context accumulation property', () => {
  const itReal = canRun ? it : it.skip;

  let llmClient: LLMClient;

  beforeAll(() => {
    if (canRun) {
      llmClient = createLLMClient();
    }
  });

  itReal(
    'agent N receives exactly N-1 previousDocuments for any user message',
    async () => {
      await fc.assert(
        fc.asyncProperty(userMessageArb, async (userMessage) => {
          const layer = createAnalysisLayer(llmClient);
          const agents = layer.getAgents();

          // Spy on each agent's buildPrompt to capture the context it receives
          const contextLengths: number[] = [];
          agents.forEach((agent) => {
            const original = agent.buildPrompt.bind(agent);
            vi.spyOn(agent, 'buildPrompt').mockImplementation(
              (ctx: AnalysisContext) => {
                contextLengths.push(ctx.previousDocuments.length);
                return original(ctx);
              },
            );
          });

          const input: AnalysisLayerInput = {
            sessionId: `prop-test-${Date.now()}`,
            userMessage,
            platform: 'web',
            techStack: ['React', 'TypeScript'],
            abortSignal: new AbortController().signal,
            emitRuntimeEvent: createMockEmitter(),
          };

          const result = await layer.run(input);

          // Pipeline must succeed for the property to be meaningful
          expect(result.success).toBe(true);
          expect(result.documents).toHaveLength(4);

          // Core property: agent N (1-indexed) receives exactly N-1 documents
          // contextLengths[0] == 0  (PM, no predecessors)
          // contextLengths[1] == 1  (Architect, receives PM doc)
          // contextLengths[2] == 2  (UI, receives PM + Architect docs)
          // contextLengths[3] == 3  (UX, receives PM + Architect + UI docs)
          expect(contextLengths).toEqual([0, 1, 2, 3]);

          return true;
        }),
        {
          numRuns: 2, // Limited runs – each run makes 4 real LLM calls
          timeout: 240_000, // 4 minutes per property run
        },
      );
    },
    600_000, // 10 minutes total timeout for the test
  );
});
