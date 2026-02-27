/**
 * 执行层（Execution_Layer）类型定义
 *
 * 定义执行层的智能体 ID、输入/输出、任务结果和质量门状态。
 */

import type { RuntimeEventPayload, RuntimeEvent } from '@ai-frontend/shared-types';
import type { PatchIntent } from '../runtime/multi-agent/types';
import type { ExecutionPlan, ExecutionAgentID } from '../planning/types';

// Re-export ExecutionAgentID for convenience
export type { ExecutionAgentID } from '../planning/types';

// ============================================================================
// Execution Layer I/O
// ============================================================================

export type RuntimeEventEmitter = (event: RuntimeEventPayload) => RuntimeEvent;

export interface ExecutionLayerInput {
  sessionId: string;
  runId: string;
  plan: ExecutionPlan;
  userMessage: string;
  platform?: string;
  techStack: string[];
  abortSignal: AbortSignal;
  emitRuntimeEvent: RuntimeEventEmitter;
}

export interface ExecutionLayerOutput {
  success: boolean;
  patchIntents: PatchIntent[];
  touchedFiles: string[];
  degradedTasks: string[];
  unresolvedIssues: string[];
}

/**
 * Context passed to `ExecutionLayer.runWave` for each wave of parallel tasks.
 *
 * Contains the shared dependencies needed to execute individual tasks:
 * session info, user message, and event emitting.
 */
export interface ExecutionContext {
  sessionId: string;
  runId: string;
  userMessage: string;
  platform?: string;
  techStack: string[];
  abortSignal: AbortSignal;
  emitRuntimeEvent: RuntimeEventEmitter;
}

// ============================================================================
// Task Result
// ============================================================================

export interface TaskResult {
  taskId: string;
  agentId: ExecutionAgentID;
  success: boolean;
  patchIntents: PatchIntent[];
  touchedFiles: string[];
  error?: string;
  /** LLM response text captured from the agent's final response. */
  responseText?: string;
}

// ============================================================================
// Quality Gate (re-exported from multi-agent types for consistency)
// ============================================================================

export { type QualityGateState } from '../runtime/multi-agent/types';
