import type { RouteDecision, SessionMode } from '@ai-frontend/shared-types';

/**
 * Layer1 编排阶段定义（与 docs/架构 保持一致）
 */
export type OrchestrationPhase =
  | 'design-system'
  | 'skeleton'
  | 'skeleton-l1-gate'
  | 'contract-freeze'
  | 'research'
  | 'shared-components'
  | 'pages'
  | 'interactions'
  | 'states'
  | 'quality'
  | 'repair';

/**
 * 任务执行模式：串行/并行/流水线
 */
export type TaskExecutionMode = 'serial' | 'parallel' | 'pipeline';

/**
 * 任务执行状态
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * 编排任务主体
 */
export interface ExecutionTask {
  id: string;
  phase: OrchestrationPhase;
  name: string;
  description: string;
  agent:
    | 'DesignSystemAgent'
    | 'PageAgent'
    | 'InteractionAgent'
    | 'StateAgent'
    | 'QualityAgent'
    | 'RepairAgent';
  mode: TaskExecutionMode;
  dependencies: string[];
  priority: number;
  timeoutMs: number;
  retryLimit: number;
  metadata?: Record<string, unknown>;
}

/**
 * 执行计划（Layer1 入口）
 */
export interface ExecutionPlan {
  id: string;
  createdAt: number;
  userMessage: string;
  routeDecision: Pick<
    RouteDecision,
    'agentId' | 'mode' | 'source' | 'confidence' | 'framework' | 'uiLibrarySelection' | 'decisionTrace'
  >;
  maxIterations: number;
  tasks: ExecutionTask[];
  replanPolicy?: {
    maxReplanDepth: number;
  };
  metadata?: {
    platform?: 'web' | 'mobile' | 'desktop' | 'miniprogram';
    techStack?: string[];
    projectType?: 'next-js' | 'react-vite' | 'react-native' | 'uniapp';
    requirementStrategy?: 'direct' | 'brainstorm';
    uiBlueprint?: UIBlueprint;
  };
}

export interface UIBlueprintRoute {
  id: string;
  path: string;
  role: string;
}

export interface UIBlueprintInteraction {
  id: string;
  requirement: string;
  mandatory: boolean;
}

export interface UIBlueprintState {
  id: string;
  description: string;
  mandatory: boolean;
}

export interface UIBlueprintFormField {
  name: string;
  type: 'text' | 'number' | 'select' | 'textarea' | 'date';
  required: boolean;
}

export interface UIBlueprintFormContract {
  id: string;
  fields: UIBlueprintFormField[];
  validation: string;
}

export interface UIBlueprint {
  version: 1;
  intent: 'generic-interactive-application';
  modules: string[];
  routes: UIBlueprintRoute[];
  interactions: UIBlueprintInteraction[];
  states: UIBlueprintState[];
  forms: UIBlueprintFormContract[];
  acceptanceGates: {
    minViewCount: number;
    minDataSurfaceCount: number;
    minFormFlowCount: number;
    requireValidationFeedback: boolean;
    requireExplicitStateTransitions: boolean;
  };
}

/**
 * 计划生成输入
 */
export interface PlanGenerationInput {
  userMessage: string;
  routeDecision: Pick<
    RouteDecision,
    'agentId' | 'mode' | 'source' | 'confidence' | 'framework' | 'uiLibrarySelection' | 'decisionTrace'
  >;
  platform?: 'web' | 'mobile' | 'desktop' | 'miniprogram';
  techStack?: string[];
  projectType?: 'next-js' | 'react-vite' | 'react-native' | 'uniapp';
  sessionMode?: SessionMode;
}

/**
 * 调度后的任务组
 */
export interface ScheduledTaskGroup {
  id: string;
  mode: TaskExecutionMode;
  taskIds: string[];
  tasks: ExecutionTask[];
  wave: number;
}

/**
 * 调度结果
 */
export interface ExecutionSchedule {
  groups: ScheduledTaskGroup[];
  orderedTaskIds: string[];
  hasCycle: boolean;
}

/**
 * 单个任务执行结果
 */
export interface TaskExecutionResult {
  taskId: string;
  status: TaskStatus;
  durationMs?: number;
  error?: string;
}

export interface ContractSignatureDigest {
  filePath: string;
  exports: string[];
  functionSignatures: string[];
  interfaceNames: string[];
  typeNames: string[];
  mockShapes: Array<{
    name: string;
    keys: string[];
  }>;
  degraded: boolean;
}

export interface ContractBundle {
  generatedAt: number;
  files: ContractSignatureDigest[];
  summary: string;
}

export interface ExternalDependencyChecklist {
  framework: string;
  packageName: string;
  topics: string[];
  projectType?: 'next-js' | 'react-vite' | 'react-native' | 'uniapp';
}

export interface SourceRef {
  url: string;
  title: string;
  sourceType: 'official' | 'community';
  confidence: 'high' | 'medium' | 'low';
}

export interface ApiSignature {
  library: string;
  symbol: string;
  signature: string;
  sourceRefs: SourceRef[];
}

export interface MinimalSnippet {
  library: string;
  title: string;
  code: string;
  sourceRefs: SourceRef[];
}

export interface VersionHint {
  framework: string;
  majorVersion: string;
  confidence: 'high' | 'medium' | 'low';
  sourceRefs: SourceRef[];
}

export interface ResearchDigest {
  generatedAt: number;
  dependencies: ExternalDependencyChecklist[];
  apiSignatures: ApiSignature[];
  snippets: MinimalSnippet[];
  versionHints: VersionHint[];
  sourceRefs: SourceRef[];
  summary: string;
}

/**
 * 反思问题项
 */
export interface ReflectionIssue {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  taskId?: string;
  suggestion?: string;
}

/**
 * 反思评估结果
 */
export interface Reflection {
  score: number;
  demandMatch: number;
  consistency: number;
  codeQuality: number;
  bestPractice: number;
  shouldIterate: boolean;
  summary: string;
  issues: ReflectionIssue[];
}

/**
 * 迭代决策
 */
export type DecisionType = 'accept' | 'iterate' | 'abort';

export interface ReplanDiagnosticBundle {
  createdAt: number;
  iteration: number;
  replanDepth: number;
  maxReplanDepth: number;
  reason: string;
  reflectionSummary: string;
  issues: ReflectionIssue[];
}

/**
 * 迭代控制结果
 */
export interface Decision {
  decision: DecisionType;
  reason: string;
  iteration: number;
  maxIterationsReached: boolean;
  nextTasks: ExecutionTask[];
  replanDepth: number;
  maxReplanDepth: number;
  escalated: boolean;
  escalationReason?: string;
  diagnosticBundle?: ReplanDiagnosticBundle;
}
