import type {
  BlackboardSnapshot,
  ConflictRecord,
  MultiAgentTask,
  PatchIntent,
  QualityGateState,
} from './types';

export class MultiAgentBlackboard {
  private readonly tasks = new Map<string, MultiAgentTask>();
  private readonly patchIntents = new Map<string, PatchIntent>();
  private readonly conflicts = new Map<string, ConflictRecord>();
  private readonly qualityGates = new Map<string, QualityGateState>();

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

  snapshot(): BlackboardSnapshot {
    return {
      tasks: [...this.tasks.values()],
      patchIntents: [...this.patchIntents.values()],
      conflicts: [...this.conflicts.values()],
      qualityGates: [...this.qualityGates.values()],
    };
  }
}

