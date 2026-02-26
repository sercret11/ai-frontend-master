import type { AssemblyPatch, AssemblySessionSnapshot } from '@ai-frontend/shared-types';

export type { AssemblyPatch, AssemblySessionSnapshot };

export interface BeginAssembleOptions {
  runId: string;
  graph?: AssemblySessionSnapshot['graph'];
  executor?: string;
}

export interface BeginAssembleResult {
  snapshot: AssemblySessionSnapshot;
  executorSwitch?: {
    from: string;
    to: string;
  };
}

export type AckPatchFailureReason =
  | 'SESSION_NOT_FOUND'
  | 'REVISION_NOT_FOUND'
  | 'PATCH_NOT_FOUND'
  | 'RUN_ID_MISMATCH';

export type AckPatchResult =
  | {
      ok: true;
      snapshot: AssemblySessionSnapshot;
      acknowledgedPatchId?: string;
    }
  | {
      ok: false;
      reason: AckPatchFailureReason;
      message: string;
      snapshot?: AssemblySessionSnapshot;
    };

export type RollbackPatchFailureReason =
  | 'SESSION_NOT_FOUND'
  | 'REVISION_NOT_FOUND'
  | 'RUN_ID_MISMATCH';

export type RollbackPatchResult =
  | {
      ok: true;
      snapshot: AssemblySessionSnapshot;
      rolledBackFrom: number;
      rolledBackTo: number;
      removedPatchCount: number;
    }
  | {
      ok: false;
      reason: RollbackPatchFailureReason;
      message: string;
      snapshot?: AssemblySessionSnapshot;
    };
