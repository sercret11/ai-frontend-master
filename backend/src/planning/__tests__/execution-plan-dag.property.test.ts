/**
 * 属性 P6：执行计划无环
 *
 * 验证对于任意合法的 ExecutionPlan，detectCycle 返回 { hasCycle: false }（即任务依赖图为 DAG）。
 * 同时验证逆命题：包含循环的计划，detectCycle 返回 { hasCycle: true }。
 *
 * 生成策略：
 * - DAG：生成拓扑有序的任务 ID 列表，每个任务仅依赖列表中更早的任务（保证无环）
 * - 有环图：在 DAG 基础上注入一条反向边（从早期任务依赖晚期任务），制造循环
 *
 * **Validates: Requirements R2.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PlanningLayer } from '../planning-layer.js';
import type { ExecutionPlanTask, ExecutionAgentID } from '../types.js';

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

function makePlanningLayer(): PlanningLayer {
  return new PlanningLayer({
    llmClient: {} as any,
    provider: 'openai',
    model: 'test',
    blackboard: {} as any,
  });
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

/**
 * Arbitrary for a task graph that contains at least one cycle.
 *
 * Strategy: generate a valid DAG with at least 2 tasks, then inject a
 * back-edge from an earlier task to a later task (making the earlier task
 * depend on the later one), which creates a cycle.
 */
const cyclicTasksArb: fc.Arbitrary<ExecutionPlanTask[]> = fc
  .integer({ min: 2, max: 10 })
  .chain((n) =>
    fc.tuple(
      fc.array(agentIdArb, { minLength: n, maxLength: n }),
      // Pick two distinct indices where i < j, then add dep task-i -> task-j
      fc.integer({ min: 0, max: n - 2 }), // earlier index
      fc.nat({ max: n - 2 }),              // offset for later index
    ).map(([agentIds, earlierIdx, offset]) => {
      const laterIdx = Math.min(earlierIdx + 1 + offset, n - 1);

      const tasks: ExecutionPlanTask[] = [];
      for (let i = 0; i < n; i++) {
        const deps: string[] = [];
        // Normal forward dependency: each task depends on the previous one
        if (i > 0) {
          deps.push(`task-${i - 1}`);
        }
        tasks.push({
          id: `task-${i}`,
          agentId: agentIds[i],
          goal: `Goal for task-${i}`,
          dependsOn: deps,
          tools: ['write'],
        });
      }

      // Inject back-edge: make the earlier task also depend on the later task
      // This creates a cycle: earlierIdx -> ... -> laterIdx -> earlierIdx
      if (!tasks[earlierIdx].dependsOn.includes(`task-${laterIdx}`)) {
        tasks[earlierIdx].dependsOn.push(`task-${laterIdx}`);
      }

      return tasks;
    }),
  );

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('P6: Execution plan is a DAG (no cycles)', () => {
  const layer = makePlanningLayer();

  it('detectCycle returns { hasCycle: false } for any valid DAG', () => {
    fc.assert(
      fc.property(dagTasksArb, (tasks) => {
        const result = layer.detectCycle(tasks);
        expect(result.hasCycle).toBe(false);
        expect(result.cycleTaskIds).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('detectCycle returns { hasCycle: true } for any graph with a cycle', () => {
    fc.assert(
      fc.property(cyclicTasksArb, (tasks) => {
        const result = layer.detectCycle(tasks);
        expect(result.hasCycle).toBe(true);
        expect(result.cycleTaskIds).toBeDefined();
        expect(result.cycleTaskIds!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
