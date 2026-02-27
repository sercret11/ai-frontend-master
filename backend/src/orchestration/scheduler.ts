import type { ExecutionPlan, ExecutionSchedule, ExecutionTask, ScheduledTaskGroup } from './types';

interface TaskNode {
  task: ExecutionTask;
  indegree: number;
  dependents: string[];
}

interface DependencySource {
  dependsOn?: unknown;
  dependencies?: unknown;
}

function normalizeTaskId(taskId: unknown): string {
  return String(taskId).trim();
}

export function normalizeTaskDependencies(task: DependencySource): string[] {
  const rawDependencies = [
    ...(Array.isArray(task.dependencies) ? task.dependencies : []),
    ...(Array.isArray(task.dependsOn) ? task.dependsOn : []),
  ];

  return Array.from(
    new Set(
      rawDependencies
        .map(String)
        .map(item => item.trim())
        .filter(Boolean),
    ),
  );
}

export function validateUniqueTaskIds<T extends { id: unknown }>(tasks: T[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const normalizedIds: string[] = [];

  for (const task of tasks) {
    const taskId = normalizeTaskId(task.id);
    if (!taskId) {
      throw new Error('Execution plan contains a task with an empty ID');
    }
    normalizedIds.push(taskId);
    if (seen.has(taskId)) {
      duplicates.add(taskId);
      continue;
    }
    seen.add(taskId);
  }

  if (duplicates.size > 0) {
    throw new Error(`Execution plan contains duplicate task IDs: ${Array.from(duplicates).join(', ')}`);
  }

  return normalizedIds;
}

function stableTaskSort(tasks: ExecutionTask[]): ExecutionTask[] {
  return [...tasks].sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return a.id.localeCompare(b.id);
  });
}

function selectBatch(ready: ExecutionTask[]): ExecutionTask[] {
  const sorted = stableTaskSort(ready);

  const serial = sorted.filter(task => task.mode === 'serial');
  if (serial.length > 0) {
    return [serial[0]];
  }

  const pipeline = sorted.filter(task => task.mode === 'pipeline');
  if (pipeline.length > 0) {
    return [pipeline[0]];
  }

  return sorted.filter(task => task.mode === 'parallel');
}

export function createExecutionSchedule(plan: ExecutionPlan): ExecutionSchedule {
  const normalizedTaskIds = validateUniqueTaskIds(plan.tasks);
  const normalizedTasks = plan.tasks.map((task, index) => ({
    ...task,
    id: normalizedTaskIds[index],
    dependencies: normalizeTaskDependencies(task),
  }));

  const nodeMap = new Map<string, TaskNode>();
  const missingDependencyRefs: Array<{ taskId: string; dependencyId: string }> = [];

  for (const task of normalizedTasks) {
    nodeMap.set(task.id, {
      task,
      indegree: 0,
      dependents: [],
    });
  }

  for (const task of normalizedTasks) {
    const node = nodeMap.get(task.id);
    if (!node) continue;

    for (const dependencyId of task.dependencies) {
      const dependencyNode = nodeMap.get(dependencyId);
      if (!dependencyNode) {
        missingDependencyRefs.push({ taskId: task.id, dependencyId });
        continue;
      }
      node.indegree += 1;
      dependencyNode.dependents.push(task.id);
    }
  }

  if (missingDependencyRefs.length > 0) {
    const details = missingDependencyRefs
      .map(ref => `${ref.taskId}->${ref.dependencyId}`)
      .join(', ');
    throw new Error(`Execution plan contains missing dependency references: ${details}`);
  }

  const pending = new Set(normalizedTasks.map(task => task.id));
  const groups: ScheduledTaskGroup[] = [];
  const orderedTaskIds: string[] = [];
  let wave = 0;

  while (pending.size > 0) {
    const ready = stableTaskSort(
      [...pending]
        .map(taskId => nodeMap.get(taskId))
        .filter((node): node is TaskNode => Boolean(node && node.indegree === 0))
        .map(node => node.task),
    );

    if (ready.length === 0) {
      const cycleTaskIds = stableTaskSort(
        [...pending]
          .map(taskId => nodeMap.get(taskId))
          .filter((node): node is TaskNode => Boolean(node))
          .map(node => node.task),
      ).map(task => task.id);
      const details = cycleTaskIds.join(', ') || 'unknown';
      throw new Error(`Execution plan contains cyclic dependencies: ${details}`);
    }

    const batch = selectBatch(ready);
    const mode = batch[0]?.mode ?? 'serial';
    wave += 1;

    groups.push({
      id: `group-${wave}`,
      mode,
      taskIds: batch.map(task => task.id),
      tasks: batch,
      wave,
    });

    for (const task of batch) {
      if (!pending.has(task.id)) continue;
      pending.delete(task.id);
      orderedTaskIds.push(task.id);

      const node = nodeMap.get(task.id);
      if (!node) continue;

      for (const dependentId of node.dependents) {
        const dependentNode = nodeMap.get(dependentId);
        if (!dependentNode) continue;
        dependentNode.indegree = Math.max(0, dependentNode.indegree - 1);
      }
    }
  }

  return {
    groups,
    orderedTaskIds,
    hasCycle: false,
  };
}
