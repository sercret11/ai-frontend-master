/**
 * Context Types - 上下文管理类型定义
 *
 * @internal
 *
 * 定义上下文构建和管理相关的类型
 * 这些类型仅用于后端内部实现，不应被外部使用
 */

import type { BaseMessage } from '@ai-frontend/shared-types';

/**
 * 提示词章节
 */
export interface Section {
  id: string;
  title: string;
  content: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  tags?: string[];
  tokens?: number | undefined;
}

/**
 * 技能
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tokens?: number | undefined;
}

/**
 * 上下文消息（内部类型）
 *
 * @internal
 *
 * 用于后端内部上下文构建和管理的消息类型
 * 继承自 BaseMessage，添加运行时所需的字段
 *
 * 与 Message 的区别：
 * - Message: 用于会话存储和 API 通信，需要 id, sessionID, createdAt
 * - ContextMessage: 用于上下文构建和 token 计算，需要 tokens, timestamp
 *
 * 使用场景：
 * - 上下文压缩（Compaction）
 * - 上下文修剪（Pruning）
 * - Token 计数和预算控制
 *
 * @example
 * ```typescript
 * // 创建上下文消息（运行时）
 * const ctxMsg: ContextMessage = {
 *   role: 'user',
 *   content: 'Hello',
 *   tokens: 5,  // 运行时计算的
 *   timestamp: Date.now(),
 * };
 *
 * // 转换为持久化消息
 * const msg: Message = {
 *   ...ctxMsg,
 *   id: generateId(),
 *   sessionID: 'session-123',
 *   createdAt: ctxMsg.timestamp || Date.now(),
 * };
 * ```
 */
export interface ContextMessage extends BaseMessage {
  /** Token 计数（运行时计算，不持久化） */
  tokens?: number;
  /** 时间戳（灵活的时间标记，可选） */
  timestamp?: number;
  /** 消息 ID（可选，上下文构建时可能尚未分配） */
  id?: string;
}

/**
 * 压缩检查点
 */
export interface CompactionCheckpoint {
  id?: string;
  timestamp: number;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  summary?: string;
  savedTokens?: number;
  topics?: string[];
  actionItems?: string[];
  technicalDecisions?: string[];
  messageCount?: number;
}

/**
 * 压缩结果
 */
export interface CompactionResult {
  compressed: boolean;
  originalContent: string;
  compressedContent: string;
  checkpoint?: CompactionCheckpoint;
  messages?: ContextMessage[];
  savedTokens?: number;
}

/**
 * 修剪配置
 */
export interface PruningConfig {
  maxTokens?: number;
  preserveRecent?: number;
  preserveImportant?: boolean;
  protectWindow?: number;
  minSavings?: number;
  protectedTools?: string[];
}

/**
 * 修剪后的上下文
 */
export interface PrunedContext {
  content: string;
  removed: string[];
  kept: string[];
  messages?: ContextMessage[];
  stats: {
    originalTokens: number;
    prunedTokens: number;
    savedTokens: number;
  };
  savedTokens?: number;
  prunedCount?: number;
}

/**
 * 选中章节
 */
export interface SelectedSection {
  section: Section;
  relevance: number;
  reason: string;
  name?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
}

/**
 * 选择请求
 */
export interface SelectionRequest {
  userInput: string;
  mode?: 'creator' | 'implementer';
  maxSections?: number;
  maxTokens?: number;
  platform?: string;
  availableSections: Section[];
  techStack?: string[];
  customSections?: Section[];
}

/**
 * 选择结果
 */
export interface SelectionResult {
  selected: SelectedSection[];
  totalRelevance: number;
  count: number;
  totalTokens?: number;
  sections?: Section[];
}

/**
 * 上下文构建请求
 */
export interface ContextBuildRequest {
  /** 会话 ID */
  sessionID: string;

  /** 用户输入 */
  userInput?: string;

  /** 模式 */
  mode?: 'creator' | 'implementer';

  /** 技术栈 */
  techStack?: string[];

  /** 平台 */
  platform?: string;

  /** 最大 token 数 */
  maxTokens?: number;

  /** 额外参数 */
  args?: Record<string, any>;
}

/**
 * 构建的上下文结果
 */
export interface BuiltContext {
  /** 系统提示词 */
  systemPrompt: string;

  /** 选中的章节 */
  sections: any[];

  /** 技能注入 */
  skills: any[];

  /** 会话消息 */
  messages: any[];

  /** token 数量 */
  tokens: number;

  /** 元数据 */
  metadata: {
    /** 是否压缩过 */
    compressed?: boolean;

    /** 是否修剪过 */
    pruned?: boolean;

    /** 构建耗时 */
    buildTime?: number;
  };
}

/**
 * 会话信息
 */
export interface Session {
  /** 会话 ID */
  id: string;

  /** 创建时间 */
  createdAt: number;

  /** 更新时间 */
  updatedAt: number;

  /** 消息列表 */
  messages: ContextMessage[];

  /** 配置 */
  config?: {
    mode?: 'creator' | 'implementer';
    techStack?: string[];
    platform?: string;
    maxTokens?: number;
    compressionThreshold?: number;
  };

  /** 元数据 */
  metadata?: Record<string, any>;
}
