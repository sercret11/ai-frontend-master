import type { AgentRuntimeID } from '@ai-frontend/shared-types';
import { SessionManager } from '../../session/manager';
import { FileStorage } from '../../storage/file-storage';
import { getRuntimeAgent } from '../../agents/runtime';
import { MultiAgentBlackboard } from './blackboard';
import { MultiAgentEventBus } from './event-bus';
import { mergePatchIntents } from './patch-crdt';
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  ConflictRecord,
  MultiAgentKernelInput,
  MultiAgentTask,
  PatchIntent,
  QualityGateState,
} from './types';

interface TaskRunResult {
  task: MultiAgentTask;
  result: AgentExecutionResult;
}

const MULTI_AGENT_TASKS: MultiAgentTask[] = [
  {
    id: 'task-planner',
    title: 'Planning',
    agentId: 'planner-agent',
    wave: 1,
    dependsOn: [],
    goal: 'decompose request into an executable graph',
  },
  {
    id: 'task-architect',
    title: 'Architecture Baseline',
    agentId: 'architect-agent',
    wave: 2,
    dependsOn: ['task-planner'],
    goal: 'stabilize architecture boundaries and contracts',
  },
  {
    id: 'task-research',
    title: 'Research Context',
    agentId: 'research-agent',
    wave: 3,
    dependsOn: ['task-architect'],
    goal: 'prepare framework and dependency context',
  },
  {
    id: 'task-page',
    title: 'Page Build',
    agentId: 'page-agent',
    wave: 3,
    dependsOn: ['task-architect'],
    goal: 'implement page-level structure',
  },
  {
    id: 'task-interaction',
    title: 'Interaction Build',
    agentId: 'interaction-agent',
    wave: 3,
    dependsOn: ['task-architect'],
    goal: 'implement interaction flow and UX state transitions',
  },
  {
    id: 'task-state',
    title: 'State Build',
    agentId: 'state-agent',
    wave: 3,
    dependsOn: ['task-architect'],
    goal: 'implement store and state contract',
  },
  {
    id: 'task-quality',
    title: 'Quality Gate',
    agentId: 'quality-agent',
    wave: 4,
    dependsOn: ['task-research', 'task-page', 'task-interaction', 'task-state'],
    goal: 'evaluate delivery quality and output acceptance state',
  },
];

export class MultiAgentKernel {
  private readonly eventBus = new MultiAgentEventBus();
  private readonly blackboard = new MultiAgentBlackboard();

  constructor(private readonly input: MultiAgentKernelInput) {
    this.blackboard.setTasks(MULTI_AGENT_TASKS);
  }

  private emit(event: Parameters<MultiAgentKernelInput['emitRuntimeEvent']>[0]) {
    const runtimeEvent = this.input.emitRuntimeEvent(event);
    this.eventBus.publish(runtimeEvent);
    return runtimeEvent;
  }

  private createAgentContext(task: MultiAgentTask): AgentExecutionContext {
    return {
      sessionId: this.input.sessionId,
      runId: this.input.runId,
      userMessage: this.input.userMessage,
      task,
      routeDecision: this.input.routeDecision,
      modelProvider: this.input.modelProvider,
      modelId: this.input.modelId,
      platform: this.input.platform,
      techStack: this.input.techStack,
      emitRuntimeEvent: this.input.emitRuntimeEvent,
      abortSignal: this.input.abortSignal,
    };
  }

  private async runTask(task: MultiAgentTask): Promise<TaskRunResult> {
    const waveId = `wave-${task.wave}`;
    this.emit({
      type: 'agent.task.started',
      agentId: task.agentId,
      taskId: task.id,
      waveId,
      title: task.title,
      goal: task.goal,
      displayHint: 'important',
    });

    try {
      const agent = getRuntimeAgent(task.agentId);
      const result = await agent.run(this.createAgentContext(task));
      this.emit({
        type: 'agent.task.completed',
        agentId: task.agentId,
        taskId: task.id,
        waveId,
        success: result.success,
        summary: result.summary,
        displayHint: 'summary',
      });
      return { task, result };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.emit({
        type: 'agent.task.blocked',
        agentId: task.agentId,
        taskId: task.id,
        waveId,
        reason,
        displayHint: 'important',
      });
      return {
        task,
        result: {
          success: false,
          summary: reason,
          assistantText: '',
          patchIntents: [],
          touchedFiles: [],
        },
      };
    }
  }

  private async runWave(wave: number): Promise<TaskRunResult[]> {
    const tasks = MULTI_AGENT_TASKS.filter(task => task.wave === wave);
    if (tasks.length === 0) {
      return [];
    }
    if (tasks.length === 1) {
      const [single] = tasks;
      if (!single) return [];
      return [await this.runTask(single)];
    }
    return Promise.all(tasks.map(task => this.runTask(task)));
  }

  private publishPatchBatch(wave: number, intents: PatchIntent[]): ConflictRecord[] {
    const waveId = `wave-${wave}`;
    const batch = mergePatchIntents(waveId, intents);
    this.emit({
      type: 'patch.batch.merged',
      waveId,
      patchBatchId: batch.id,
      patchCount: batch.merged.length,
      touchedFiles: batch.touchedFiles,
      displayHint: 'summary',
    });
    batch.conflicts.forEach(conflict => {
      this.blackboard.addConflict(conflict);
      this.emit({
        type: 'conflict.detected',
        waveId: conflict.waveId,
        conflictId: conflict.id,
        filePath: conflict.filePath,
        involvedAgents: conflict.intents.map(item => item.agentId),
        reason: conflict.reason,
        displayHint: 'important',
      });
    });
    return batch.conflicts;
  }

  private async resolveConflicts(conflicts: ConflictRecord[]): Promise<void> {
    for (const conflict of conflicts) {
      const architectTask: MultiAgentTask = {
        id: `task-resolve-${conflict.id}`,
        title: `Resolve ${conflict.filePath}`,
        agentId: 'architect-agent',
        wave: 99,
        dependsOn: [],
        goal: `resolve conflict for ${conflict.filePath}`,
      };
      const result = await this.runTask(architectTask);
      if (!result.result.success) {
        continue;
      }
      this.blackboard.resolveConflict(conflict.id);
      this.emit({
        type: 'conflict.resolved',
        waveId: conflict.waveId,
        conflictId: conflict.id,
        filePath: conflict.filePath,
        resolvedBy: 'architect-agent',
        resolution: 'merged',
        displayHint: 'summary',
      });
    }
  }

  private updateQualityGate(gate: QualityGateState): void {
    this.blackboard.upsertQualityGate(gate);
    this.emit({
      type: 'quality.gate.updated',
      gate: gate.gate,
      status: gate.status,
      score: gate.score,
      summary: gate.summary,
      displayHint: 'important',
    });
  }

  private shouldAbort(): boolean {
    return this.input.abortSignal.aborted;
  }

  async run(): Promise<void> {
    this.emit({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'plan',
      status: 'started',
      message: 'multi-agent kernel started',
      displayHint: 'important',
    });

    SessionManager.addUserMessage(this.input.sessionId, this.input.userMessage);

    const allIntents: PatchIntent[] = [];
    let totalSuccess = true;
    let wavesCompleted = 0;

    for (const wave of [1, 2, 3, 4]) {
      if (this.shouldAbort()) {
        break;
      }

      const results = await this.runWave(wave);
      wavesCompleted += 1;
      results.forEach(item => {
        totalSuccess = totalSuccess && item.result.success;
        allIntents.push(...item.result.patchIntents);
      });
      this.blackboard.addPatchIntents(allIntents);

      if (wave === 3) {
        const waveIntents = results.flatMap(item => item.result.patchIntents);
        const conflicts = this.publishPatchBatch(3, waveIntents);
        if (conflicts.length > 0) {
          await this.resolveConflicts(conflicts);
        }
      }
    }

    let filesCount = FileStorage.getAllFiles(this.input.sessionId).length;
    const qualityFailed = !totalSuccess || filesCount === 0;
    this.updateQualityGate({
      gate: 'delivery',
      status: qualityFailed ? 'failed' : 'passed',
      score: qualityFailed ? (filesCount === 0 ? 45 : 65) : 92,
      summary: qualityFailed
        ? filesCount === 0
          ? 'quality gate failed: no runtime artifacts emitted'
          : 'quality gate failed and needs repair'
        : 'quality gate passed with stable outputs',
    });

    if (qualityFailed && !this.shouldAbort()) {
      const repairTask: MultiAgentTask = {
        id: 'task-repair',
        title: 'Repair Pass',
        agentId: 'repair-agent',
        wave: 5,
        dependsOn: ['task-quality'],
        goal: 'repair failed quality gate',
      };
      const repairResult = await this.runTask(repairTask);
      filesCount = FileStorage.getAllFiles(this.input.sessionId).length;
      totalSuccess = repairResult.result.success && filesCount > 0;
      this.updateQualityGate({
        gate: 'delivery',
        status: totalSuccess ? 'passed' : 'failed',
        score: totalSuccess ? 88 : 60,
        summary: totalSuccess
          ? 'quality gate recovered after repair pass'
          : 'quality gate still failing after repair pass',
      });
    }

    const finalFilesCount = FileStorage.getAllFiles(this.input.sessionId).length;
    const finalSuccess = totalSuccess && finalFilesCount > 0;
    const terminationReason = this.shouldAbort()
      ? 'user_abort'
      : finalSuccess
        ? 'goal_reached'
        : finalFilesCount === 0
          ? 'empty_model_output'
          : 'error';

    this.emit({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'publish',
      status: finalSuccess ? 'completed' : 'failed',
      message: finalSuccess ? 'multi-agent kernel completed' : 'multi-agent kernel finished with failures',
      displayHint: 'summary',
    });

    this.emit({
      type: 'run.completed',
      success: finalSuccess,
      filesCount: finalFilesCount,
      terminationReason,
      iterations: wavesCompleted,
    });
  }

  getEventLog() {
    return this.eventBus.list();
  }

  getBlackboardSnapshot() {
    return this.blackboard.snapshot();
  }
}

export function createMultiAgentTaskMap(tasks: MultiAgentTask[]): Map<AgentRuntimeID, MultiAgentTask[]> {
  const map = new Map<AgentRuntimeID, MultiAgentTask[]>();
  tasks.forEach(task => {
    const list = map.get(task.agentId) || [];
    list.push(task);
    map.set(task.agentId, list);
  });
  return map;
}
