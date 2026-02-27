/**
 * 规划层（Planning_Layer）类型定义
 *
 * 定义执行计划的结构，包括任务、依赖关系和智能体分配。
 */

import type { RuntimeEventPayload, RuntimeEvent } from '@ai-frontend/shared-types';
import type { SessionDocument } from '../analysis/types';

// ============================================================================
// Execution Plan
// ============================================================================

export type ExecutionAgentID =
  | 'scaffold-agent'
  | 'page-agent'
  | 'interaction-agent'
  | 'state-agent'
  | 'style-agent'
  | 'quality-agent'
  | 'repair-agent';

export interface ExecutionPlanTask {
  id: string;
  agentId: ExecutionAgentID;
  goal: string;
  dependsOn: string[];
  tools: string[];
}

export interface ExecutionPlan {
  id: string;
  createdAt: number;
  tasks: ExecutionPlanTask[];
}

// ============================================================================
// Planning Layer I/O
// ============================================================================

export type RuntimeEventEmitter = (event: RuntimeEventPayload) => RuntimeEvent;

export interface PlanningLayerInput {
  sessionId: string;
  documents: SessionDocument[];
  abortSignal: AbortSignal;
  emitRuntimeEvent: RuntimeEventEmitter;
}
