/**
 * Backend Module - Unified Export Point
 *
 * Central export point for all backend modules
 */

// Tool System
export { Tool, ToolRegistry } from './tool';

// Individual tools
export { ReadTool } from './tool/tools/read';
export { WriteTool } from './tool/tools/write';
export { GrepTool } from './tool/tools/grep';
export { GlobTool } from './tool/tools/glob';
export { BashTool } from './tool/tools/bash';
export { WebFetchTool } from './tool/tools/webfetch';
export { DesignSearchTool } from './tool/tools/design-search';

// Prompt System
export { SectionLoader, loadSystemPrompt, loadAsset } from './prompt/section-loader';
export { PromptBuilder } from './prompt/builder';
export { ModeRouter } from './prompt/router';

// Agent System
export { Agent } from './agent/agent';

// LLM Service (backed by LLMClient)
export { LLMService } from './llm/index';
export { LLMClient, createLLMClient, getDefaultLLMClient } from './llm/index';

// Session Management
export { SessionStorage } from './session/storage';
export { SessionManager } from './session/manager';

// Server
export { app, server } from './server';

// Type re-exports for convenience
export type {
  // Session types
  SessionInfo,
  Message,
  MessagePart,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  FilePart,
  ReasoningPart,
  MessageRole,
  MessagePartType,
  ToolCallState,
  CreateSessionParams,
  UpdateSessionParams,
  WSMessage,
  WSMessageUnion,
  TextDeltaMessage,
  ToolCallMessage,
  ToolResultMessage,
  DoneMessage,
  ErrorMessage,
  SessionStats,

  // Tool types
  ToolInfo,
  ToolContext,
  ToolMetadata,
  ToolInitContext,
  ToolParameters,
  ToolExecutionResult,
  ToolInitResult,
  ToolDefineFunction,
  ToolRegistration,
  ToolFilterOptions,
  ToolCallRequest,
  ToolCallResponse,
  ToolExecuteOptions,
  ToolExecutionStatus,
  ToolStatus,
  FileOperationMetadata,
  SearchOperationMetadata,
  CommandExecutionMetadata,
  DesignSearchMetadata,

  // Prompt types
  PromptSection,
  PromptPriority,
  PromptSectionLoadOptions,
  PromptTemplate,
  TemplateVariable,
  PromptRenderResult,
  DesignStyle,
  ColorPalette,
  TypographyPair,
  DesignTokens,
  AgentConfig,
  SessionMode,
  AgentDetectionParams,
  AgentDetectionResult,
  InputLanguage,
  RouteInput,
  RouteDecision,
  UserInputAnalysis,
  ModeRouterAnalysis,
  PromptBudgetReport,
  PromptBuildOptions,
  PromptBuildResult,
  DesignSearchParams,
  DesignSearchResult,
} from '@ai-frontend/shared-types';

/**
 * Backend version
 */
export const BACKEND_VERSION = '1.0.0';

/**
 * Initialize all backend services
 */
export async function initializeBackend() {
  const { SessionStorage } = await import('./session/storage');
  SessionStorage.initialize();
  console.log('[Backend] Initialized');
}
