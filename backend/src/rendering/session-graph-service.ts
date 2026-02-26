import type {
  AckPatchResult,
  AssemblyPatch,
  AssemblySessionSnapshot,
  BeginAssembleOptions,
  BeginAssembleResult,
  RollbackPatchResult,
} from './types';

interface AssemblySessionState {
  sessionId: string;
  runId: string | null;
  revision: number;
  acknowledgedRevision: number;
  executor: string;
  baseGraph: AssemblySessionSnapshot['graph'];
  graph: AssemblySessionSnapshot['graph'];
  patches: AssemblyPatch[];
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_EXECUTOR = 'memory';
const MAX_PATCH_HISTORY = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function createDefaultGraph(): AssemblySessionSnapshot['graph'] {
  return {
    nodes: [],
    edges: [],
  };
}

export class AssemblySessionGraphService {
  private readonly sessions = new Map<string, AssemblySessionState>();
  private readonly latestRunBySession = new Map<string, string>();

  public ensureSession(sessionId: string, runId?: string): AssemblySessionSnapshot {
    const state = this.getOrCreateState(sessionId, runId);
    return this.toSnapshot(state);
  }

  public beginAssemble(sessionId: string, options: BeginAssembleOptions): BeginAssembleResult {
    const state = this.getOrCreateState(sessionId, options.runId, true);
    const now = Date.now();
    state.runId = options.runId;
    this.latestRunBySession.set(sessionId, options.runId);

    let executorSwitch: BeginAssembleResult['executorSwitch'];
    if (options.executor && options.executor !== state.executor) {
      executorSwitch = { from: state.executor, to: options.executor };
      state.executor = options.executor;
    }

    if (options.graph) {
      const merged = this.mergeGraph(state.baseGraph, options.graph);
      state.baseGraph = merged;
      state.graph = merged;
      state.patches = [];
      state.revision = 0;
      state.acknowledgedRevision = 0;
    }

    state.updatedAt = now;

    return {
      snapshot: this.toSnapshot(state),
      executorSwitch,
    };
  }

  public appendPatch(
    sessionId: string,
    patch: AssemblyPatch['patch'],
    patchId?: string,
    runId?: string
  ): AssemblyPatch | null {
    const state = this.getStateForRead(sessionId, runId);
    if (!state) {
      return null;
    }

    const now = Date.now();
    const revision = state.revision + 1;
    const normalizedPatch = cloneValue(patch);
    const resolvedPatchId =
      typeof patchId === 'string' && patchId.trim()
        ? patchId.trim()
        : `patch-${revision}-${Math.random().toString(36).slice(2, 8)}`;

    state.revision = revision;
    const patchRecord: AssemblyPatch = {
      id: resolvedPatchId,
      revision,
      patch: normalizedPatch,
      createdAt: now,
    };
    state.patches.push(patchRecord);

    if (state.patches.length > MAX_PATCH_HISTORY) {
      state.patches.splice(0, state.patches.length - MAX_PATCH_HISTORY);
    }

    state.graph = this.applyPatchToGraph(state.graph, normalizedPatch);
    state.updatedAt = now;

    return cloneValue(patchRecord);
  }

  public ackPatch(sessionId: string, revision: number, patchId?: string, runId?: string): AckPatchResult {
    const state = this.getStateForRead(sessionId, runId);
    if (!state) {
      return {
        ok: false,
        reason: 'SESSION_NOT_FOUND',
        message: `assembly session not found: ${sessionId}`,
      };
    }

    if (runId !== undefined && runId !== state.runId) {
      return {
        ok: false,
        reason: 'RUN_ID_MISMATCH',
        message: `runId mismatch: expected ${state.runId ?? 'null'}, got ${runId}`,
        snapshot: this.toSnapshot(state),
      };
    }

    if (revision > state.revision) {
      return {
        ok: false,
        reason: 'REVISION_NOT_FOUND',
        message: `revision ${revision} is ahead of current revision ${state.revision}`,
        snapshot: this.toSnapshot(state),
      };
    }

    let targetPatch: AssemblyPatch | undefined;
    if (patchId) {
      targetPatch = state.patches.find(item => item.id === patchId);
      if (!targetPatch) {
        return {
          ok: false,
          reason: 'PATCH_NOT_FOUND',
          message: `patch not found: ${patchId}`,
          snapshot: this.toSnapshot(state),
        };
      }
      if (targetPatch.revision !== revision) {
        return {
          ok: false,
          reason: 'REVISION_NOT_FOUND',
          message: `patch ${patchId} belongs to revision ${targetPatch.revision}, not ${revision}`,
          snapshot: this.toSnapshot(state),
        };
      }
    }

    const now = Date.now();
    state.acknowledgedRevision = Math.max(state.acknowledgedRevision, revision);

    if (targetPatch) {
      targetPatch.acknowledgedAt = now;
    } else {
      for (const item of state.patches) {
        if (item.revision <= state.acknowledgedRevision && item.acknowledgedAt === undefined) {
          item.acknowledgedAt = now;
        }
      }
    }

    state.updatedAt = now;

    return {
      ok: true,
      snapshot: this.toSnapshot(state),
      acknowledgedPatchId: targetPatch?.id,
    };
  }

  public getSnapshot(sessionId: string, runId?: string): AssemblySessionSnapshot | null {
    const state = this.getStateForRead(sessionId, runId);
    if (!state) {
      return null;
    }
    return this.toSnapshot(state);
  }

  public rollbackPatch(
    sessionId: string,
    targetRevision: number,
    runId?: string
  ): RollbackPatchResult {
    const state = this.getStateForRead(sessionId, runId);
    if (!state) {
      return {
        ok: false,
        reason: 'SESSION_NOT_FOUND',
        message: `assembly session not found: ${sessionId}`,
      };
    }

    if (runId !== undefined && runId !== state.runId) {
      return {
        ok: false,
        reason: 'RUN_ID_MISMATCH',
        message: `runId mismatch: expected ${state.runId ?? 'null'}, got ${runId}`,
        snapshot: this.toSnapshot(state),
      };
    }

    if (targetRevision < 0 || targetRevision > state.revision) {
      return {
        ok: false,
        reason: 'REVISION_NOT_FOUND',
        message: `target revision ${targetRevision} is out of range 0..${state.revision}`,
        snapshot: this.toSnapshot(state),
      };
    }

    const previousRevision = state.revision;
    if (targetRevision === previousRevision) {
      return {
        ok: true,
        snapshot: this.toSnapshot(state),
        rolledBackFrom: previousRevision,
        rolledBackTo: targetRevision,
        removedPatchCount: 0,
      };
    }

    const retained = state.patches.filter(item => item.revision <= targetRevision);
    const removedPatchCount = state.patches.length - retained.length;
    state.patches = retained;
    state.revision = targetRevision;
    state.acknowledgedRevision = Math.min(state.acknowledgedRevision, targetRevision);
    state.graph = this.rebuildGraphFromBase(state.baseGraph, state.patches);
    state.updatedAt = Date.now();

    return {
      ok: true,
      snapshot: this.toSnapshot(state),
      rolledBackFrom: previousRevision,
      rolledBackTo: targetRevision,
      removedPatchCount,
    };
  }

  private getStateKey(sessionId: string, runId: string): string {
    return `${sessionId}::${runId}`;
  }

  private resolveRunId(sessionId: string, runId?: string): string {
    if (typeof runId === 'string' && runId.trim()) {
      return runId;
    }
    const latestRun = this.latestRunBySession.get(sessionId);
    return latestRun || 'default';
  }

  private getStateForRead(sessionId: string, runId?: string): AssemblySessionState | null {
    const resolvedRunId = this.resolveRunId(sessionId, runId);
    return this.sessions.get(this.getStateKey(sessionId, resolvedRunId)) || null;
  }

  private getOrCreateState(
    sessionId: string,
    runId?: string,
    markAsLatest = false
  ): AssemblySessionState {
    const resolvedRunId = this.resolveRunId(sessionId, runId);
    const stateKey = this.getStateKey(sessionId, resolvedRunId);
    const existed = this.sessions.get(stateKey);
    if (existed) {
      if (markAsLatest) {
        this.latestRunBySession.set(sessionId, resolvedRunId);
      }
      return existed;
    }
    const now = Date.now();
    const state: AssemblySessionState = {
      sessionId,
      runId: resolvedRunId,
      revision: 0,
      acknowledgedRevision: 0,
      executor: DEFAULT_EXECUTOR,
      baseGraph: createDefaultGraph(),
      graph: createDefaultGraph(),
      patches: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(stateKey, state);
    if (markAsLatest || !this.latestRunBySession.has(sessionId)) {
      this.latestRunBySession.set(sessionId, resolvedRunId);
    }
    return state;
  }

  private toSnapshot(state: AssemblySessionState): AssemblySessionSnapshot {
    const pendingPatches = state.patches
      .filter(item => item.acknowledgedAt === undefined)
      .map(item => cloneValue(item));

    return {
      sessionId: state.sessionId,
      runId: state.runId,
      revision: state.revision,
      acknowledgedRevision: state.acknowledgedRevision,
      executor: state.executor,
      graph: cloneValue(state.graph),
      pendingPatches,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    };
  }

  private mergeGraph(
    currentGraph: AssemblySessionSnapshot['graph'],
    nextGraph: AssemblySessionSnapshot['graph']
  ): AssemblySessionSnapshot['graph'] {
    return {
      ...cloneValue(currentGraph),
      ...cloneValue(nextGraph),
    };
  }

  private applyPatchToGraph(
    currentGraph: AssemblySessionSnapshot['graph'],
    patch: AssemblyPatch['patch']
  ): AssemblySessionSnapshot['graph'] {
    const graphCandidate = patch.graph;
    if (isRecord(graphCandidate)) {
      return this.mergeGraph(currentGraph, graphCandidate);
    }

    const snapshotCandidate = patch.snapshot;
    if (isRecord(snapshotCandidate)) {
      return this.mergeGraph(currentGraph, snapshotCandidate);
    }

    const nextGraphCandidate = patch.nextGraph;
    if (isRecord(nextGraphCandidate)) {
      return this.mergeGraph(currentGraph, nextGraphCandidate);
    }

    const nextGraph = cloneValue(currentGraph);

    if (Array.isArray(patch.nodes)) {
      nextGraph.nodes = cloneValue(patch.nodes);
    }
    if (Array.isArray(patch.edges)) {
      nextGraph.edges = cloneValue(patch.edges);
    }
    if (Array.isArray(patch.commands)) {
      nextGraph.commands = cloneValue(patch.commands);
    }

    return nextGraph;
  }

  private rebuildGraphFromBase(
    baseGraph: AssemblySessionSnapshot['graph'],
    patches: AssemblyPatch[]
  ): AssemblySessionSnapshot['graph'] {
    let graph = cloneValue(baseGraph);
    const sorted = [...patches].sort((left, right) => left.revision - right.revision);
    for (const patch of sorted) {
      graph = this.applyPatchToGraph(graph, patch.patch);
    }
    return graph;
  }
}

export const assemblySessionGraphService = new AssemblySessionGraphService();
