/**
 * Runtime event types shared by backend and frontend.
 *
 * These events power SSE/WebSocket transport and the timeline/console UI.
 */

import type { Diagnostics } from './prompt';
import type {
  AssemblyPatch,
  AssemblySessionSnapshot,
  PreviewMode,
} from './rendering';

// ============================================================================
// Base types
// ============================================================================

export type RuntimeEventType =
  | 'assistant.delta'
  | 'tool.call.started'
  | 'tool.call.progress'
  | 'tool.call.completed'
  | 'tool.call.failed'
  | 'agent.task.started'
  | 'agent.task.progress'
  | 'agent.task.completed'
  | 'agent.task.blocked'
  | 'patch.intent.submitted'
  | 'patch.batch.merged'
  | 'conflict.detected'
  | 'conflict.resolved'
  | 'quality.gate.updated'
  | 'artifact.file.changed'
  | 'render.pipeline.stage'
  | 'render.mode.switched'
  | 'assembly.graph.ready'
  | 'assembly.patch'
  | 'assembly.executor.switch'
  | 'autonomy.iteration'
  | 'autonomy.budget'
  | 'autonomy.decision'
  | 'run.completed'
  | 'run.error';

export type RuntimeToolCallState =
  | 'started'
  | 'pending'
  | 'executing'
  | 'completed'
  | 'failed';

export type AgentRuntimeID =
  | 'planner-agent'
  | 'architect-agent'
  | 'scaffold-agent'
  | 'page-agent'
  | 'interaction-agent'
  | 'state-agent'
  | 'style-agent'
  | 'quality-agent'
  | 'repair-agent'
  | 'research-agent';

export type RenderAdapterType =
  | 'schema-renderer'
  | 'sandpack-renderer'
  | 'react-native'
  | 'uniapp';

export type RenderPipelineStage =
  | 'plan'
  | 'route'
  | 'ingest'
  | 'normalize'
  | 'diff'
  | 'apply'
  | 'execute'
  | 'build'
  | 'serve'
  | 'health'
  | 'publish';

export type AutonomyIterationStage = 'start' | 'reflect' | 'repair' | 'complete';

export type AutonomyBudgetScope = 'run' | 'iteration' | 'prompt';

export type AutonomyBudgetStatus = 'ok' | 'warning' | 'exhausted';

export type AutonomyDecision = 'accept' | 'iterate' | 'abort';

export type RunTerminationReason =
  | 'goal_reached'
  | 'single_iteration'
  | 'max_iterations'
  | 'max_duration'
  | 'max_tool_calls'
  | 'empty_model_output'
  | 'reflection_abort'
  | 'user_abort'
  | 'error';

export interface RuntimeBaseEvent {
  type: RuntimeEventType;
  sessionId: string;
  runId: string;
  sequence: number;
  timestamp: number;
  agentId?: AgentRuntimeID;
  taskId?: string;
  waveId?: string;
  correlationId?: string;
  displayHint?: 'step' | 'important' | 'summary';
  parentId?: string;
  groupId?: string;
  durationMs?: number;
}

// ============================================================================
// Event definitions
// ============================================================================

export interface AssistantDeltaEvent extends RuntimeBaseEvent {
  type: 'assistant.delta';
  delta: string;
}

export interface ToolCallStartedEvent extends RuntimeBaseEvent {
  type: 'tool.call.started';
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  state: 'started';
}

export interface ToolCallProgressEvent extends RuntimeBaseEvent {
  type: 'tool.call.progress';
  callId: string;
  toolName: string;
  state: 'pending' | 'executing';
  progressText?: string;
}

export interface ToolCallCompletedEvent extends RuntimeBaseEvent {
  type: 'tool.call.completed';
  callId: string;
  toolName: string;
  state: 'completed';
  title?: string;
  output?: string;
  metadata?: Record<string, unknown>;
  diagnostics?: Diagnostics;
}

export interface ToolCallFailedEvent extends RuntimeBaseEvent {
  type: 'tool.call.failed';
  callId: string;
  toolName: string;
  state: 'failed';
  error: string;
  diagnostics?: Diagnostics;
}

export interface ArtifactFileChangedEvent extends RuntimeBaseEvent {
  type: 'artifact.file.changed';
  path: string;
  action: 'create' | 'update' | 'delete';
}

export interface RenderPipelineStageEvent extends RuntimeBaseEvent {
  type: 'render.pipeline.stage';
  adapter: RenderAdapterType;
  stage: RenderPipelineStage;
  status: 'started' | 'completed' | 'failed';
  message?: string;
  diagnostics?: Diagnostics;
}

export interface RenderModeSwitchedEvent extends RuntimeBaseEvent {
  type: 'render.mode.switched';
  adapter: RenderAdapterType;
  fromMode: PreviewMode;
  toMode: PreviewMode;
  reason?: string;
}

export interface AssemblyGraphReadyEvent extends RuntimeBaseEvent {
  type: 'assembly.graph.ready';
  revision: number;
  graph: AssemblySessionSnapshot['graph'];
  executor: string;
  pendingPatches: number;
  message?: string;
}

export interface AssemblyPatchEvent extends RuntimeBaseEvent {
  type: 'assembly.patch';
  revision: number;
  patchId: string;
  patch: AssemblyPatch['patch'];
  acked: boolean;
}

export interface AssemblyExecutorSwitchEvent extends RuntimeBaseEvent {
  type: 'assembly.executor.switch';
  previousExecutor: string;
  executor: string;
  revision: number;
  message?: string;
}

export interface AutonomyIterationEvent extends RuntimeBaseEvent {
  type: 'autonomy.iteration';
  iteration?: number;
  maxIterations?: number;
  stage?: AutonomyIterationStage;
  message?: string;
  reflectionScore?: number;
}

export interface AutonomyBudgetEvent extends RuntimeBaseEvent {
  type: 'autonomy.budget';
  scope?: AutonomyBudgetScope;
  used?: number;
  limit?: number;
  remaining?: number;
  unit?: 'tokens' | 'steps' | 'ms' | 'calls';
  status?: AutonomyBudgetStatus;
  message?: string;
}

export interface AutonomyDecisionEvent extends RuntimeBaseEvent {
  type: 'autonomy.decision';
  decision?: AutonomyDecision;
  reason?: string;
  iteration?: number;
  nextIteration?: number;
  nextTaskCount?: number;
  maxIterationsReached?: boolean;
}

export interface AgentTaskStartedEvent extends RuntimeBaseEvent {
  type: 'agent.task.started';
  agentId: AgentRuntimeID;
  taskId: string;
  waveId: string;
  title: string;
  goal?: string;
}

export interface AgentTaskProgressEvent extends RuntimeBaseEvent {
  type: 'agent.task.progress';
  agentId: AgentRuntimeID;
  taskId: string;
  waveId: string;
  progressText: string;
  percent?: number;
}

export interface AgentTaskCompletedEvent extends RuntimeBaseEvent {
  type: 'agent.task.completed';
  agentId: AgentRuntimeID;
  taskId: string;
  waveId: string;
  success: boolean;
  summary?: string;
}

export interface AgentTaskBlockedEvent extends RuntimeBaseEvent {
  type: 'agent.task.blocked';
  agentId: AgentRuntimeID;
  taskId: string;
  waveId: string;
  reason: string;
}

export interface PatchIntentSubmittedEvent extends RuntimeBaseEvent {
  type: 'patch.intent.submitted';
  agentId: AgentRuntimeID;
  taskId: string;
  waveId: string;
  patchIntentId: string;
  filePath: string;
}

export interface PatchBatchMergedEvent extends RuntimeBaseEvent {
  type: 'patch.batch.merged';
  waveId: string;
  patchBatchId: string;
  patchCount: number;
  touchedFiles: string[];
}

export interface ConflictDetectedEvent extends RuntimeBaseEvent {
  type: 'conflict.detected';
  waveId: string;
  conflictId: string;
  filePath: string;
  involvedAgents: AgentRuntimeID[];
  reason: string;
}

export interface ConflictResolvedEvent extends RuntimeBaseEvent {
  type: 'conflict.resolved';
  waveId: string;
  conflictId: string;
  filePath: string;
  resolvedBy: AgentRuntimeID;
  resolution: 'merged' | 'overridden' | 'manual';
}

export interface QualityGateUpdatedEvent extends RuntimeBaseEvent {
  type: 'quality.gate.updated';
  gate: string;
  status: 'pending' | 'passed' | 'failed';
  score?: number;
  summary?: string;
}

export interface RuntimeBudgetSummary {
  maxIterations: number;
  usedIterations: number;
  maxToolCalls: number;
  usedToolCalls: number;
  maxDurationMs: number;
  elapsedMs: number;
  targetScore: number;
  finalScore?: number;
}

export interface RunCompletedEvent extends RuntimeBaseEvent {
  type: 'run.completed';
  success: boolean;
  filesCount?: number;
  terminationReason?: RunTerminationReason;
  iterations?: number;
  budgetSummary?: RuntimeBudgetSummary;
  diagnostics?: Diagnostics;
}

export interface RunErrorEvent extends RuntimeBaseEvent {
  type: 'run.error';
  error: string;
  diagnostics?: Diagnostics;
}

export type RuntimeEvent =
  | AssistantDeltaEvent
  | ToolCallStartedEvent
  | ToolCallProgressEvent
  | ToolCallCompletedEvent
  | ToolCallFailedEvent
  | AgentTaskStartedEvent
  | AgentTaskProgressEvent
  | AgentTaskCompletedEvent
  | AgentTaskBlockedEvent
  | PatchIntentSubmittedEvent
  | PatchBatchMergedEvent
  | ConflictDetectedEvent
  | ConflictResolvedEvent
  | QualityGateUpdatedEvent
  | ArtifactFileChangedEvent
  | RenderPipelineStageEvent
  | RenderModeSwitchedEvent
  | AssemblyGraphReadyEvent
  | AssemblyPatchEvent
  | AssemblyExecutorSwitchEvent
  | AutonomyIterationEvent
  | AutonomyBudgetEvent
  | AutonomyDecisionEvent
  | RunCompletedEvent
  | RunErrorEvent;

export type RuntimeEventPayload<TEvent extends RuntimeEvent = RuntimeEvent> =
  TEvent extends RuntimeEvent
    ? Omit<TEvent, 'sessionId' | 'runId' | 'sequence' | 'timestamp'>
    : never;

export type AssemblyRuntimeEvent =
  | AssemblyGraphReadyEvent
  | AssemblyPatchEvent
  | AssemblyExecutorSwitchEvent
  | RunCompletedEvent
  | RunErrorEvent;

export type AssemblyRuntimeEventPayload = RuntimeEventPayload<AssemblyRuntimeEvent>;

// ============================================================================
// Timeline types
// ============================================================================

export type RuntimeTimelineItemType =
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'render_event'
  | 'system_event';

export interface RuntimeTimelineItem {
  id: string;
  type: RuntimeTimelineItemType;
  sessionId?: string;
  runId?: string;
  createdAt: number;
  content: string;
  event?: RuntimeEvent;
}
