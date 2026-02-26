import {
  createDependencySignature,
  resolveDependencyMap,
} from './dependency-resolver';
import { applyAstReplacePatch } from './ast-surgery';
import { runSyntaxGate } from './syntax-gate';
import type {
  AstReplacePatchV2,
  PatchApplyFailure,
  PatchApplyResult,
  PatchApplySuccess,
  PatchBatchEnvelope,
  SandpackPatch,
} from './types';

function applySinglePatch(
  files: Record<string, string>,
  patch: SandpackPatch
): PatchApplyResult {
  const existing = files[patch.filePath];
  if (typeof existing !== 'string') {
    return {
      ok: false,
      error: {
        code: 'FILE_NOT_FOUND',
        filePath: patch.filePath,
        detail: 'target file does not exist in shadow VFS',
      },
    };
  }

  if (patch.kind === 'ast_replace_v2') {
    const replaced = applyAstReplacePatch(files, patch as AstReplacePatchV2);
    if (!replaced.ok) {
      return {
        ok: false,
        error: {
          code: replaced.code || 'AST_APPLY_FAILED',
          filePath: patch.filePath,
          detail: replaced.reason || 'ast_replace_v2 failed',
        },
      };
    }
    return {
      ok: true,
      value: {
        files: { [patch.filePath]: replaced.files[patch.filePath] || existing },
        touchedFiles: [patch.filePath],
        dependencyReloadRequired: false,
        dependencyMap: {},
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'UNSUPPORTED_PATCH',
      filePath: undefined,
      detail: `unsupported patch kind: ${(patch as { kind?: string }).kind || 'unknown'}`,
    },
  };
}

export interface ApplyPatchBatchOptions {
  expectedRevision?: number;
  previousDependencySignature?: string;
}

export type ApplyPatchBatchOutput =
  | {
      ok: true;
      value: PatchApplySuccess;
      revision?: number;
      dependencySignature?: string;
    }
  | {
      ok: false;
      error: PatchApplyFailure;
      revision?: number;
      dependencySignature?: string;
    };

export function applyPatchBatchEnvelope(
  currentFiles: Record<string, string>,
  envelope: PatchBatchEnvelope,
  options: ApplyPatchBatchOptions = {}
): ApplyPatchBatchOutput {
  if (
    typeof options.expectedRevision === 'number' &&
    typeof envelope.dependsOnRevision === 'number' &&
    envelope.dependsOnRevision !== options.expectedRevision
  ) {
    return {
      ok: false,
      error: {
        code: 'LOW_CONFIDENCE',
        detail: `revision mismatch: expected ${options.expectedRevision}, got ${envelope.dependsOnRevision}`,
      },
    };
  }

  const workingFiles = { ...currentFiles };
  const touched = new Set<string>();

  for (const patch of envelope.patches) {
    const applied = applySinglePatch(workingFiles, patch);
    if (!applied.ok) {
      return {
        ok: false,
        error: {
          code: 'PATCH_BATCH_ROLLED_BACK',
          filePath: applied.error.filePath,
          detail: `atomic rollback: patch ${patch.kind} on ${patch.filePath} failed (${applied.error.detail})`,
          causeCode: applied.error.code,
        },
      };
    }

    for (const [filePath, content] of Object.entries(applied.value.files)) {
      workingFiles[filePath] = content;
      touched.add(filePath);
    }
  }

  const touchedFiles = envelope.touchedFiles.length > 0 ? envelope.touchedFiles : [...touched];
  const gate = runSyntaxGate(workingFiles, touchedFiles);
  if (!gate.ok) {
    const first = gate.errors[0];
    return {
      ok: false,
      error: {
        code: 'PATCH_BATCH_ROLLED_BACK',
        filePath: first?.filePath,
        detail: `atomic rollback: syntax gate failed (${first?.message || 'unknown'})`,
        causeCode: 'SYNTAX_GATE_FAILED',
      },
    };
  }

  const packageJsonTouched = touchedFiles.includes('package.json');
  let dependencyMap: Record<string, string> = {};
  let dependencyDiff:
    | {
        added: string[];
        removed: string[];
        changed: string[];
      }
    | undefined;
  let dependencyReloadRequired = Boolean(envelope.validationHints?.requiresDependencyReload);
  let dependencySignature = options.previousDependencySignature;

  if (packageJsonTouched) {
    const previous = currentFiles['package.json'];
    const next = workingFiles['package.json'];
    if (typeof next !== 'string') {
      return {
        ok: false,
        error: {
          code: 'PATCH_BATCH_ROLLED_BACK',
          filePath: 'package.json',
          detail: 'atomic rollback: package.json was removed by patch',
          causeCode: 'INVALID_PACKAGE_JSON',
        },
      };
    }

    try {
      const resolved = resolveDependencyMap(previous, next);
      dependencyMap = resolved.dependencies;
      dependencyDiff = resolved.diff;
      dependencyReloadRequired = dependencyReloadRequired || resolved.changed;
      dependencySignature = createDependencySignature(dependencyMap);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'PATCH_BATCH_ROLLED_BACK',
          filePath: 'package.json',
          detail: `atomic rollback: ${
            error instanceof Error ? error.message : String(error)
          }`,
          causeCode: 'INVALID_PACKAGE_JSON',
        },
      };
    }
  }

  return {
    ok: true,
    value: {
      files: workingFiles,
      touchedFiles,
      dependencyReloadRequired,
      dependencyMap,
      dependencyDiff,
    },
    revision: envelope.revision,
    dependencySignature,
  };
}
