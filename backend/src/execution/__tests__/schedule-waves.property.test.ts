/**
 * 属性 P7：波次调度依赖正确性
 *
 * 验证对于任意 ExecutionPlan，scheduleWaves 产出的波次序列满足：
 * 1. 每个任务的所有依赖任务都在更早的波次中
 * 2. 所有输入任务恰好出现一次在输出波次中
 * 3. 同一波次内的任务之间没有依赖关系
 *
 * 生成策略：
 * - 与 P6 相同：生成拓扑有序的任务 ID 列表，每个任务仅依赖列表中更早的任务（保证无环）
 *
 * **Validates: Requirements R3.1, R3.2**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ExecutionLayer } from '../execution-layer.js';
import type { ExecutionPlanTask, ExecutionAgentID } from '../../planning/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_AGENT_IDS: ExecutionAgentID[] = [
  'scaffold-agent',
  'page-agent',
  'interaction-agent',
  'state-agent',
  'style-agent',
  'quality-agent',
  'repair-agent',
];

function makeExecutionLayer(): ExecutionLayer {
  return new ExecutionLayer(
    {} as any, // blackboard — not used by scheduleWaves
    {} as any, // llmClient — not used by scheduleWaves
    'openai',
    'test',
  );
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary for a valid ExecutionAgentID */
const agentIdArb = fc.constantFrom(...VALID_AGENT_IDS);

/**
 * Arbitrary for a valid DAG of ExecutionPlanTasks.
 *
 * Strategy: generate N task IDs in topological order (task-0, task-1, ...).
 * For each task at index i, dependsOn is a subset of tasks at indices [0, i).
 * This guarantees the graph is acyclic.
 */
const dagTasksArb: fc.Arbitrary<ExecutionPlanTask[]> = fc
  .integer({ min: 1, max: 15 })
  .chain((n) =>
    fc.tuple(
      fc.array(agentIdArb, { minLength: n, maxLength: n }),
      // For each task i, generate a boolean mask of length i for potential deps
      ...Array.from({ length: n }, (_, i) =>
        i === 0
          ? fc.constant([] as boolean[])
          : fc.array(fc.boolean(), { minLength: i, maxLength: i }),
      ),
    ).map(([agentIds, ...depMasks]) => {
      const tasks: ExecutionPlanTask[] = [];
      for (let i = 0; i < n; i++) {
        const deps: string[] = [];
        const mask = depMasks[i] ?? [];
        for (let j = 0; j < mask.length; j++) {
          if (mask[j]) {
            deps.push(`task-${j}`);
          }
        }
        tasks.push({
          id: `task-${i}`,
          agentId: agentIds[i],
          goal: `Goal for task-${i}`,
          dependsOn: deps,
          tools: ['write'],
        });
      }
      return tasks;
    }),
  );

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('P7: Wave scheduling dependency correctness', () => {
  const layer = makeExecutionLayer();

  it('all dependencies of a task appear in earlier waves', () => {
    fc.assert(
      fc.property(dagTasksArb, (tasks) => {
        const waves = layer.scheduleWaves(tasks);

        // Build a map: taskId → wave index
        const waveIndex = new Map<string, number>();
        for (let w = 0; w < waves.length; w++) {
          for (const task of waves[w]) {
            waveIndex.set(task.id, w);
          }
        }

        // For every task, all its dependencies must be in strictly earlier waves
        for (const task of tasks) {
          const taskWave = waveIndex.get(task.id);
          expect(taskWave).toBeDefined();
          for (const depId of task.dependsOn) {
            const depWave = waveIndex.get(depId);
            expect(depWave).toBeDefined();
            expect(depWave!).toBeLessThan(taskWave!);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('all input tasks appear exactly once in the output waves', () => {
    fc.assert(
      fc.property(dagTasksArb, (tasks) => {
        const waves = layer.scheduleWaves(tasks);

        // Flatten all wave tasks
        const outputIds = waves.flat().map((t) => t.id);

        // Same count
        expect(outputIds.length).toBe(tasks.length);

        // No duplicates
        expect(new Set(outputIds).size).toBe(tasks.length);

        // Same set of IDs
        const inputIds = new Set(tasks.map((t) => t.id));
        for (const id of outputIds) {
          expect(inputIds.has(id)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('tasks within the same wave have no dependencies on each other', () => {
    fc.assert(
      fc.property(dagTasksArb, (tasks) => {
        const waves = layer.scheduleWaves(tasks);

        for (const wave of waves) {
          const waveIds = new Set(wave.map((t) => t.id));
          for (const task of wave) {
            for (const depId of task.dependsOn) {
              // No task in this wave should depend on another task in the same wave
              expect(waveIds.has(depId)).toBe(false);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('returns empty array for empty input', () => {
    const waves = layer.scheduleWaves([]);
    expect(waves).toEqual([]);
  });
});
