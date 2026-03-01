/**
 * LLM_Client 核心类型定义
 *
 * 统一的 LLM 调用接口类型。
 * 支持 Anthropic、OpenAI、Google 三个提供商的原生 API。
 */

// ============================================================================
// Provider & Request
// ============================================================================

/** 支持的 LLM 提供商 */
export type ProviderID = 'anthropic' | 'openai' | 'google' | 'dashscope' | 'zhipuai';

/** 统一请求参数 */
export interface LLMRequestParams {
  provider: ProviderID;
  model: string;
  systemPrompt: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}

/** 统一消息格式 */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool_result';
  content: string | ContentBlock[];
}

/** 消息内容块 */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: string;
  isError?: boolean;
}

// ============================================================================
// Tool Definitions
// ============================================================================

/** 工具定义（JSON Schema 格式） */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ============================================================================
// Response
// ============================================================================

/** 统一响应格式 */
export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: TokenUsage;
}

export type FinishReason = 'stop' | 'tool_use' | 'max_tokens' | 'error';

/** 工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Token 用量统计 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ============================================================================
// Streaming
// ============================================================================

/** 流式事件联合类型 */
export type StreamEvent =
  | StreamTextDelta
  | StreamToolCallStart
  | StreamToolCallDelta
  | StreamToolCallEnd
  | StreamDone;

export interface StreamTextDelta {
  type: 'text_delta';
  text: string;
}

export interface StreamToolCallStart {
  type: 'tool_call_start';
  id: string;
  name: string;
}

export interface StreamToolCallDelta {
  type: 'tool_call_delta';
  id: string;
  argumentsDelta: string;
}

export interface StreamToolCallEnd {
  type: 'tool_call_end';
  id: string;
}

export interface StreamDone {
  type: 'done';
  response: LLMResponse;
}

/** 流式调用结果 */
export interface LLMStreamResult {
  events: AsyncIterable<StreamEvent>;
  response: Promise<LLMResponse>;
}

// ============================================================================
// Error
// ============================================================================

/** LLM 错误类型 */
export interface LLMError extends Error {
  provider: ProviderID;
  statusCode: number;
  retryable: boolean;
  raw?: unknown;
}

/** 工具执行器接口（供 completeWithTools 使用） */
export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ content: string; isError?: boolean }>;
