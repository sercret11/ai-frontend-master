/**
 * Session Types - 会话相关类型定义
 * 用于前后端之间的会话数据交换
 */

// ============================================================================
// 会话信息类型
// ============================================================================

/**
 * 会话信息接口
 */
export interface SessionInfo {
  /** 会话唯一标识 */
  id: string;
  /** 所属用户唯一标识 */
  ownerId?: string;
  /** 会话标题 */
  title: string;
  /** 项目 ID */
  projectID?: string;
  /** 项目类型 */
  projectType?: 'next-js' | 'react-vite' | 'react-native' | 'uniapp' | null;
  /** 会话模式 */
  mode: 'creator' | 'implementer';
  /** Agent ID */
  agentId: string;
  /** 模型提供�?*/
  modelProvider: string;
  /** 模型 ID */
  modelId: string;
  /** 创建时间（时间戳�?*/
  createdAt: number;
  /** 最后更新时间（时间戳） */
  updatedAt: number;
}

// ============================================================================
// 消息类型
// ============================================================================

/**
 * 核心消息类型（用�?AI SDK�?
 * 简化的消息结构，兼�?Vercel AI SDK
 */
export interface CoreMessage {
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string | Array<{
    type: 'text' | 'tool-use' | 'tool-result';
    text?: string;
    id?: string;
    name?: string;
    content?: string;
    toolUseId?: string;
  }>;
}

/**
 * 消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * 消息部分类型
 */
export type MessagePartType = 'text' | 'tool-call' | 'tool-result' | 'file' | 'reasoning';

/**
 * 基础消息部分接口
 */
export interface BaseMessagePart {
  /** 部分唯一标识 */
  id: string;
  /** 类型 */
  type: MessagePartType;
  /** 创建时间（时间戳�?*/
  createdAt: number;
}

/**
 * 文本消息部分
 */
export interface TextPart extends BaseMessagePart {
  type: 'text';
  /** 文本内容 */
  text: string;
  /** 是否为合成内容（AI 生成的） */
  synthetic?: boolean;
  /** 是否被忽�?*/
  ignored?: boolean;
  /** 元数�?*/
  metadata?: Record<string, unknown>;
}

/**
 * 工具调用状�?
 */
export type ToolCallState = 'pending' | 'running' | 'completed' | 'error';

/**
 * 工具调用部分
 */
export interface ToolCallPart extends BaseMessagePart {
  type: 'tool-call';
  /** 调用 ID */
  callID: string;
  /** 工具名称 */
  tool: string;
  /** 状�?*/
  state: ToolCallState;
  /** 输入参数 */
  input?: Record<string, unknown>;
  /** 输出结果 */
  output?: string;
  /** 元数�?*/
  metadata?: {
    /** 标题 */
    title?: string;
    /** 差异信息 */
    diff?: string;
    /** 错误信息 */
    error?: string;
    /** 诊断信息 */
    diagnostics?: unknown;
    [key: string]: unknown;
  };
}

/**
 * 工具结果部分
 */
export interface ToolResultPart extends BaseMessagePart {
  type: 'tool-result';
  /** 调用 ID */
  callID: string;
  /** 工具名称 */
  tool: string;
  /** 结果 */
  result: {
    /** 是否成功 */
    success: boolean;
    /** 输出 */
    output?: string;
    /** 错误 */
    error?: string;
    /** 元数�?*/
    metadata?: Record<string, unknown>;
  };
}

/**
 * 文件部分
 */
export interface FilePart extends BaseMessagePart {
  type: 'file';
  /** MIME 类型 */
  mime: string;
  /** 文件�?*/
  filename?: string;
  /** 文件 URL */
  url: string;
  /** 文件来源 */
  source?: {
    type: 'upload' | 'url' | 'generated';
    [key: string]: unknown;
  };
}

/**
 * 推理部分（AI 思考过程）
 */
export interface ReasoningPart extends BaseMessagePart {
  type: 'reasoning';
  /** 推理文本 */
  text: string;
  /** 元数�?*/
  metadata?: Record<string, unknown>;
  /** 时间信息 */
  time: {
    /** 开始时间（时间戳） */
    start: number;
    /** 结束时间（时间戳�?*/
    end?: number;
  };
}

/**
 * 消息部分联合类型
 */
export type MessagePart = TextPart | ToolCallPart | ToolResultPart | FilePart | ReasoningPart;

// ============================================================================
// 基础消息类型
// ============================================================================

/**
 * 基础消息接口
 *
 * 所有消息类型的公共基础，包含核心字�?
 * 用于�?
 * - Message（会话存储，需�?id, sessionID, createdAt�?
 * - ContextMessage（后端内部上下文管理，需�?tokens, timestamp�?
 */
export interface BaseMessage {
  /** 消息角色 */
  role: MessageRole;
  /** 消息内容（纯文本，用于向后兼容） */
  content: string;
  /** 消息部分（结构化数据�?*/
  parts?: MessagePart[];
}

// ============================================================================
// 完整消息类型（会话存储）
// ============================================================================

/**
 * 消息接口（会话存储）
 *
 * 用于�?
 * - 会话持久化到数据�?
 * - 前后�?API 通信
 * - WebSocket 流式传输
 * - 用户界面展示
 *
 * 继承�?BaseMessage，添加持久化所需的字�?
 */
export interface Message extends BaseMessage {
  /** 消息唯一标识 */
  id: string;
  /** 所属会�?ID */
  sessionID: string;
  /** 创建时间（时间戳�?*/
  createdAt: number;
  /** 时间戳（用于上下文压缩等场景�?*/
  timestamp?: number;
  /** Token 数量（用于上下文管理�?*/
  tokens?: number;
}

// ============================================================================
// 会话创建参数
// ============================================================================

/**
 * 会话创建参数
 */
export interface CreateSessionParams {
  /** 会话标题 */
  title?: string;
  /** 所属用户唯一标识 */
  ownerId?: string;
  /** Agent ID */
  agentId?: string;
  /** 模型提供�?*/
  modelProvider?: string;
  /** 模型 ID */
  modelId?: string;
  /** 用户初始消息 */
  userMessage?: string;
}

/**
 * 会话更新参数
 */
export interface UpdateSessionParams {
  /** 会话标题 */
  title?: string;
  /** 最后更新时间（时间戳） */
  updatedAt?: number;
}

// ============================================================================
// 流式响应类型
// ============================================================================

/**
 * WebSocket 消息类型
 */
export type WSMessageType =
  | 'text_delta'
  | 'tool_call'
  | 'tool_result'
  | 'reasoning_delta'
  | 'done'
  | 'error'
  | 'ping'
  | 'pong';

/**
 * WebSocket 消息基础接口
 */
export interface WSMessage {
  /** 消息类型 */
  type: WSMessageType;
  /** 数据 */
  data?: unknown;
}

/**
 * 文本增量消息
 */
export interface TextDeltaMessage extends WSMessage {
  type: 'text_delta';
  data: string;
}

/**
 * 工具调用消息
 */
export interface ToolCallMessage extends WSMessage {
  type: 'tool_call';
  data: {
    /** 工具名称 */
    toolName: string;
    /** 调用 ID */
    callID: string;
    /** 工具参数 */
    args: Record<string, unknown>;
  };
}

/**
 * 工具结果消息
 */
export interface ToolResultMessage extends WSMessage {
  type: 'tool_result';
  data: {
    /** 工具名称 */
    toolName: string;
    /** 调用 ID */
    callID: string;
    /** 结果标题 */
    title: string;
    /** 结果输出 */
    output: string;
    /** 元数�?*/
    metadata?: Record<string, unknown>;
  };
}

/**
 * 推理增量消息
 */
export interface ReasoningDeltaMessage extends WSMessage {
  type: 'reasoning_delta';
  data: string;
}

/**
 * 完成消息
 */
export interface DoneMessage extends WSMessage {
  type: 'done';
  data?: {
    /** 完成原因 */
    reason?: 'stop' | 'length' | 'tool_calls' | 'error';
    /** 消息 ID */
    messageId?: string;
  };
}

/**
 * 错误消息
 */
export interface ErrorMessage extends WSMessage {
  type: 'error';
  data: {
    /** 错误代码 */
    code?: string;
    /** 错误消息 */
    message: string;
    /** 错误详情 */
    details?: unknown;
  };
}

/**
 * WebSocket 消息联合类型
 */
export type WSMessageUnion =
  | TextDeltaMessage
  | ToolCallMessage
  | ToolResultMessage
  | ReasoningDeltaMessage
  | DoneMessage
  | ErrorMessage;

// ============================================================================
// 会话统计信息
// ============================================================================

/**
 * 会话统计信息
 */
export interface SessionStats {
  /** 会话 ID */
  sessionID: string;
  /** 消息总数 */
  messageCount: number;
  /** 用户消息�?*/
  userMessageCount: number;
  /** 助手消息�?*/
  assistantMessageCount: number;
  /** 工具调用总数 */
  toolCallCount: number;
  /** 创建时间（时间戳�?*/
  createdAt: number;
  /** 最后活动时间（时间戳） */
  lastActivityAt: number;
}
