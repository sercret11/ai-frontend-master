/**
 * Tool Types - 工具系统类型定义
 * 定义工具调用、注册和执行的所有类型
 */

import { z } from 'zod';

// ============================================================================
// 工具元数据
// ============================================================================

/**
 * 工具元数据接口
 */
export interface ToolMetadata {
  /** 元数据键值对 */
  [key: string]: unknown;
}

// ============================================================================
// 工具上下文
// ============================================================================

/**
 * 工具初始化上下文
 */
export interface ToolInitContext {
  /** Agent ID */
  agent?: string;
}

/**
 * 权限请求接口
 */
export interface PermissionRequest {
  /** 权限类型 */
  permission: string;
  /** 权限模式数组 */
  patterns: string[];
  /** 元数据 */
  metadata?: {
    /** 差异信息 */
    diff?: string;
    /** 标题 */
    title?: string;
    /** 文件路径 */
    filePath?: string;
    [key: string]: unknown;
  };
}

/**
 * 工具执行上下文
 */
export interface ToolContext<M extends ToolMetadata = ToolMetadata> {
  /** 会话 ID */
  sessionID: string;
  /** 消息 ID */
  messageID: string;
  /** Agent ID */
  agent: string;
  /** 中止信号 */
  abort: AbortSignal;
  /** 调用 ID */
  callID?: string;
  /** 设置元数据 */
  metadata(input: { title?: string; metadata?: M }): void;
  /** 请求权限 */
  ask(input: PermissionRequest): Promise<void>;
  /** 工具调用回调（在工具执行时立即触发） */
  onToolCall?: (call: { toolName: string; callID: string; args: Record<string, unknown> }) => void;
  /** 工具结果回调（在工具执行完成时触发） */
  onToolResult?: (result: {
    toolName: string;
    callID: string;
    title: string;
    output: string;
    metadata?: M;
  }) => void;
}

// ============================================================================
// 工具信息
// ============================================================================

/**
 * Zod 参数类型
 */
export type ToolParameters<T extends z.ZodType = z.ZodType> = T;

/**
 * 工具执行结果
 */
export interface ToolExecutionResult<M extends ToolMetadata = ToolMetadata> {
  /** 结果标题 */
  title: string;
  /** 结果输出 */
  output: string;
  /** 元数据 */
  metadata: M;
}

/**
 * 工具初始化结果
 */
export interface ToolInitResult<
  Parameters extends z.ZodTypeAny = z.ZodTypeAny,
  M extends ToolMetadata = ToolMetadata
> {
  /** 工具描述 */
  description: string;
  /** 参数 schema */
  parameters: Parameters;
  /** 执行函数 */
  execute(
    args: z.infer<Parameters>,
    ctx: ToolContext<M>
  ): Promise<ToolExecutionResult<M>>;
  /** 格式化验证错误 */
  formatValidationError?(error: z.ZodError): string;
}

/**
 * 工具信息接口
 */
export interface ToolInfo<Parameters extends z.ZodTypeAny = z.ZodTypeAny, M extends ToolMetadata = ToolMetadata> {
  /** 工具 ID */
  id: string;
  /** 初始化函数 */
  init: (ctx?: ToolInitContext) => Promise<ToolInitResult<Parameters, M>>;
}

/**
 * 工具定义工厂函数类型
 */
export type ToolDefineFunction<
  Parameters extends z.ZodTypeAny = z.ZodTypeAny,
  M extends ToolMetadata = ToolMetadata
> = (
  id: string,
  init: ToolInfo<Parameters, M>['init']
) => ToolInfo<Parameters, M>;

// ============================================================================
// 工具注册
// ============================================================================

/**
 * 工具注册信息
 */
export interface ToolRegistration {
  /** 工具 ID */
  id: string;
  /** 工具信息 */
  info: ToolInfo<any, any>;
  /** 是否启用 */
  enabled: boolean;
  /** 支持的提供商 */
  supportedProviders?: string[];
}

/**
 * 工具过滤器选项
 */
export interface ToolFilterOptions {
  /** 提供商 ID */
  providerID?: string;
  /** 模型 ID */
  modelID?: string;
  /** Agent ID */
  agentID?: string;
  /** 是否只返回启用的工具 */
  enabledOnly?: boolean;
}

// ============================================================================
// 工具执行
// ============================================================================

/**
 * 工具调用请求
 */
export interface ToolCallRequest {
  /** 工具名称 */
  toolName: string;
  /** 调用 ID */
  callID: string;
  /** 工具参数 */
  args: Record<string, unknown>;
}

/**
 * 工具调用结果
 */
export interface ToolCallResponse {
  /** 工具名称 */
  toolName: string;
  /** 调用 ID */
  callID: string;
  /** 结果标题 */
  title: string;
  /** 结果输出 */
  output: string;
  /** 元数据 */
  metadata?: ToolMetadata;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * 工具执行选项
 */
export interface ToolExecuteOptions {
  /** 会话 ID */
  sessionID: string;
  /** 消息 ID */
  messageID: string;
  /** Agent ID */
  agent: string;
  /** 中止信号 */
  abort: AbortSignal;
  /** 超时时间（毫秒） */
  timeout?: number;
}

// ============================================================================
// 常用工具元数据类型
// ============================================================================

/**
 * 文件操作元数据
 */
export interface FileOperationMetadata extends ToolMetadata {
  /** 文件路径 */
  filePath?: string;
  /** 相对路径 */
  relativePath?: string;
  /** 文件大小 */
  fileSize?: number;
  /** 行数 */
  lineCount?: number;
  /** 是否被截断 */
  truncated?: boolean;
  /** 差异信息 */
  diff?: string;
  /** 诊断信息 */
  diagnostics?: Array<{
    /** 文件路径 */
    filePath: string;
    /** 行号 */
    line: number;
    /** 列号 */
    column: number;
    /** 严重性 */
    severity: 'error' | 'warning' | 'info' | 'hint';
    /** 消息 */
    message: string;
  }>;
}

/**
 * 搜索操作元数据
 */
export interface SearchOperationMetadata extends ToolMetadata {
  /** 搜索域名 */
  domain?: string;
  /** 搜索查询 */
  query?: string;
  /** 结果数量 */
  count?: number;
  /** 最大结果数 */
  maxResults?: number;
  /** 匹配分数 */
  score?: number;
}

/**
 * 命令执行元数据
 */
export interface CommandExecutionMetadata extends ToolMetadata {
  /** 命令 */
  command?: string;
  /** 工作目录 */
  cwd?: string;
  /** 退出代码 */
  exitCode?: number;
  /** 标准输出长度 */
  stdoutLength?: number;
  /** 标准错误长度 */
  stderrLength?: number;
  /** 执行时间（毫秒） */
  duration?: number;
}

/**
 * 设计搜索元数据
 */
export interface DesignSearchMetadata extends ToolMetadata {
  /** 设计资源类型 */
  resourceType?: 'style' | 'color' | 'typography' | 'chart' | 'product' | 'ux';
  /** 设计风格 */
  style?: string;
  /** 色板 */
  palette?: string;
  /** 字体组合 */
  typography?: string;
  /** 匹配分数 */
  score?: number;
  /** BM25 相似度 */
  similarity?: number;
}

// ============================================================================
// 工具状态
// ============================================================================

/**
 * 工具执行状态
 */
export type ToolExecutionStatus =
  | 'started'
  | 'pending'
  | 'executing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout';

/**
 * 工具状态信息
 */
export interface ToolStatus {
  /** 工具名称 */
  toolName: string;
  /** 调用 ID */
  callID: string;
  /** 状态 */
  status: ToolExecutionStatus;
  /** 开始时间（时间戳） */
  startTime?: number;
  /** 结束时间（时间戳） */
  endTime?: number;
  /** 执行时长（毫秒） */
  duration?: number;
  /** 错误消息（如果失败） */
  error?: string;
}

// ============================================================================
// 工具结果事件
// ============================================================================

/**
 * 工具结果事件接口
 * 用于在工具执行完成后通过 SSE 发送完整结果
 */
export interface ToolResultEvent<M extends ToolMetadata = ToolMetadata> {
  /** 工具名称 */
  toolName: string;
  /** 调用 ID */
  callID: string;
  /** 结果标题 */
  title: string;
  /** 结果输出（完整的工具返回值） */
  output: string;
  /** 元数据 */
  metadata?: M;
}

// ============================================================================
// 导出所有类型
// ============================================================================

// 注意：所有类型已在前面通过 export interface 定义，此处无需重复导出
