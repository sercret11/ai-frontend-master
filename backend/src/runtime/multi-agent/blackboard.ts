import type {
  BlackboardSnapshot,
  ConflictRecord,
  MultiAgentTask,
  PatchIntent,
  QualityGateState,
} from './types';
import type { SessionDocument } from '../../analysis/types';
import type { ExecutionPlan } from '../../planning/types';

export class MultiAgentBlackboard {
  private readonly tasks = new Map<string, MultiAgentTask>();
  private readonly patchIntents = new Map<string, PatchIntent>();
  private readonly conflicts = new Map<string, ConflictRecord>();
  private readonly qualityGates = new Map<string, QualityGateState>();
  private generatedComponents: string[] = [];
  private readonly failedTasks = new Map<string, string>();
  private sessionDocuments: SessionDocument[] = [];
  private executionPlan: ExecutionPlan | null = null;

  setTasks(tasks: MultiAgentTask[]): void {
    this.tasks.clear();
    tasks.forEach(task => this.tasks.set(task.id, task));
  }

  addPatchIntents(intents: PatchIntent[]): void {
    intents.forEach(intent => {
      this.patchIntents.set(intent.id, intent);
    });
  }

  addConflict(conflict: ConflictRecord): void {
    this.conflicts.set(conflict.id, conflict);
  }

  resolveConflict(conflictId: string): void {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) return;
    this.conflicts.set(conflictId, { ...conflict, status: 'resolved' });
  }

  upsertQualityGate(gate: QualityGateState): void {
    this.qualityGates.set(gate.gate, gate);
  }

  addGeneratedComponents(components: string[]): void {
    this.generatedComponents.push(...components);
  }

  getGeneratedComponents(): string[] {
    return [...this.generatedComponents];
  }

  addFailedTask(taskId: string, error: string): void {
    this.failedTasks.set(taskId, error);
  }

  getFailedTasks(): Array<{ taskId: string; error: string }> {
    return [...this.failedTasks.entries()].map(([taskId, error]) => ({ taskId, error }));
  }

  setSessionDocuments(docs: SessionDocument[]): void {
    this.sessionDocuments = [...docs];
  }

  getSessionDocuments(): SessionDocument[] {
    return [...this.sessionDocuments];
  }

  setExecutionPlan(plan: ExecutionPlan): void {
    this.executionPlan = plan;
  }

  getExecutionPlan(): ExecutionPlan | null {
    return this.executionPlan;
  }

  snapshot(): BlackboardSnapshot {
    return {
      tasks: [...this.tasks.values()],
      patchIntents: [...this.patchIntents.values()],
      conflicts: [...this.conflicts.values()],
      qualityGates: [...this.qualityGates.values()],
    };
  }
}

