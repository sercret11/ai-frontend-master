export interface AstSemanticSelector {
  type?: string;
  identifier?: string;
  contains?: string;
  ancestry?: string[];
}

export interface AstReplacePatchV2 {
  kind: 'ast_replace_v2';
  filePath: string;
  selector: AstSemanticSelector;
  expectedHash?: string;
  replacement: string;
}

export type SandpackPatch = AstReplacePatchV2;

export interface PatchBatchEnvelope {
  runId: string;
  patchId?: string;
  revision: number;
  atomicGroupId: string;
  dependsOnRevision?: number;
  touchedFiles: string[];
  checksum?: string;
  validationHints?: {
    requiresDependencyReload?: boolean;
  };
  patches: SandpackPatch[];
}

export interface PatchApplyFailure {
  code:
    | 'LOW_CONFIDENCE'
    | 'FILE_NOT_FOUND'
    | 'UNSUPPORTED_PATCH'
    | 'SYNTAX_GATE_FAILED'
    | 'INVALID_PACKAGE_JSON'
    | 'AST_SELECTOR_NOT_FOUND'
    | 'AST_REPLACEMENT_INVALID'
    | 'AST_APPLY_FAILED'
    | 'PATCH_BATCH_ROLLED_BACK';
  filePath?: string;
  detail: string;
  causeCode?: string;
}

export interface PatchApplySuccess {
  files: Record<string, string>;
  touchedFiles: string[];
  dependencyReloadRequired: boolean;
  dependencyMap: Record<string, string>;
  dependencyDiff?: {
    added: string[];
    removed: string[];
    changed: string[];
  };
}

export type PatchApplyResult =
  | { ok: true; value: PatchApplySuccess }
  | { ok: false; error: PatchApplyFailure };
