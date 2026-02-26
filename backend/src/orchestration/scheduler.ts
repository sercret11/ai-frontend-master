import type { ExecutionPlan, ExecutionSchedule, ExecutionTask, ScheduledTaskGroup } from './types';

interface TaskNode {
  task: ExecutionTask;
  indegree: number;
  dependents: string[];
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

/**
 * 根据依赖关系生成可执行调度波次
 */
export function createExecutionSchedule(plan: ExecutionPlan): ExecutionSchedule {
  const nodeMap = new Map<string, TaskNode>();
  const missingDependencyRefs: Array<{ taskId: string; dependencyId: string }> = [];

  for (const task of plan.tasks) {
    nodeMap.set(task.id, {
      task,
      indegree: 0,
      dependents: [],
    });
  }

  for (const task of plan.tasks) {
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

  const pending = new Set(plan.tasks.map(task => task.id));
  const groups: ScheduledTaskGroup[] = [];
  const orderedTaskIds: string[] = [];
  let wave = 0;
  let hasCycle = false;

  while (pending.size > 0) {
    const ready = stableTaskSort(
      [...pending]
        .map(taskId => nodeMap.get(taskId))
        .filter((node): node is TaskNode => Boolean(node && node.indegree === 0))
        .map(node => node.task)
    );

    if (ready.length === 0) {
      // 兜底：检测到环后按优先级串行退化，避免调度阻塞。
      hasCycle = true;
      const fallbackTask = stableTaskSort(
        [...pending]
          .map(taskId => nodeMap.get(taskId))
          .filter((node): node is TaskNode => Boolean(node))
          .map(node => node.task)
      )[0];

      if (!fallbackTask) break;

      wave += 1;
      groups.push({
        id: `group-${wave}`,
        mode: 'serial',
        taskIds: [fallbackTask.id],
        tasks: [fallbackTask],
        wave,
      });
      orderedTaskIds.push(fallbackTask.id);
      pending.delete(fallbackTask.id);
      continue;
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

  if (missingDependencyRefs.length > 0) {
    hasCycle = true;
  }

  return {
    groups,
    orderedTaskIds,
    hasCycle,
  };
}

