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

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ExecutionLayer } from '../execution-layer.js';
import { MultiAgentBlackboard } from '../../runtime/multi-agent/blackboard.js';
import type { ExecutionPlanTask, ExecutionAgentID } from '../../planning/types.js';
import type { LLMClient } from '../../llm/client.js';
import type { LLMResponse, ToolExecutor } from '../../llm/types.js';
import type { RuntimeEvent, RuntimeEventPayload } from '@ai-frontend/shared-types';
import { FileStorage } from '../../storage/file-storage.js';
import { SessionStorage } from '../../session/storage.js';

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
    let successfulAgentCalls = 0;

    const mockLLMClient = {
      completeWithTools: vi.fn(async (params: any, executor: ToolExecutor) => {
        // Extract the task goal from the user message or system prompt
        const systemPrompt: string = params.systemPrompt ?? '';

        // Simulate a failure for page-agent tasks
        if (systemPrompt.includes('page-agent') || systemPrompt.includes('Page')) {
          callLog.push('page-agent-called');
          throw new Error('Simulated page-agent failure');
        }

        successfulAgentCalls += 1;
        const targetPath = successfulAgentCalls === 1
          ? 'src/state/mock-state.ts'
          : 'src/styles/mock-style.css';
        const content = successfulAgentCalls === 1
          ? 'export const stateValue = 1;\n'
          : 'body { background: #fff; }\n';
        await executor('write', {
          filePath: targetPath,
          content,
          createDirectories: true,
          mode: 'allow_full_overwrite',
        });

        callLog.push('other-agent-called');
        return okResponse('Task completed successfully');
      }),
    } as unknown as LLMClient;

    const layer = new ExecutionLayer(blackboard, mockLLMClient, 'openai', 'test-model');
    const { emitter } = createMockEmitter();
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'runwave-failure-isolation',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    const waveTasks = [
      task('page-1', 'page-agent', [], ['read', 'write']),
      task('state-1', 'state-agent', [], ['read', 'write']),
      task('style-1', 'style-agent', [], ['read', 'write']),
    ];

    const context = {
      sessionId: session.id,
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

  it('keeps retry-round tools context-complete for mutation-required agents', async () => {
    const blackboard = new MultiAgentBlackboard();
    const toolSets: string[][] = [];
    let callCount = 0;

    const mockLLMClient = {
      completeWithTools: vi.fn(async (params: any, executor: ToolExecutor) => {
        callCount += 1;
        toolSets.push((params.tools ?? []).map((tool: { name: string }) => tool.name));

        if (callCount === 1) {
          return okResponse('No file changes yet');
        }

        await executor('write', {
          filePath: 'src/pages/RetryPage.tsx',
          content: 'export const RetryPage = () => null;\n',
          createDirectories: true,
          mode: 'allow_full_overwrite',
        });
        return okResponse('Mutation applied');
      }),
    } as unknown as LLMClient;

    const layer = new ExecutionLayer(blackboard, mockLLMClient, 'openai', 'test-model');
    const { emitter } = createMockEmitter();
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'retry-tools-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    const result = await (layer as any).executeTask(
      task('page-retry', 'page-agent', [], ['read', 'glob', 'apply_diff', 'write']),
      {
        sessionId: session.id,
        runId: 'test-run',
        userMessage: 'Build admin prototype',
        techStack: ['react'],
        abortSignal: new AbortController().signal,
        emitRuntimeEvent: emitter,
      },
      1,
    );

    expect(result.success).toBe(true);
    expect(mockLLMClient.completeWithTools).toHaveBeenCalledTimes(2);
    expect(toolSets[0]).toContain('glob');
    expect(toolSets[1]).toContain('write');
    expect(toolSets[1]).toContain('apply_diff');
    expect(toolSets[1]).toContain('glob');
    expect(toolSets[1]).toContain('read');
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

describe('ExecutionLayer — run success criteria', () => {
  it('keeps execution successful when only planned quality/repair wave tasks fail but quality loop passes', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockLLMClient = {
      completeWithTools: vi.fn(),
    } as unknown as LLMClient;
    const layer = new ExecutionLayer(blackboard, mockLLMClient, 'openai', 'test-model');
    const { emitter } = createMockEmitter();

    const waveTask = task('repair-1', 'repair-agent', [], ['write']);
    vi.spyOn(layer, 'scheduleWaves').mockReturnValue([[waveTask]]);
    vi.spyOn(layer as any, 'runWave').mockResolvedValue([
      {
        taskId: 'repair-1',
        agentId: 'repair-agent',
        success: false,
        patchIntents: [],
        touchedFiles: [],
        error: 'task completed without required artifact mutation',
      },
    ]);
    vi.spyOn(layer as any, 'runQualityRepairLoop').mockResolvedValue({
      gate: 'quality-gate',
      status: 'passed',
      summary: 'All quality checks passed.',
    });

    const output = await layer.run({
      sessionId: 'test-session',
      runId: 'test-run',
      plan: {
        id: 'plan-1',
        createdAt: Date.now(),
        tasks: [waveTask],
      },
      userMessage: 'Build admin prototype',
      techStack: ['react', 'typescript'],
      abortSignal: new AbortController().signal,
      emitRuntimeEvent: emitter,
    });

    expect(output.success).toBe(true);
    expect(output.degradedTasks).toEqual([]);
    expect(output.unresolvedIssues).toEqual([]);
  });

  it('stops execution when maxToolCalls budget is exhausted', async () => {
    const blackboard = new MultiAgentBlackboard();
    const { emitter, events } = createMockEmitter();
    let writeCallCount = 0;
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'run-budget-stop',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    const mockLLMClient = {
      completeWithTools: vi.fn(async (_params: any, executor: ToolExecutor) => {
        writeCallCount += 1;
        await executor('write', {
          filePath: `src/generated/task-${writeCallCount}.ts`,
          content: `export const task${writeCallCount} = ${writeCallCount};\n`,
          createDirectories: true,
          mode: 'allow_full_overwrite',
        });
        return okResponse(`task ${writeCallCount} finished`);
      }),
    } as unknown as LLMClient;

    const layer = new ExecutionLayer(blackboard, mockLLMClient, 'openai', 'test-model');
    vi.spyOn(layer as any, 'runQualityRepairLoop').mockResolvedValue({
      gate: 'quality-gate',
      status: 'passed',
      summary: 'All quality checks passed.',
    });

    const output = await layer.run({
      sessionId: session.id,
      runId: 'test-run-budget-stop',
      plan: {
        id: 'plan-budget-stop',
        createdAt: Date.now(),
        tasks: [
          task('scaffold-1', 'scaffold-agent', [], ['write']),
          task('page-1', 'page-agent', ['scaffold-1'], ['write']),
        ],
      },
      userMessage: 'Build a dashboard app',
      techStack: ['react', 'typescript'],
      runtimeBudget: {
        maxToolCalls: 1,
      },
      abortSignal: new AbortController().signal,
      emitRuntimeEvent: emitter,
    });

    expect(output.success).toBe(false);
    expect(output.budgetStopReason).toBe('maxToolCalls');
    expect(output.budgetUsage?.usedToolCalls).toBe(1);
    expect(output.unresolvedIssues.some(item => item.includes('maxToolCalls'))).toBe(true);
    expect(output.touchedFiles).toContain('src/generated/task-1.ts');

    const exhaustedBudgetEvent = events.find(
      event => event.type === 'autonomy.budget' && event.status === 'exhausted',
    );
    expect(exhaustedBudgetEvent).toBeDefined();
  });
});


// ===========================================================================
// 3. Quality Repair Loop (mock LLMClient)
// ===========================================================================

describe('ExecutionLayer — runQualityRepairLoop', () => {
  beforeEach(() => {
    FileStorage.deleteFiles('test-session');
  });

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
      // Round 0: repair attempt 1/3
      okResponse('Fixed missing import in App.tsx'),
      // Round 0: repair attempt 2/3
      okResponse('Applied targeted fix and updated module wiring'),
      // Round 0: repair attempt 3/3
      okResponse('Completed repair pass with concrete file edits'),
      // Round 1: quality passes
      okResponse('QUALITY_PASSED'),
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = makeContext();

    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 2);

    expect(state.status).toBe('passed');
    // 5 calls: quality(fail) → repair(attempt1/2/3) → quality(pass)
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(5);
  });

  it('2 rounds — quality fails twice, repair twice, quality passes', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      // Round 0: quality fails
      okResponse('Issues found: broken import'),
      // Round 0: repair attempt 1/3
      okResponse('Attempted fix'),
      // Round 0: repair attempt 2/3
      okResponse('Applied import fix and route wiring update'),
      // Round 0: repair attempt 3/3
      okResponse('Completed additional mutation for quality blockers'),
      // Round 1: quality still fails
      okResponse('Issues found: type error remains'),
      // Round 1: repair attempt 1/3
      okResponse('Fixed type error'),
      // Round 1: repair attempt 2/3
      okResponse('Adjusted state contracts and selectors'),
      // Round 1: repair attempt 3/3
      okResponse('Finalized remaining patch set'),
      // Round 2: quality passes
      okResponse('QUALITY_PASSED'),
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = makeContext();

    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 2);

    expect(state.status).toBe('passed');
    // 9 calls: quality(fail) → repair(3 attempts) → quality(fail) → repair(3 attempts) → quality(pass)
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(9);
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

  it('fails quality when page artifacts are placeholder-only even if model says QUALITY_PASSED', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-placeholder-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });
    FileStorage.saveFiles(session.id, [
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `function App() {
  return <section />;
}

export default App;
`,
      },
      {
        path: 'src/pages/DashboardPage.tsx',
        language: 'typescript',
        content: `function DashboardPage() {
  return <section />;
}

export default DashboardPage;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('Artifact issues');
    expect(state.summary).toContain('empty container');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('does not treat JSX placeholder attribute as a placeholder marker quality issue', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-placeholder-attribute-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });
    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { Route, Routes } from 'react-router-dom';
import MerchantsPage from './pages/MerchantsPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<MerchantsPage />} />
    </Routes>
  );
}

export default App;
`,
      },
      {
        path: 'src/pages/MerchantsPage.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function MerchantsPage() {
  const [keyword, setKeyword] = useState('');
  return (
    <section>
      <h1>Merchants</h1>
      <input
        placeholder="搜索商家"
        value={keyword}
        onChange={event => setKeyword(event.target.value)}
      />
    </section>
  );
}

export default MerchantsPage;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('passed');
    expect(state.summary).not.toContain('placeholder markers');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('fails quality when page artifacts contain Chinese placeholder markers', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-chinese-placeholder-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });
    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import MerchantPage from './pages/MerchantPage';

function App() {
  const [value, setValue] = useState('');
  return (
    <main>
      <button onClick={() => setValue('clicked')}>{value || 'go'}</button>
      <Routes>
        <Route path="/merchant/overview" element={<MerchantPage />} />
      </Routes>
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/pages/MerchantPage.tsx',
        language: 'typescript',
        content: `function MerchantPage() {
  return <section>订单模块待实现</section>;
}

export default MerchantPage;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('contains placeholder markers');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('fails quality when router is mounted in both main and app shell', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-nested-router-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });
    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

function App() {
  const [count, setCount] = useState(0);
  return (
    <BrowserRouter>
      <button onClick={() => setCount(value => value + 1)}>{count}</button>
      <Routes>
        <Route path="/" element={<section>Merchant Console</section>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('Detected nested router providers');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('fails quality when src/main.tsx no longer mounts the routed app shell', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-main-shell-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });
    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return <div>外卖后台管理系统</div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';

function App() {
  const [value, setValue] = useState(0);
  return (
    <>
      <button onClick={() => setValue(v => v + 1)}>{value}</button>
      <Routes>
        <Route path="/" element={<section>Home</section>} />
      </Routes>
    </>
  );
}

export default App;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('does not mount a routed app shell');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('fails quality when routes are generic placeholders only', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-generic-route-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });
    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';

function App() {
  const [active, setActive] = useState('dashboard');
  return (
    <main>
      <button onClick={() => setActive('orders')}>{active}</button>
      <Routes>
        <Route path=\"/dashboard\" element={<section>Dashboard</section>} />
        <Route path=\"/orders\" element={<section>Orders</section>} />
        <Route path=\"/settings\" element={<section>Settings</section>} />
      </Routes>
    </main>
  );
}

export default App;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('only define generic navigation semantics');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('fails quality when zustand selectors return a fresh object each render', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-zustand-selector-loop-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/stores/authStore.ts',
        language: 'typescript',
        content: `import { create } from 'zustand';

type AuthState = {
  token: string | null;
  sessionExpiresAt: number | null;
};

export const useAuthStore = create<AuthState>(() => ({
  token: null,
  sessionExpiresAt: null,
}));
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';

function App() {
  const [count, setCount] = useState(0);
  const { token, sessionExpiresAt } = useAuthStore((state) => ({
    token: state.token,
    sessionExpiresAt: state.sessionExpiresAt,
  }));
  return (
    <main>
      <button onClick={() => setCount((value) => value + 1)}>
        {String(token)}-{String(sessionExpiresAt)}-{count}
      </button>
      <Routes>
        <Route path="/merchant/list" element={<section>merchant-list</section>} />
      </Routes>
    </main>
  );
}

export default App;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('store selector that returns a new object literal');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('fails quality when router misses architect route contracts', async () => {
    const blackboard = new MultiAgentBlackboard();
    blackboard.setSessionDocuments([
      {
        id: 'doc-architect',
        agentId: 'frontend-architect',
        createdAt: Date.now(),
        version: 1,
        content: {
          componentTree: [],
          routeDesign: [
            { path: '/merchant/list', componentId: 'merchant-list' },
            { path: '/order/list', componentId: 'order-list' },
          ],
          stateManagement: {
            approach: 'redux',
            stores: [],
          },
        },
      } as any,
    ]);

    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-route-coverage-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import MerchantListPage from './pages/MerchantListPage';

function App() {
  const [value, setValue] = useState('');
  return (
    <main>
      <button onClick={() => setValue('clicked')}>{value || 'go'}</button>
      <Routes>
        <Route path="/merchant/list" element={<MerchantListPage />} />
      </Routes>
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/pages/MerchantListPage.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function MerchantListPage() {
  const [keyword, setKeyword] = useState('');
  return (
    <section>
      <h1>Merchant List</h1>
      <input value={keyword} onChange={event => setKeyword(event.target.value)} />
    </section>
  );
}

export default MerchantListPage;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('Router is missing architect routes');
    expect(state.summary).toContain('/order/list');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('passes quality when architect routes are absolute but implementation uses relative child paths', async () => {
    const blackboard = new MultiAgentBlackboard();
    blackboard.setSessionDocuments([
      {
        id: 'doc-architect-relative-routes',
        agentId: 'frontend-architect',
        createdAt: Date.now(),
        version: 1,
        content: {
          componentTree: [],
          routeDesign: [
            { path: '/flow-2', componentId: 'flow-2' },
            { path: '/flow-3', componentId: 'flow-3' },
            { path: '/flow-4', componentId: 'flow-4' },
          ],
          stateManagement: {
            approach: 'redux',
            stores: [],
          },
        },
      } as any,
    ]);

    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-route-relative-equivalence-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { Outlet } from 'react-router-dom';

function App() {
  return (
    <main className="root-shell">
      <Outlet />
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/routes/index.tsx',
        language: 'typescript',
        content: `import { createBrowserRouter } from 'react-router-dom';
import App from '../App';
import Flow2Page from '../pages/Flow2Page';
import Flow3Page from '../pages/Flow3Page';
import Flow4Page from '../pages/Flow4Page';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { path: 'flow-2', element: <Flow2Page /> },
      { path: 'flow-3', element: <Flow3Page /> },
      { path: 'flow-4', element: <Flow4Page /> },
    ],
  },
]);
`,
      },
      {
        path: 'src/pages/Flow2Page.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function Flow2Page() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(value => value + 1)}>{count}</button>;
}

export default Flow2Page;
`,
      },
      {
        path: 'src/pages/Flow3Page.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function Flow3Page() {
  const [keyword, setKeyword] = useState('');
  return <input value={keyword} onChange={event => setKeyword(event.target.value)} />;
}

export default Flow3Page;
`,
      },
      {
        path: 'src/pages/Flow4Page.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function Flow4Page() {
  const [open, setOpen] = useState(false);
  return <button onClick={() => setOpen(value => !value)}>{open ? 'open' : 'closed'}</button>;
}

export default Flow4Page;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('passed');
    expect(state.summary).not.toContain('Router is missing architect routes');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('passes quality when architect and implemented routes differ only by singular/plural segments', async () => {
    const blackboard = new MultiAgentBlackboard();
    blackboard.setSessionDocuments([
      {
        id: 'doc-architect-plural-route',
        agentId: 'frontend-architect',
        createdAt: Date.now(),
        version: 1,
        content: {
          componentTree: [],
          routeDesign: [
            { path: '/finance/settlements', componentId: 'finance-settlement' },
          ],
          stateManagement: {
            approach: 'redux',
            stores: [],
          },
        },
      } as any,
    ]);

    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-route-plural-equivalence-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import FinanceSettlementPage from './pages/FinanceSettlementPage';

function App() {
  const [value, setValue] = useState('');
  return (
    <main>
      <button onClick={() => setValue('ready')}>{value || 'go'}</button>
      <Routes>
        <Route path="/finance/settlement" element={<FinanceSettlementPage />} />
      </Routes>
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/pages/FinanceSettlementPage.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function FinanceSettlementPage() {
  const [keyword, setKeyword] = useState('');
  return (
    <section>
      <h1>Finance Settlement</h1>
      <input value={keyword} onChange={event => setKeyword(event.target.value)} />
    </section>
  );
}

export default FinanceSettlementPage;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('passed');
    expect(state.summary).not.toContain('Router is missing architect routes');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('passes quality when route and page modules are reachable through scoped alias imports', async () => {
    const blackboard = new MultiAgentBlackboard();
    blackboard.setSessionDocuments([
      {
        id: 'doc-architect-scoped-alias-routes',
        agentId: 'frontend-architect',
        createdAt: Date.now(),
        version: 1,
        content: {
          componentTree: [],
          routeDesign: [
            { path: '/dashboard', componentId: 'dashboard' },
            { path: '/auth/accounts-roles', componentId: 'accounts-roles' },
          ],
          stateManagement: {
            approach: 'redux',
            stores: [],
          },
        },
      } as any,
    ]);

    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-scoped-alias-reachability-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@routes/index';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { Outlet } from 'react-router-dom';

function App() {
  return (
    <main className="root-shell">
      <Outlet />
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/routes/index.tsx',
        language: 'typescript',
        content: `import { createBrowserRouter } from 'react-router-dom';
import App from '../App';
import DashboardPage from '../pages/DashboardPage';
import AccountsRolesPage from '../pages/AccountsRolesPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'auth/accounts-roles', element: <AccountsRolesPage /> },
    ],
  },
]);
`,
      },
      {
        path: 'src/pages/DashboardPage.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function DashboardPage() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(value => value + 1)}>{count}</button>;
}

export default DashboardPage;
`,
      },
      {
        path: 'src/pages/AccountsRolesPage.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function AccountsRolesPage() {
  const [keyword, setKeyword] = useState('');
  return <input value={keyword} onChange={event => setKeyword(event.target.value)} />;
}

export default AccountsRolesPage;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('passed');
    expect(state.summary).not.toContain('Router is missing architect routes');
    expect(state.summary).not.toContain('UI source files do not expose interactive event handlers');
    expect(state.summary).not.toContain('UI source files do not contain React stateful hooks');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('fails quality when relative imports cannot be resolved from generated files', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-import-resolution-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import MerchantListPage from './pages/MerchantListPage';
import MerchantDetailPage from './pages/MerchantDetailPage';

function App() {
  const [active, setActive] = useState('list');
  return (
    <main>
      <button onClick={() => setActive('detail')}>{active}</button>
      <Routes>
        <Route path="/merchant/list" element={<MerchantListPage />} />
        <Route path="/merchant/detail" element={<MerchantDetailPage />} />
      </Routes>
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/pages/MerchantListPage.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function MerchantListPage() {
  const [keyword, setKeyword] = useState('');
  return (
    <section>
      <h1>Merchant List</h1>
      <input value={keyword} onChange={event => setKeyword(event.target.value)} />
    </section>
  );
}

export default MerchantListPage;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('has unresolved import');
    expect(state.summary).toContain('./pages/MerchantDetailPage');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('fails quality when @ alias style imports cannot be resolved from generated files', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-alias-style-resolution-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import MerchantListPage from './pages/MerchantListPage';

function App() {
  const [active, setActive] = useState('list');
  return (
    <main>
      <button onClick={() => setActive('detail')}>{active}</button>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/merchant/list" element={<MerchantListPage />} />
        </Route>
      </Routes>
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/layouts/AppLayout.tsx',
        language: 'typescript',
        content: `import { Outlet } from 'react-router-dom';
import '@/styles/layout.css';

export function AppLayout() {
  return (
    <section>
      <Outlet />
    </section>
  );
}
`,
      },
      {
        path: 'src/pages/MerchantListPage.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function MerchantListPage() {
  const [keyword, setKeyword] = useState('');
  return (
    <section>
      <h1>Merchant List</h1>
      <input value={keyword} onChange={event => setKeyword(event.target.value)} />
    </section>
  );
}

export default MerchantListPage;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('has unresolved import');
    expect(state.summary).toContain('@/styles/layout.css');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('fails quality when relative re-exports cannot be resolved from generated files', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-reexport-resolution-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { AppRouter } from './router';

function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <button onClick={() => setCount(value => value + 1)}>{count}</button>
      <AppRouter />
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/router.ts',
        language: 'typescript',
        content: `export { AppRouter } from './index';
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('has unresolved import');
    expect(state.summary).toContain('./index');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('fails quality when @ alias relies on __dirname in an ESM vite config', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-alias-esm-dirname-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'package.json',
        language: 'json',
        content: `{
  "name": "test-app",
  "type": "module"
}
`,
      },
      {
        path: 'vite.config.ts',
        language: 'typescript',
        content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
`,
      },
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

function App() {
  const [value, setValue] = useState('');
  const token = useAuthStore(state => state.token);
  return (
    <main>
      <button onClick={() => setValue(token || 'none')}>{value || 'go'}</button>
      <Routes>
        <Route path="/merchant/overview" element={<section>{token || 'empty'}</section>} />
      </Routes>
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/stores/authStore.ts',
        language: 'typescript',
        content: `type AuthState = { token: string | null };

const state: AuthState = { token: null };

export function useAuthStore<T>(selector: (input: AuthState) => T): T {
  return selector(state);
}
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('uses __dirname for "@" alias in an ESM project');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('passes quality when @ alias is configured for ESM vite projects', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-alias-esm-pass-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'package.json',
        language: 'json',
        content: `{
  "name": "test-app",
  "type": "module"
}
`,
      },
      {
        path: 'vite.config.ts',
        language: 'typescript',
        content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
`,
      },
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

function App() {
  const [value, setValue] = useState('');
  const token = useAuthStore(state => state.token);
  return (
    <main>
      <button onClick={() => setValue(token || 'none')}>{value || 'go'}</button>
      <Routes>
        <Route path="/merchant/overview" element={<section>{token || 'empty'}</section>} />
      </Routes>
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/stores/authStore.ts',
        language: 'typescript',
        content: `type AuthState = { token: string | null };

const state: AuthState = { token: null };

export function useAuthStore<T>(selector: (input: AuthState) => T): T {
  return selector(state);
}
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('passed');
    expect(state.summary).not.toContain('uses __dirname for "@" alias in an ESM project');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('fails quality when a page stays as a low-fidelity single block view', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-low-fidelity-page-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import MerchantListPage from './pages/MerchantListPage';

function App() {
  const [tab, setTab] = useState('list');
  return (
    <main>
      <button onClick={() => setTab('list')}>{tab}</button>
      <Routes>
        <Route path="/merchant/list" element={<MerchantListPage />} />
      </Routes>
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/pages/MerchantListPage.tsx',
        language: 'typescript',
        content: `function MerchantListPage() {
  return <div>商家管理</div>;
}

export default MerchantListPage;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('failed');
    expect(state.summary).toContain('appears low-fidelity');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('passes quality when App.tsx is only an Outlet routing shell', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-outlet-shell-app-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { Outlet } from 'react-router-dom';

function App() {
  return (
    <main className="route-shell">
      <Outlet />
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/routes/index.tsx',
        language: 'typescript',
        content: `import { createBrowserRouter } from 'react-router-dom';
import App from '../App';
import MerchantDashboardPage from '../pages/MerchantDashboardPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { path: 'dashboard', element: <MerchantDashboardPage /> },
    ],
  },
]);
`,
      },
      {
        path: 'src/pages/MerchantDashboardPage.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function MerchantDashboardPage() {
  const [value, setValue] = useState(0);
  return <button onClick={() => setValue(v => v + 1)}>{value}</button>;
}

export default MerchantDashboardPage;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('passed');
    expect(state.summary).not.toContain('src/App.tsx appears low-fidelity');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('ignores low-fidelity page files that are not reachable from src/main', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-ignore-unreachable-page-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { Route, Routes } from 'react-router-dom';
import MerchantDashboardPage from './pages/MerchantDashboardPage';

function App() {
  return (
    <main>
      <Routes>
        <Route path="/merchant/dashboard" element={<MerchantDashboardPage />} />
      </Routes>
    </main>
  );
}

export default App;
`,
      },
      {
        path: 'src/pages/MerchantDashboardPage.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function MerchantDashboardPage() {
  const [value, setValue] = useState(0);
  return <button onClick={() => setValue(v => v + 1)}>{value}</button>;
}

export default MerchantDashboardPage;
`,
      },
      {
        path: 'src/pages/LegacyPlaceholderPage.tsx',
        language: 'typescript',
        content: `function LegacyPlaceholderPage() {
  return <div>浠呬緵鍏煎</div>;
}

export default LegacyPlaceholderPage;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const ctx = {
      ...makeContext(),
      sessionId: session.id,
    };
    const state = await (layer as any).runQualityRepairLoop(ctx, 0, 0);

    expect(state.status).toBe('passed');
    expect(state.summary).not.toContain('LegacyPlaceholderPage');
    expect(state.summary).not.toContain('appears low-fidelity');
    expect(mockClient.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('scopes unresolved-import analysis to the primary runtime workspace when multiple src roots exist', async () => {
    const blackboard = new MultiAgentBlackboard();
    const mockClient = buildMockClient([
      okResponse('QUALITY_PASSED'),
    ]);
    const session = SessionStorage.createSession({
      ownerId: 'test-owner',
      title: 'quality-primary-workspace-scope-test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'test-model',
      projectType: null,
    });

    FileStorage.saveFiles(session.id, [
      {
        path: 'src/main.tsx',
        language: 'typescript',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import { Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';

function App() {
  return (
    <Routes>
      <Route path="/home" element={<HomePage />} />
    </Routes>
  );
}

export default App;
`,
      },
      {
        path: 'src/pages/HomePage.tsx',
        language: 'typescript',
        content: `import { useState } from 'react';

function HomePage() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(v => v + 1)}>{count}</button>;
}

export default HomePage;
`,
      },
      {
        path: 'workspace-copy/src/main.tsx',
        language: 'typescript',
        content: `import App from './App';
import './missing.css';
export default App;
`,
      },
      {
        path: 'workspace-copy/src/App.tsx',
        language: 'typescript',
        content: `import GhostPage from './pages/GhostPage';

function App() {
  return <GhostPage />;
}

export default App;
`,
      },
    ]);

    const layer = new ExecutionLayer(blackboard, mockClient, 'openai', 'test-model');
    const unresolved = (layer as any).collectCurrentUnresolvedImportIssues(session.id) as string[];
    const qualityIssues = (layer as any).collectArtifactQualityIssues(session.id) as string[];

    expect(unresolved).toHaveLength(0);
    expect(qualityIssues.every(issue => !issue.includes('workspace-copy/'))).toBe(true);
  });
});
