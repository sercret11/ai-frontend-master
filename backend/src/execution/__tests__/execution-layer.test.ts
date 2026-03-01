/**
 * ExecutionLayer 单元测试
 *
 * 测试内容：
 * 1. 波次调度正确性（依赖关系 → 波次分组）— 纯逻辑，无需 LLM
 * 2. 并行执行与单任务失败隔离 — 使用 mock LLMClient
 * 3. 质量修复循环（0轮/1轮/2轮/降级）— 使用 mock LLMClient
 *
 * 需求: R3.1, R3.2, R3.7, R4.6, R4.7
 */

import { describe, it, expect, vi } from 'vitest';
import { ExecutionLayer } from '../execution-layer.js';
import { MultiAgentBlackboard } from '../../runtime/multi-agent/blackboard.js';
import type { ExecutionPlanTask, ExecutionAgentID } from '../../planning/types.js';
import type { LLMClient } from '../../llm/client.js';
import type { LLMResponse, ToolExecutor } from '../../llm/types.js';
import type { RuntimeEvent, RuntimeEventPayload } from '@ai-frontend/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(
  id: string,
  agentId: ExecutionAgentID,
  dependsOn: string[] = [],
  tools: string[] = [],
): ExecutionPlanTask {
  return { id, agentId, goal: `Task ${id}`, dependsOn, tools };
}

function createMockEmitter(): {
  emitter: (event: RuntimeEventPayload) => RuntimeEvent;
  events: RuntimeEventPayload[];
} {
  const events: RuntimeEventPayload[] = [];
  const emitter = (event: RuntimeEventPayload): RuntimeEvent => {
    events.push(event);
    return {
      id: `event-${events.length}`,
      timestamp: Date.now(),
      ...event,
    } as unknown as RuntimeEvent;
  };
  return { emitter, events };
}

/** Build a successful LLMResponse with the given text. */
function okResponse(text: string): LLMResponse {
  return {
    text,
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
  };
}

// ===========================================================================
// 1. Wave Scheduling Tests (pure logic, no LLM)
// ===========================================================================

describe('ExecutionLayer — scheduleWaves (pure logic)', () => {
  // Create an ExecutionLayer with dummy dependencies — scheduleWaves is pure
  const layer = new ExecutionLayer(
    {} as MultiAgentBlackboard,
    {} as LLMClient,
    'openai',
    'test-model',
  );

  it('returns empty waves for empty task list', () => {
    const waves = layer.scheduleWaves([]);
    expect(waves).toEqual([]);
  });

  it('puts tasks with no dependencies into wave 0', () => {
    const tasks = [
      task('a', 'scaffold-agent'),
      task('b', 'page-agent'),
      task('c', 'state-agent'),
    ];
    const waves = layer.scheduleWaves(tasks);
    expect(waves).toHaveLength(1);
    expect(waves[0].map(t => t.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('puts dependent tasks into later waves', () => {
    const tasks = [
      task('scaffold', 'scaffold-agent'),
      task('page', 'page-agent', ['scaffold']),
      task('state', 'state-agent', ['scaffold']),
    ];
    const waves = layer.scheduleWaves(tasks);
    expect(waves).toHaveLength(2);
    expect(waves[0].map(t => t.id)).toEqual(['scaffold']);
    expect(waves[1].map(t => t.id).sort()).toEqual(['page', 'state']);
  });

  it('schedules the typical wave pattern: scaffold → page/state/style → interaction → quality → repair', () => {
    const tasks = [
      task('scaffold-1', 'scaffold-agent'),
      task('page-1', 'page-agent', ['scaffold-1']),
      task('state-1', 'state-agent', ['scaffold-1']),
      task('style-1', 'style-agent', ['scaffold-1']),
      task('interaction-1', 'interaction-agent', ['page-1', 'state-1']),
      task('quality-1', 'quality-agent', ['page-1', 'state-1', 'style-1', 'interaction-1']),
      task('repair-1', 'repair-agent', ['quality-1']),
    ];
    const waves = layer.scheduleWaves(tasks);

    expect(waves).toHaveLength(5);
    // Wave 0: scaffold
    expect(waves[0].map(t => t.id)).toEqual(['scaffold-1']);
    // Wave 1: page, state, style (parallel)
    expect(waves[1].map(t => t.id).sort()).toEqual(['page-1', 'state-1', 'style-1']);
    // Wave 2: interaction
    expect(waves[2].map(t => t.id)).toEqual(['interaction-1']);
    // Wave 3: quality
    expect(waves[3].map(t => t.id)).toEqual(['quality-1']);
    // Wave 4: repair
    expect(waves[4].map(t => t.id)).toEqual(['repair-1']);
  });

  it('throws on cycle detection', () => {
    const tasks = [
      task('a', 'page-agent', ['b']),
      task('b', 'state-agent', ['a']),
    ];
    expect(() => layer.scheduleWaves(tasks)).toThrow(/Cycle detected/);
  });

  it('throws on self-cycle', () => {
    const tasks = [task('a', 'scaffold-agent', ['a'])];
    expect(() => layer.scheduleWaves(tasks)).toThrow(/Cycle detected/);
  });

  it('ignores unknown dependency IDs gracefully', () => {
    const tasks = [
      task('a', 'scaffold-agent', ['nonexistent']),
      task('b', 'page-agent', ['a']),
    ];
    const waves = layer.scheduleWaves(tasks);
    // 'a' depends on 'nonexistent' which is not in the task list → treated as 0 in-degree
    expect(waves).toHaveLength(2);
    expect(waves[0].map(t => t.id)).toEqual(['a']);
    expect(waves[1].map(t => t.id)).toEqual(['b']);
  });

  it('handles a single task', () => {
    const tasks = [task('only', 'scaffold-agent')];
    const waves = layer.scheduleWaves(tasks);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(1);
    expect(waves[0][0].id).toBe('only');
  });

  it('ensures every dependency is in an earlier wave', () => {
    const tasks = [
      task('a', 'scaffold-agent'),
      task('b', 'page-agent', ['a']),
      task('c', 'state-agent', ['a']),
      task('d', 'interaction-agent', ['b', 'c']),
      task('e', 'quality-agent', ['d']),
    ];
    const waves = layer.scheduleWaves(tasks);

    // Build a map: taskId → waveIndex
    const waveOf = new Map<string, number>();
    waves.forEach((wave, idx) => wave.forEach(t => waveOf.set(t.id, idx)));

    for (const t of tasks) {
      for (const dep of t.dependsOn) {
        expect(waveOf.get(dep)!).toBeLessThan(waveOf.get(t.id)!);
      }
    }
  });
});


// ===========================================================================
// 2. Parallel Execution & Single Task Failure Isolation (mock LLMClient)
// ===========================================================================

describe('ExecutionLayer — runWave parallel execution & failure isolation', () => {
  it('completes all tasks even when one fails', async () => {
    const blackboard = new MultiAgentBlackboard();

    // Track call order to verify parallelism
    const callLog: string[] = [];

    const mockLLMClient = {
      completeWithTools: vi.fn(async (params: any, _executor: ToolExecutor) => {
        // Extract the task goal from the user message or system prompt
        const systemPrompt: string = params.systemPrompt ?? '';

        // Simulate a failure for page-agent tasks
        if (systemPrompt.includes('page-agent') || systemPrompt.includes('Page')) {
          callLog.push('page-agent-called');
          throw new Error('Simulated page-agent failure');
        }

        callLog.push('other-agent-called');
        return okResponse('Task completed successfully');
      }),
    } as unknown as LLMClient;

    const layer = new ExecutionLayer(blackboard, mockLLMClient, 'openai', 'test-model');
    const { emitter } = createMockEmitter();

    const waveTasks = [
      task('page-1', 'page-agent', [], ['read', 'write']),
      task('state-1', 'state-agent', [], ['read', 'write']),
      task('style-1', 'style-agent', [], ['read', 'write']),
    ];

    const context = {
      sessionId: 'test-session',
      runId: 'test-run',
      userMessage: 'Build a todo app',
      techStack: ['react'],
      abortSignal: new AbortController().signal,
      emitRuntimeEvent: emitter,
    };

    const results = await layer.runWave(waveTasks, context, 0);

    // All 3 tasks should have results (none blocked)
    expect(results).toHaveLength(3);

    // page-agent should have failed
    const pageResult = results.find(r => r.taskId === 'page-1');
    expect(pageResult).toBeDefined();
    expect(pageResult!.success).toBe(false);
    expect(pageResult!.error).toContain('Simulated page-agent failure');

    // state-agent and style-agent should have succeeded
    const stateResult = results.find(r => r.taskId === 'state-1');
    const styleResult = results.find(r => r.taskId === 'style-1');
    expect(stateResult!.success).toBe(true);
    expect(styleResult!.success).toBe(true);

    // Verify all agents were called (parallelism — none was blocked)
    expect(mockLLMClient.completeWithTools).toHaveBeenCalledTimes(3);
  });

  it('records failed tasks to the blackboard', async () => {
    const blackboard = new MultiAgentBlackboard();

    const mockLLMClient = {
      completeWithTools: vi.fn(async () => {
        throw new Error('Agent crashed');
      }),
    } as unknown as LLMClient;

    const layer = new ExecutionLayer(blackboard, mockLLMClient, 'openai', 'test-model');
    const { emitter } = createMockEmitter();

    const waveTasks = [task('fail-1', 'scaffold-agent', [], ['write'])];

    const results = await layer.runWave(waveTasks, context(), 0);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);

    // Blackboard should have the quality gate failure recorded
    const snapshot = blackboard.snapshot();
    const failedGate = snapshot.qualityGates.find(g => g.gate === 'task-fail-1');
    expect(failedGate).toBeDefined();
    expect(failedGate!.status).toBe('failed');

    function context() {
      return {
        sessionId: 'test-session',
        runId: 'test-run',
        userMessage: 'Build something',
        techStack: ['react'],
        abortSignal: new AbortController().signal,
        emitRuntimeEvent: emitter,
      };
    }
  });
});


// ===========================================================================
// 3. Quality Repair Loop (mock LLMClient)
// ===========================================================================

describe('ExecutionLayer — runQualityRepairLoop', () => {
  function makeContext() {
    const { emitter } = createMockEmitter();
    return {
      sessionId: 'test-session',
      runId: 'test-run',
      userMessage: 'Build a todo app',
      techStack: ['react'],
      abortSignal: new AbortController().signal,
      emitRuntimeEvent: emitter,
    };
  }

  /**
   * Build a mock LLMClient where `completeWithTools` returns different
   * responses based on a call counter.  `responses` is an array of
   * LLMResponse objects returned in order; once exhausted the last
   * response is repeated.
   */
  function buildMockClient(responses: LLMResponse[]): LLMClient {
    let callIndex = 0;
    return {
      completeWithTools: vi.fn(async () => {
        const idx = Math.min(callIndex, responses.length - 1);
        callIndex++;
        return responses[idx];
      }),
    } as unknown as LLMClient;
  }

  it('0 rounds — quality passes immediately', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED — all checks passed'),
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = makeContext();

    // Access the private method via type assertion
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 2);

    expect(state.status).toBe('passed');
    expect(state.summary).toContain('passed');

    // Only 1 call: the quality check
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('1 round — quality fails, repair fixes, quality passes', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      // Round 0: quality fails
      okResponse('Issues found: missing import in App.tsx'),
      // Round 0: repair runs
      okResponse('Fixed missing import in App.tsx'),
      // Round 1: quality passes
      okResponse('QUALITY_PASSED'),
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = makeContext();

    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 2);

    expect(state.status).toBe('passed');
    // 3 calls: quality(fail) → repair → quality(pass)
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(3);
  });

  it('2 rounds — quality fails twice, repair twice, quality passes', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      // Round 0: quality fails
      okResponse('Issues found: broken import'),
      // Round 0: repair
      okResponse('Attempted fix'),
      // Round 1: quality still fails
      okResponse('Issues found: type error remains'),
      // Round 1: repair
      okResponse('Fixed type error'),
      // Round 2: quality passes
      okResponse('QUALITY_PASSED'),
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = makeContext();

    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 2);

    expect(state.status).toBe('passed');
    // 5 calls: quality(fail) → repair → quality(fail) → repair → quality(pass)
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(5);
  });

  it('degraded — quality fails after max rounds exhausted', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      // All quality checks fail, all repairs fail to fix
      okResponse('Issues found: critical error in routing'),
      okResponse('Attempted repair but failed'),
      okResponse('Issues found: critical error persists'),
      okResponse('Attempted repair again'),
      okResponse('Issues found: still broken'),
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = makeContext();

    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 2);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('Degraded completion');
    expect(state.summary).toContain('repair rounds exhausted');
  });

  it('degraded — records unresolved issues to blackboard', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('Issues found: missing file src/store.ts'),
      okResponse('Repair attempted'),
      okResponse('Issues found: missing file src/store.ts still'),
      okResponse('Repair attempted again'),
      okResponse('Issues found: missing file src/store.ts persists'),
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = makeContext();

    await (layer as any).runQualityRepairLoop(ctx, 0, 2);

    // Blackboard should have the quality gate recorded as failed
    const snapshot = blackboard.snapshot();
    const qualityGate = snapshot.qualityGates.find(g => g.gate === 'quality-gate');
    expect(qualityGate).toBeDefined();
    expect(qualityGate!.status).toBe('failed');
  });
});
