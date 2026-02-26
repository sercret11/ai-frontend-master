import type {
  Decision,
  ExecutionPlan,
  ExecutionTask,
  Reflection,
  ReplanDiagnosticBundle,
} from './types';

export interface IterationControllerInput {
  plan: ExecutionPlan;
  reflection: Reflection;
  currentIteration: number;
  currentReplanDepth?: number;
  maxReplanDepth?: number;
}

const BRAINSTORM_TRIGGER_ISSUE_CODES = new Set([
  'LOW_INTERACTION_COMPLEXITY',
  'MISSING_DATA_SURFACE',
  'MISSING_FORM_FLOW',
  'MISSING_STATE_MANAGEMENT',
  'INSUFFICIENT_VIEW_COVERAGE',
  'NO_INCREMENTAL_FILE_CHANGES',
]);

function shouldInjectBrainstormRepairTask(reflection: Reflection): boolean {
  return reflection.issues.some(
    issue => issue.severity === 'error' && BRAINSTORM_TRIGGER_ISSUE_CODES.has(issue.code)
  );
}

function createRepairTasks(
  reflection: Reflection,
  iteration: number,
  fallbackDependency?: string
): ExecutionTask[] {
  const repairTargets = reflection.issues.filter(issue => issue.severity === 'error');
  const taskCount = repairTargets.length > 0 ? repairTargets.length : 1;
  const dependencies = fallbackDependency ? [fallbackDependency] : [];
  const tasks: ExecutionTask[] = [];

  if (shouldInjectBrainstormRepairTask(reflection)) {
    tasks.push({
      id: `task-repair-${iteration + 1}-1`,
      phase: 'repair',
      name: 'repair-requirement-brainstorm',
      description:
        'Run a requirement-brainstorm pass first: infer missing capabilities, map interaction matrix, then apply concrete file mutations',
      agent: 'RepairAgent',
      mode: 'serial',
      dependencies,
      priority: 100,
      timeoutMs: 90_000,
      retryLimit: 1,
      metadata: {
        source: 'reflection',
        issueCode: 'BRAINSTORM_REQUIREMENT_GAP',
      },
    });
  }

  const baseTasks = Array.from({ length: taskCount }).map((_, index) => {
    const target = repairTargets[index];
    const sequence = tasks.length + index + 1;
    const task: ExecutionTask = {
      id: `task-repair-${iteration + 1}-${sequence}`,
      phase: 'repair',
      name: target?.taskId ? `repair-${target.taskId}` : 'repair-generic',
      description:
        target?.message || 'Apply targeted fixes generated from reflection evaluator feedback',
      agent: 'RepairAgent',
      mode: 'serial',
      dependencies,
      priority: 100 - index,
      timeoutMs: 90_000,
      retryLimit: 1,
      metadata: {
        source: 'reflection',
        issueCode: target?.code,
        taskId: target?.taskId,
      },
    };
    return task;
  });

  return [...tasks, ...baseTasks];
}

function buildReplanDiagnosticBundle(input: {
  reflection: Reflection;
  iteration: number;
  replanDepth: number;
  maxReplanDepth: number;
  reason: string;
}): ReplanDiagnosticBundle {
  return {
    createdAt: Date.now(),
    iteration: input.iteration,
    replanDepth: input.replanDepth,
    maxReplanDepth: input.maxReplanDepth,
    reason: input.reason,
    reflectionSummary: input.reflection.summary,
    issues: input.reflection.issues,
  };
}

/**
 * 根据反思结果决定是否继续迭代
 */
export function decideIteration(input: IterationControllerInput): Decision {
  const maxIterations = input.plan.maxIterations;
  const iteration = input.currentIteration;
  const maxIterationsReached = iteration >= maxIterations;
  const maxReplanDepth =
    input.maxReplanDepth ?? input.plan.replanPolicy?.maxReplanDepth ?? 2;
  const currentReplanDepth = Math.max(0, input.currentReplanDepth ?? 0);

  if (!input.reflection.shouldIterate) {
    return {
      decision: 'accept',
      reason: input.reflection.summary,
      iteration,
      maxIterationsReached: false,
      nextTasks: [],
      replanDepth: currentReplanDepth,
      maxReplanDepth,
      escalated: false,
    };
  }

  if (maxIterationsReached) {
    return {
      decision: 'abort',
      reason: `Reached max iteration limit (${maxIterations})`,
      iteration,
      maxIterationsReached: true,
      nextTasks: [],
      replanDepth: currentReplanDepth,
      maxReplanDepth,
      escalated: false,
      escalationReason: `max_iterations=${maxIterations}`,
    };
  }

  if (currentReplanDepth >= maxReplanDepth) {
    const escalationReason =
      `Replan depth exceeded: ${currentReplanDepth}/${maxReplanDepth}. ` +
      'Switch to MCP-guided repair with diagnostic bundle.';
    return {
      decision: 'abort',
      reason: escalationReason,
      iteration,
      maxIterationsReached: false,
      nextTasks: [],
      replanDepth: currentReplanDepth,
      maxReplanDepth,
      escalated: true,
      escalationReason,
      diagnosticBundle: buildReplanDiagnosticBundle({
        reflection: input.reflection,
        iteration,
        replanDepth: currentReplanDepth,
        maxReplanDepth,
        reason: escalationReason,
      }),
    };
  }

  const fallbackDependency = input.plan.tasks[input.plan.tasks.length - 1]?.id;
  return {
    decision: 'iterate',
    reason: input.reflection.summary,
    iteration,
    maxIterationsReached: false,
    nextTasks: createRepairTasks(input.reflection, iteration, fallbackDependency),
    replanDepth: currentReplanDepth + 1,
    maxReplanDepth,
    escalated: false,
  };
}
