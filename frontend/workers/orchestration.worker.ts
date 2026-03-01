import type { RuntimeEvent } from '@ai-frontend/shared-types';
import { initOxcWasm } from '../lib/sandpack/oxc-runtime';
import type { PatchBatchEnvelope, SandpackPatch } from '../lib/sandpack/types';

interface DependencyChecklistItem {
  framework: string;
  packageName: string;
  topics: string[];
  projectType?: 'next-js' | 'react-vite' | 'react-native' | 'uniapp';
}

interface ResearchDigestPayload {
  generatedAt: number;
  summary: string;
  dependencies: DependencyChecklistItem[];
  apiSignatures: Array<Record<string, unknown>>;
  snippets: Array<Record<string, unknown>>;
  versionHints: Array<Record<string, unknown>>;
  sourceRefs: Array<Record<string, unknown>>;
}

type WorkerInput =
  | {
      type: 'RUN_START';
      runId: string;
    }
  | {
      type: 'RUNTIME_EVENT';
      event: RuntimeEvent;
    }
  | {
      type: 'RUN_STOP';
      runId?: string;
    }
  | {
      type: 'RESEARCH_REQUEST';
      endpoint: string;
      dependencies: DependencyChecklistItem[];
      runId?: string;
    };

type WorkerOutput =
  | {
      type: 'PHASE_UPDATE';
      phase: string;
      iteration?: number;
      runId?: string;
    }
  | {
      type: 'PATCH_BATCH_READY';
      envelope: PatchBatchEnvelope;
    }
  | {
      type: 'BUDGET_UPDATE';
      used?: number;
      limit?: number;
      remaining?: number;
      unit?: string;
    }
  | {
      type: 'RESEARCH_DIGEST';
      digest: ResearchDigestPayload;
    }
  | {
      type: 'RESEARCH_FAILED';
      error: string;
    }
  | {
      type: 'PARSER_READY';
      cached: boolean;
      durationMs: number;
    }
  | {
      type: 'PARSER_FAILED';
      error: string;
    };

interface WorkerState {
  activeRunId: string | null;
  lastRevision: number;
  parserReady: boolean;
  parserInitStarted: boolean;
  parserBypassed: boolean;
  pendingPatches: PatchBatchEnvelope[];
}

const state: WorkerState = {
  activeRunId: null,
  lastRevision: 0,
  parserReady: false,
  parserInitStarted: false,
  parserBypassed: false,
  pendingPatches: [],
};

function post(output: WorkerOutput): void {
  self.postMessage(output);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isResearchDigest(value: unknown): value is ResearchDigestPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['generatedAt'] === 'number' &&
    typeof value['summary'] === 'string' &&
    Array.isArray(value['dependencies']) &&
    Array.isArray(value['apiSignatures']) &&
    Array.isArray(value['snippets']) &&
    Array.isArray(value['versionHints']) &&
    Array.isArray(value['sourceRefs'])
  );
}

function flushPendingPatches(): void {
  if (!state.parserReady && !state.parserBypassed) {
    return;
  }

  state.pendingPatches.sort((left, right) => left.revision - right.revision);
  while (state.pendingPatches.length > 0) {
    const envelope = state.pendingPatches.shift();
    if (!envelope) {
      continue;
    }
    if (envelope.revision <= state.lastRevision) {
      continue;
    }
    state.lastRevision = envelope.revision;
    post({
      type: 'PATCH_BATCH_READY',
      envelope,
    });
  }
}

async function ensureParserReady(): Promise<void> {
  if (state.parserReady || state.parserInitStarted || state.parserBypassed) {
    return;
  }
  state.parserInitStarted = true;

  try {
    const result = await initOxcWasm();
    state.parserReady = true;
    post({
      type: 'PARSER_READY',
      cached: result.cached,
      durationMs: result.durationMs,
    });
    flushPendingPatches();
  } catch (error) {
    state.parserReady = false;
    state.parserInitStarted = false;
    state.parserBypassed = true;
    post({
      type: 'PARSER_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
    flushPendingPatches();
  }
}

function toPatchBatch(event: RuntimeEvent): PatchBatchEnvelope | null {
  if (event.type !== 'assembly.patch') {
    return null;
  }

  if (!isRecord(event.patch)) {
    return null;
  }

  const patchRecord = event.patch as Record<string, unknown>;
  const patchesRaw = patchRecord['patches'];
  if (!Array.isArray(patchesRaw)) {
    return null;
  }

  const patches = patchesRaw.filter(
    patch =>
      isRecord(patch) &&
      patch['kind'] === 'ast_replace_v2' &&
      typeof patch['filePath'] === 'string'
  ) as SandpackPatch[];

  if (patches.length === 0) {
    return null;
  }

  const touchedFiles = Array.isArray(patchRecord['touchedFiles'])
    ? patchRecord['touchedFiles'].filter(item => typeof item === 'string')
    : patches.map(item => item.filePath);

  return {
    runId: event.runId,
    patchId: event.patchId,
    revision: event.revision,
    atomicGroupId:
      typeof patchRecord['atomicGroupId'] === 'string'
        ? (patchRecord['atomicGroupId'] as string)
        : `${event.runId}:${event.revision}`,
    dependsOnRevision:
      typeof patchRecord['dependsOnRevision'] === 'number'
        ? (patchRecord['dependsOnRevision'] as number)
        : undefined,
    touchedFiles,
    checksum:
      typeof patchRecord['checksum'] === 'string' ? (patchRecord['checksum'] as string) : undefined,
    validationHints: isRecord(patchRecord['validationHints'])
      ? {
          requiresDependencyReload: Boolean(
            (patchRecord['validationHints'] as Record<string, unknown>)['requiresDependencyReload']
          ),
        }
      : undefined,
    patches,
  };
}

function handleRuntimeEvent(event: RuntimeEvent): void {
  if (state.activeRunId && event.runId !== state.activeRunId) {
    return;
  }

  switch (event.type) {
    case 'agent.task.started':
      post({
        type: 'PHASE_UPDATE',
        phase: `${event.agentId}:started`,
        runId: event.runId,
      });
      return;
    case 'agent.task.progress':
      post({
        type: 'PHASE_UPDATE',
        phase: `${event.agentId}:progress`,
        runId: event.runId,
      });
      return;
    case 'agent.task.completed':
      post({
        type: 'PHASE_UPDATE',
        phase: `${event.agentId}:${event.success ? 'completed' : 'failed'}`,
        runId: event.runId,
      });
      return;
    case 'agent.task.blocked':
      post({
        type: 'PHASE_UPDATE',
        phase: `${event.agentId}:blocked`,
        runId: event.runId,
      });
      return;
    case 'quality.gate.updated':
      post({
        type: 'PHASE_UPDATE',
        phase: `quality:${event.status}`,
        runId: event.runId,
      });
      return;
    case 'conflict.detected':
      post({
        type: 'PHASE_UPDATE',
        phase: `conflict:${event.filePath}`,
        runId: event.runId,
      });
      return;
    case 'conflict.resolved':
      post({
        type: 'PHASE_UPDATE',
        phase: `conflict-resolved:${event.filePath}`,
        runId: event.runId,
      });
      return;
    case 'autonomy.iteration':
      post({
        type: 'PHASE_UPDATE',
        phase: event.stage || 'iteration',
        iteration: event.iteration,
        runId: event.runId,
      });
      return;
    case 'autonomy.budget':
      post({
        type: 'BUDGET_UPDATE',
        used: event.used,
        limit: event.limit,
        remaining: event.remaining,
        unit: event.unit,
      });
      return;
    case 'assembly.patch': {
      const envelope = toPatchBatch(event);
      if (!envelope) {
        return;
      }

      if (!state.parserReady && !state.parserBypassed) {
        state.pendingPatches.push(envelope);
        void ensureParserReady();
        return;
      }

      if (envelope.revision <= state.lastRevision) {
        return;
      }
      state.lastRevision = envelope.revision;
      post({
        type: 'PATCH_BATCH_READY',
        envelope,
      });
      return;
    }
    default:
      return;
  }
}

async function runContext7Research(payload: {
  endpoint: string;
  dependencies: DependencyChecklistItem[];
  runId?: string;
}): Promise<void> {
  if (state.activeRunId && payload.runId && payload.runId !== state.activeRunId) {
    return;
  }

  try {
    const response = await fetch(payload.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dependencies: payload.dependencies,
      }),
    });
    if (!response.ok) {
      throw new Error(`Context7 request failed with ${response.status}`);
    }

    const parsed = (await response.json()) as unknown;
    let digest: unknown = parsed;
    if (isRecord(parsed) && isRecord(parsed['digest'])) {
      digest = parsed['digest'];
    }
    if (!isResearchDigest(digest)) {
      throw new Error('Invalid Context7 digest payload');
    }

    post({
      type: 'RESEARCH_DIGEST',
      digest,
    });
  } catch (error) {
    post({
      type: 'RESEARCH_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

self.onmessage = (message: MessageEvent<WorkerInput>) => {
  const payload = message.data;
  switch (payload.type) {
    case 'RUN_START':
      state.activeRunId = payload.runId;
      state.lastRevision = 0;
      state.parserBypassed = false;
      state.pendingPatches = [];
      post({
        type: 'PHASE_UPDATE',
        phase: 'started',
        runId: payload.runId,
      });
      void ensureParserReady();
      return;
    case 'RUNTIME_EVENT':
      handleRuntimeEvent(payload.event);
      return;
    case 'RUN_STOP':
      if (!payload.runId || payload.runId === state.activeRunId) {
        state.activeRunId = null;
        state.lastRevision = 0;
        state.parserBypassed = false;
        state.pendingPatches = [];
        post({
          type: 'PHASE_UPDATE',
          phase: 'stopped',
        });
      }
      return;
    case 'RESEARCH_REQUEST':
      void runContext7Research(payload);
      return;
    default:
      return;
  }
};
