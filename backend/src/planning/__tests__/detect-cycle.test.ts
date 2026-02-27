/**
 * Unit tests for PlanningLayer.detectCycle
 *
 * Tests Kahn's algorithm cycle detection on ExecutionPlanTask dependency graphs.
 * Covers: no cycle (DAG), simple cycle, self-cycle, complex DAG, empty input.
 *
 * 需求: R2.4
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionPlanTask } from '../types.js';
import { createExecutionSchedule } from '../../orchestration/scheduler.js';
import type { ExecutionPlan, ExecutionTask } from '../../orchestration/types.js';

// We need to access detectCycle which is a public method on PlanningLayer.
// Create a minimal instance just for testing the cycle detection logic.
import { PlanningLayer } from '../planning-layer.js';

function makePlanningLayer(): PlanningLayer {
  // detectCycle is a pure function on the task array, so we can pass
  // dummy dependencies — they won't be used.
  return new PlanningLayer({
    llmClient: {} as any,
    provider: 'openai',
    model: 'test',
    blackboard: {} as any,
  });
}

function task(id: string, dependsOn: string[] = []): ExecutionPlanTask {
  return {
    id,
    agentId: 'scaffold-agent',
    goal: `Task ${id}`,
    dependsOn,
    tools: ['write'],
  };
}

function scheduleTask(id: string, dependencies: string[] = []): ExecutionTask {
  return {
    id,
    phase: 'pages',
    name: `task-${id}`,
    description: `Task ${id}`,
    agent: 'PageAgent',
    mode: 'serial',
    dependencies,
    priority: 1,
    timeoutMs: 10_000,
    retryLimit: 0,
  };
}

function buildExecutionPlan(tasks: ExecutionTask[]): ExecutionPlan {
  return {
    id: `plan-${Date.now()}`,
    createdAt: Date.now(),
    userMessage: 'test',
    routeDecision: {} as ExecutionPlan['routeDecision'],
    maxIterations: 1,
    replanPolicy: { maxReplanDepth: 1 },
    tasks,
    metadata: {},
  };
}

describe('PlanningLayer.detectCycle', () => {
  const layer = makePlanningLayer();

  it('returns no cycle for empty task list', () => {
    const result = layer.detectCycle([]);
    expect(result.hasCycle).toBe(false);
    expect(result.cycleTaskIds).toBeUndefined();
  });

  it('returns no cycle for a single task with no dependencies', () => {
    const result = layer.detectCycle([task('a')]);
    expect(result.hasCycle).toBe(false);
  });

  it('returns no cycle for a valid DAG (linear chain)', () => {
    const tasks = [
      task('a'),
      task('b', ['a']),
      task('c', ['b']),
    ];
    const result = layer.detectCycle(tasks);
    expect(result.hasCycle).toBe(false);
  });

  it('returns no cycle for a valid DAG (diamond shape)', () => {
    //   a
    //  / \
    // b   c
    //  \ /
    //   d
    const tasks = [
      task('a'),
      task('b', ['a']),
      task('c', ['a']),
      task('d', ['b', 'c']),
    ];
    const result = layer.detectCycle(tasks);
    expect(result.hasCycle).toBe(false);
  });

  it('detects a self-cycle', () => {
    const tasks = [task('a', ['a'])];
    const result = layer.detectCycle(tasks);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleTaskIds).toContain('a');
  });

  it('detects a simple two-node cycle', () => {
    const tasks = [
      task('a', ['b']),
      task('b', ['a']),
    ];
    const result = layer.detectCycle(tasks);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleTaskIds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('detects a three-node cycle', () => {
    // a → b → c → a
    const tasks = [
      task('a', ['c']),
      task('b', ['a']),
      task('c', ['b']),
    ];
    const result = layer.detectCycle(tasks);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleTaskIds).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('detects a cycle in a larger graph with some acyclic nodes', () => {
    // x (no deps) → y → z → y (cycle between y and z)
    // x is not part of the cycle
    const tasks = [
      task('x'),
      task('y', ['x', 'z']),
      task('z', ['y']),
    ];
    const result = layer.detectCycle(tasks);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleTaskIds).toEqual(expect.arrayContaining(['y', 'z']));
    expect(result.cycleTaskIds).not.toContain('x');
  });

  it('returns no cycle for a typical execution plan pattern', () => {
    // Mimics the standard wave pattern from the spec
    const tasks = [
      task('scaffold-1'),
      task('page-1', ['scaffold-1']),
      task('state-1', ['scaffold-1']),
      task('style-1', ['scaffold-1']),
      task('interaction-1', ['page-1', 'state-1']),
      task('quality-1', ['page-1', 'state-1', 'style-1', 'interaction-1']),
      task('repair-1', ['quality-1']),
    ];
    const result = layer.detectCycle(tasks);
    expect(result.hasCycle).toBe(false);
  });
});

describe('createExecutionSchedule invariants', () => {
  it('fails fast when dependency reference is missing', () => {
    const plan = buildExecutionPlan([scheduleTask('a'), scheduleTask('b', ['missing-task'])]);

    expect(() => createExecutionSchedule(plan)).toThrow(/missing dependency references/i);
  });

  it('fails fast when cycle exists', () => {
    const plan = buildExecutionPlan([scheduleTask('a', ['b']), scheduleTask('b', ['a'])]);

    expect(() => createExecutionSchedule(plan)).toThrow(/cyclic dependencies/i);
  });

  it('rejects duplicate task ids before scheduling', () => {
    const plan = buildExecutionPlan([scheduleTask('dup'), scheduleTask('dup')]);

    expect(() => createExecutionSchedule(plan)).toThrow(/duplicate task IDs/i);
  });

  it('normalizes dependency contract from dependsOn/dependencies', () => {
    const taskUsingDependsOn = {
      ...scheduleTask('b'),
      dependencies: [],
      dependsOn: ['a'],
    } as ExecutionTask & { dependsOn: string[] };

    const plan = buildExecutionPlan([scheduleTask('a'), taskUsingDependsOn]);

    const schedule = createExecutionSchedule(plan);
    expect(schedule.orderedTaskIds).toEqual(['a', 'b']);
    expect(schedule.hasCycle).toBe(false);
  });
});
