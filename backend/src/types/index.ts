/**
 * Types Index - 统一导出所有类型定义
 *
 * 导出策略：
 * 1. 从 @ai-frontend/shared-types 导出共享类型
 * 2. 从本地模块导出内部类型（标注 @internal）
 * 3. 使用命名导出避免类型冲突
 */

// ============================================================================
// 共享类型（从 shared-types 包）
// ============================================================================

export type {
  // 基础类型
  BaseMessage,

  // Session & Message types
  SessionInfo,
  Message, // 注意：这是用于会话存储的消息类型（包含 id, sessionID, createdAt）
  MessagePart,
  CreateSessionParams,

  // Tool types
  ToolInfo,
  ToolContext,
  ToolExecutionResult,
  ToolMetadata,
  ToolRegistration,
  ToolFilterOptions,

  // Prompt types
  PromptSection,
  PromptPriority,
  AgentConfig,
  SessionMode,
  PromptBuildResult,
  PromptSectionLoadOptions,
  PromptTemplate,
  TemplateVariable,

  // Design types
  DesignStyle,
  ColorPalette,
  TypographyPair,
  DesignSearchMetadata,

  // File operation types (from shared-types)
  FileOperationMetadata,
  SearchOperationMetadata,
  CommandExecutionMetadata,

  // API types
  ApiResponse,
} from '@ai-frontend/shared-types';

// ============================================================================
// 内部类型（后端专用，标注 @internal）
// ============================================================================

export type {
  // 上下文管理（内部）
  Section,
  Skill,
  ContextMessage, // 重命名：用于上下文管理的内部消息类型（包含 tokens, timestamp）
  CompactionCheckpoint,
  CompactionResult,
  PruningConfig,
  PrunedContext,
  SelectedSection,
  SelectionRequest,
  SelectionResult,
  ContextBuildRequest,
  BuiltContext,
  Session, // 内部会话类型（用于上下文管理）
} from './context';

// File operation types (internal)
export type {
  FileAction,
  FileChangeInstruction,
  FileChangeMetadata,
  ExecuteResult,
  FailedInstruction,
  FileTransaction,
} from './file-change';

// 导出类型转换工具
export {
  toMessage,
  toContextMessage,
  batchToMessages,
  batchToContextMessages,
} from './message-converters';
