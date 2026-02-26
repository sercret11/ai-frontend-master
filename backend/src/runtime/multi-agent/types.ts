import type {
  AgentRuntimeID,
  RouteDecision,
  RuntimeEvent,
  RuntimeEventPayload,
} from '@ai-frontend/shared-types';

export interface MultiAgentTask {
  id: string;
  title: string;
  agentId: AgentRuntimeID;
  wave: number;
  dependsOn: string[];
  goal: string;
}

export interface PatchIntent {
  id: string;
  waveId: string;
  taskId: string;
  agentId: AgentRuntimeID;
  filePath: string;
  content: string;
  contentHash: string;
  createdAt: number;
}

export interface MergedPatch {
  waveId: string;
  filePath: string;
  content: string;
  sources: PatchIntent[];
}

export interface ConflictRecord {
  id: string;
  waveId: string;
  filePath: string;
  intents: PatchIntent[];
  reason: string;
  status: 'open' | 'resolved';
}

export interface MergedPatchBatch {
  id: string;
  waveId: string;
  merged: MergedPatch[];
  conflicts: ConflictRecord[];
  touchedFiles: string[];
}

export interface QualityGateState {
  gate: string;
  status: 'pending' | 'passed' | 'failed';
  score?: number;
  summary?: string;
}

export interface BlackboardSnapshot {
  tasks: MultiAgentTask[];
  patchIntents: PatchIntent[];
  conflicts: ConflictRecord[];
  qualityGates: QualityGateState[];
}

export type RuntimeEventEmitter = (event: RuntimeEventPayload) => RuntimeEvent;

export interface AgentExecutionContext {
  sessionId: string;
  runId: string;
  userMessage: string;
  task: MultiAgentTask;
  routeDecision: Pick<RouteDecision, 'agentId' | 'mode' | 'source' | 'confidence'>;
  modelProvider?: string;
  modelId?: string;
  platform?: 'web' | 'mobile' | 'desktop' | 'miniprogram';
  techStack: string[];
  emitRuntimeEvent: RuntimeEventEmitter;
  abortSignal: AbortSignal;
}

export interface AgentExecutionResult {
  success: boolean;
  summary: string;
  assistantText: string;
  patchIntents: PatchIntent[];
  touchedFiles: string[];
}

export interface RuntimeAgent {
  id: AgentRuntimeID;
  title: string;
  defaultGoal: string;
  fallbackAgentId: string;
  allowedTools: string[];
  buildPrompt: (context: AgentExecutionContext) => string;
  run: (context: AgentExecutionContext) => Promise<AgentExecutionResult>;
}

export interface MultiAgentKernelInput {
  sessionId: string;
  runId: string;
  userMessage: string;
  routeDecision: Pick<RouteDecision, 'agentId' | 'mode' | 'source' | 'confidence'>;
  modelProvider?: string;
  modelId?: string;
  platform?: 'web' | 'mobile' | 'desktop' | 'miniprogram';
  techStack: string[];
  emitRuntimeEvent: RuntimeEventEmitter;
  abortSignal: AbortSignal;
}

