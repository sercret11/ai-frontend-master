/**
 * Shared rendering contracts between backend orchestration and frontend sandbox runtime.
 * Keep these types transport-friendly to reduce coupling between implementations.
 */

export type PreviewMode = 'schema' | 'code';

export type RenderingStack = 'schema' | 'sandpack';

export type AppGraphNodeType =
  | 'root'
  | 'page'
  | 'layout'
  | 'component'
  | 'slot'
  | 'text'
  | 'asset'
  | 'custom';

export interface AppGraphNode {
  id: string;
  type: AppGraphNodeType;
  name?: string;
  props?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  children: string[];
}

export type AppGraphRelation = 'child' | 'slot' | 'dependency' | 'event' | 'data';

export interface AppGraphEdge {
  from: string;
  to: string;
  relation: AppGraphRelation;
  metadata?: Record<string, unknown>;
}

export interface AppGraph {
  graphId: string;
  version: number;
  entryNodeId: string;
  nodes: Record<string, AppGraphNode>;
  edges?: AppGraphEdge[];
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface JsonPatchBaseOperation {
  path: string;
}

export interface JsonPatchAddOperation extends JsonPatchBaseOperation {
  op: 'add';
  value: unknown;
}

export interface JsonPatchRemoveOperation extends JsonPatchBaseOperation {
  op: 'remove';
}

export interface JsonPatchReplaceOperation extends JsonPatchBaseOperation {
  op: 'replace';
  value: unknown;
}

export interface JsonPatchMoveOperation extends JsonPatchBaseOperation {
  op: 'move';
  from: string;
}

export interface JsonPatchCopyOperation extends JsonPatchBaseOperation {
  op: 'copy';
  from: string;
}

export interface JsonPatchTestOperation extends JsonPatchBaseOperation {
  op: 'test';
  value: unknown;
}

export type JsonPatchOperation =
  | JsonPatchAddOperation
  | JsonPatchRemoveOperation
  | JsonPatchReplaceOperation
  | JsonPatchMoveOperation
  | JsonPatchCopyOperation
  | JsonPatchTestOperation;

export type PatchSource = 'user' | 'assistant' | 'system' | 'sync';

export interface PatchEnvelope {
  patchId: string;
  graphId: string;
  baseVersion: number;
  targetVersion?: number;
  createdAt: number;
  source: PatchSource;
  reason?: string;
  operations: JsonPatchOperation[];
  metadata?: Record<string, unknown>;
}

export type AssemblyGraph = Record<string, unknown>;

export type AssemblyPatchPayload = Record<string, unknown>;

export interface AssemblyPatch {
  id: string;
  revision: number;
  patch: AssemblyPatchPayload;
  createdAt: number;
  acknowledgedAt?: number;
}

export interface AssemblySessionSnapshot {
  sessionId: string;
  runId: string | null;
  revision: number;
  acknowledgedRevision: number;
  executor: string;
  graph: AssemblyGraph;
  pendingPatches: AssemblyPatch[];
  createdAt: number;
  updatedAt: number;
}

export type RenderingCapability =
  | 'schema-render'
  | 'code-execute'
  | 'hot-patch'
  | 'health-check'
  | 'dependency-reload'
  | 'ast-surgery';

export interface RenderingAdapterDescriptor {
  id: string;
  displayName: string;
  mode: PreviewMode;
  stack: RenderingStack;
  priority: number;
  capabilities: RenderingCapability[];
}

export interface RenderingRequest {
  sessionId: string;
  runId?: string;
  mode: PreviewMode;
  graph: AppGraph;
  patch?: PatchEnvelope;
  metadata?: Record<string, unknown>;
}

export type SandboxFailureClass =
  | 'dependency'
  | 'syntax'
  | 'typecheck'
  | 'build'
  | 'runtime'
  | 'healthcheck'
  | 'timeout'
  | 'unknown';

export interface SandboxFailureReport {
  reportId: string;
  classification: SandboxFailureClass;
  summary: string;
  details?: string;
  stage?: string;
  failedAt: number;
  diagnostics?: string[];
  files?: string[];
  metadata?: Record<string, unknown>;
}

export interface SandboxRepairTicket {
  ticketId: string;
  reportId: string;
  status: 'queued' | 'dispatched' | 'in_progress' | 'completed' | 'failed';
  createdAt: number;
  dispatchedAt?: number;
  completedAt?: number;
  assignee: 'agent';
  attempt: number;
  maxAttempts: number;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface SandboxRepairDispatchRequest {
  report: SandboxFailureReport;
}

export interface SandboxRepairDispatchResponse {
  ok: true;
  ticket: SandboxRepairTicket;
  report: SandboxFailureReport;
}

export interface SandboxRepairStatusResponse {
  ok: true;
  ticket: SandboxRepairTicket;
  report?: SandboxFailureReport;
}

export type RenderArtifactKind = 'schema' | 'code' | 'html' | 'url' | 'error';

export interface RenderArtifact {
  kind: RenderArtifactKind;
  payload: unknown;
  mimeType?: string;
}

export interface RenderDegradeInfo {
  fromMode: PreviewMode;
  toMode: PreviewMode;
  reason: string;
}

export interface RenderingResult {
  success: boolean;
  mode: PreviewMode;
  stack: RenderingStack;
  graphVersion: number;
  artifact: RenderArtifact;
  durationMs: number;
  diagnostics?: string[];
  degraded?: RenderDegradeInfo;
}
