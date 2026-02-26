import { describe, expect, it } from 'vitest';
import { decideIteration } from './iteration-controller';
import type { ExecutionPlan, Reflection } from './types';

function buildPlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    id: 'plan-test',
    createdAt: Date.now(),
    userMessage: 'Implement dashboard',
    routeDecision: {
      agentId: 'frontend-implementer',
      mode: 'implementer',
      source: 'auto',
      confidence: 0.9,
    },
    maxIterations: 5,
    replanPolicy: {
      maxReplanDepth: 2,
    },
    tasks: [
      {
        id: 'task-quality-1',
        phase: 'quality',
        name: 'quality-pass',
        description: 'quality pass',
        agent: 'QualityAgent',
        mode: 'serial',
        dependencies: [],
        priority: 90,
        timeoutMs: 1000,
        retryLimit: 0,
      },
    ],
    ...overrides,
  };
}

function buildReflection(overrides: Partial<Reflection> = {}): Reflection {
  return {
    score: 62,
    demandMatch: 60,
    consistency: 60,
    codeQuality: 60,
    bestPractice: 60,
    shouldIterate: true,
    summary: 'Need one more repair iteration',
    issues: [
      {
        code: 'TS2322',
        message: 'Type mismatch',
        severity: 'error',
        taskId: 'task-quality-1',
      },
    ],
    ...overrides,
  };
}

describe('iteration-controller', () => {
  it('increments replan depth on iterate', () => {
    const decision = decideIteration({
      plan: buildPlan(),
      reflection: buildReflection(),
      currentIteration: 1,
      currentReplanDepth: 0,
      maxReplanDepth: 2,
    });

    expect(decision.decision).toBe('iterate');
    expect(decision.replanDepth).toBe(1);
    expect(decision.escalated).toBe(false);
    expect(decision.nextTasks.length).toBeGreaterThan(0);
  });

  it('adds brainstorm repair task when reflection indicates capability gap', () => {
    const decision = decideIteration({
      plan: buildPlan(),
      reflection: buildReflection({
        issues: [
          {
            code: 'LOW_INTERACTION_COMPLEXITY',
            message: 'Interaction coverage is too low',
            severity: 'error',
          },
        ],
      }),
      currentIteration: 1,
      currentReplanDepth: 0,
      maxReplanDepth: 2,
    });

    expect(decision.decision).toBe('iterate');
    expect(decision.nextTasks[0]?.name).toBe('repair-requirement-brainstorm');
    expect(decision.nextTasks[0]?.description).toContain('requirement-brainstorm');
  });

  it('aborts and escalates when replan depth reaches cap', () => {
    const decision = decideIteration({
      plan: buildPlan(),
      reflection: buildReflection(),
      currentIteration: 2,
      currentReplanDepth: 2,
      maxReplanDepth: 2,
    });

    expect(decision.decision).toBe('abort');
    expect(decision.escalated).toBe(true);
    expect(decision.maxIterationsReached).toBe(false);
    expect(decision.diagnosticBundle?.replanDepth).toBe(2);
  });

  it('accepts when reflection does not require iteration', () => {
    const decision = decideIteration({
      plan: buildPlan(),
      reflection: buildReflection({ shouldIterate: false, summary: 'all good' }),
      currentIteration: 1,
      currentReplanDepth: 1,
      maxReplanDepth: 2,
    });

    expect(decision.decision).toBe('accept');
    expect(decision.nextTasks).toEqual([]);
    expect(decision.replanDepth).toBe(1);
  });
});

