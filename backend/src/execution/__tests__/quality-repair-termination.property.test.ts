/**
 * 属性 P8：质量修复循环有界终止
 *
 * 验证 `runQualityRepairLoop` 的调用次数上界：
 * 1. 当质量始终失败时，最多执行 2*maxRounds + 1 次 completeWithTools 调用
 *    （每轮 = 1 quality check + 1 repair，加上最终一次 quality check）
 * 2. 当质量在第一次就通过时，仅执行 1 次调用
 * 3. 当质量在第 K 次修复后通过时，恰好执行 2*K + 1 次调用
 *
 * 测试策略：
 * - 使用 fast-check 生成任意 maxRounds 值 (0..5)
 * - 使用 mock LLMClient 控制质量通过/失败行为
 * - 计数 completeWithTools 调用次数
 *
 * **Validates: Requirements R4.6, R4.7**
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { ExecutionLayer } from '../execution-layer.js';
import { MultiAgentBlackboard } from '../../runtime/multi-agent/blackboard.js';
import type { LLMClient } from '../../llm/client.js';
import type { LLMResponse, ToolExecutor } from '../../llm/types.js';
import type { ExecutionContext } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okResponse(text: string): LLMResponse {
  return {
    text,
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
  };
}

function makeContext(): ExecutionContext {
  return {
    sessionId: 'test-session',
    runId: 'test-run',
    userMessage: 'Build a todo app',
    techStack: ['react'],
    abortSignal: new AbortController().signal,
    emitRuntimeEvent: () => ({}) as any,
  };
}

/**
 * Build a mock LLMClient that tracks call count and returns responses
 * based on a provided function.
 */
function buildCountingClient(
  responseFn: (callIndex: number) => LLMResponse,
): { client: LLMClient; getCallCount: () => number } {
  let callCount = 0;
  const client = {
    completeWithTools: vi.fn(async () => {
      const idx = callCount;
      callCount++;
      return responseFn(idx);
    }),
  } as unknown as LLMClient;
  return { client, getCallCount: () => callCount };
}

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('P8: Quality repair loop bounded termination', () => {
  it('always-failing quality: call count ≤ 2*maxRounds + 1', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        async (maxRounds) => {
          const blackboard = new MultiAgentBlackboard();
          const { client, getCallCount } = buildCountingClient(() =>
            okResponse('Issues found: something is broken'),
          );

          const layer = new ExecutionLayer(blackboard, client, 'openai', 'test-model');
          const ctx = makeContext();

          const state = await (layer as any).runQualityRepairLoop(ctx, 0, maxRounds);

          // When quality never passes, the loop should exhaust all rounds
          // and return a degraded/failed state
          expect(state.status).toBe('failed');

          // Total calls: maxRounds rounds of (quality + repair) + 1 final quality
          // = 2*maxRounds + 1
          const expectedCalls = 2 * maxRounds + 1;
          expect(getCallCount()).toBe(expectedCalls);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('quality passes on first try: exactly 1 call', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        async (maxRounds) => {
          const blackboard = new MultiAgentBlackboard();
          const { client, getCallCount } = buildCountingClient(() =>
            okResponse('QUALITY_PASSED — all checks passed'),
          );

          const layer = new ExecutionLayer(blackboard, client, 'openai', 'test-model');
          const ctx = makeContext();

          const state = await (layer as any).runQualityRepairLoop(ctx, 0, maxRounds);

          expect(state.status).toBe('passed');
          // Only 1 call: the initial quality check
          expect(getCallCount()).toBe(1);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('quality passes after K repairs: exactly 2*K + 1 calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        // maxRounds ∈ [1, 5], passAfterRound ∈ [1, maxRounds]
        fc.integer({ min: 1, max: 5 }).chain((maxRounds) =>
          fc.tuple(
            fc.constant(maxRounds),
            fc.integer({ min: 1, max: maxRounds }),
          ),
        ),
        async ([maxRounds, passAfterRound]) => {
          const blackboard = new MultiAgentBlackboard();

          // The quality check passes on the (passAfterRound)-th re-check.
          // Call pattern: quality(fail) → repair → quality(fail) → repair → ... → quality(pass)
          // Quality checks are at call indices: 0, 2, 4, ... (even indices)
          // Repair calls are at indices: 1, 3, 5, ... (odd indices)
          // The quality check that passes is at call index 2*passAfterRound
          const passAtCallIndex = 2 * passAfterRound;

          const { client, getCallCount } = buildCountingClient((callIndex) => {
            // Even indices are quality checks, odd indices are repair calls
            if (callIndex === passAtCallIndex) {
              return okResponse('QUALITY_PASSED');
            }
            if (callIndex % 2 === 0) {
              return okResponse('Issues found: something needs fixing');
            }
            return okResponse('Applied repair');
          });

          const layer = new ExecutionLayer(blackboard, client, 'openai', 'test-model');
          const ctx = makeContext();

          const state = await (layer as any).runQualityRepairLoop(ctx, 0, maxRounds);

          expect(state.status).toBe('passed');
          // Exactly 2*passAfterRound + 1 calls
          expect(getCallCount()).toBe(2 * passAfterRound + 1);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('maxRounds=0: only 1 quality check, no repair', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // whether quality passes or fails
        async (qualityPasses) => {
          const blackboard = new MultiAgentBlackboard();
          const { client, getCallCount } = buildCountingClient(() =>
            qualityPasses
              ? okResponse('QUALITY_PASSED')
              : okResponse('Issues found: broken'),
          );

          const layer = new ExecutionLayer(blackboard, client, 'openai', 'test-model');
          const ctx = makeContext();

          const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

          if (qualityPasses) {
            expect(state.status).toBe('passed');
          } else {
            expect(state.status).toBe('failed');
          }
          // With maxRounds=0: only 1 quality check, no repair possible
          expect(getCallCount()).toBe(1);
        },
      ),
      { numRuns: 10 },
    );
  });
});
