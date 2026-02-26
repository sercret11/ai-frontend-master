/**
 * File Storage Types - 文件存储相关类型定义
 * 用于项目文件的持久化存储和检索
 */

// ============================================================================
// 存储的文件类型
// ============================================================================

/**
 * 存储的项目文件
 */
export interface StoredFile {
  /** 文件唯一标识 */
  id: string;
  /** 所属会话 ID */
  sessionID: string;
  /** 文件路径（相对于项目根目录） */
  path: string;
  /** 文件内容 */
  content: string;
  /** 文件语言/类型 */
  language: string;
  /** 文件大小（字节） */
  size: number;
  /** 创建时间（时间戳） */
  createdAt: number;
}

// ============================================================================
// 批量操作类型
// ============================================================================

/**
 * 创建文件选项
 */
export interface CreateFileOptions {
  /** 文件路径 */
  path: string;
  /** 文件内容 */
  content: string;
  /** 文件语言（可选，自动从路径推断） */
  language?: string;
}

/**
 * 文件批量响应
 */
export interface FileBatchResponse {
  /** 会话 ID */
  sessionID: string;
  /** 文件列表 */
  files: StoredFile[];
  /** 分页信息 */
  pagination: {
    /** 当前页码 */
    page: number;
    /** 每页记录数 */
    limit: number;
    /** 总记录数 */
    total: number;
    /** 总页数 */
    totalPages: number;
    /** 是否有下一页 */
    hasNext: boolean;
    /** 是否有上一页 */
    hasPrev: boolean;
  };
}

// ============================================================================
// 文件统计类型
// ============================================================================

/**
 * 文件存储统计信息
 */
export interface FileStorageStats {
  /** 会话 ID */
  sessionID: string;
  /** 文件总数 */
  fileCount: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 按语言分组的文件数量 */
  filesByLanguage: Record<string, number>;
  /** 最早文件创建时间 */
  oldestFileCreatedAt?: number;
  /** 最新文件创建时间 */
  newestFileCreatedAt?: number;
}

// ============================================================================
// 文件查询参数
// ============================================================================

/**
 * 文件查询参数
 */
export interface FileQueryParams {
  /** 页码（从1开始，默认1） */
  page?: number;
  /** 每页记录数（默认50） */
  limit?: number;
  /** 按路径搜索（模糊匹配） */
  search?: string;
  /** 按语言过滤 */
  language?: string;
  /** 排序字段 */
  sortBy?: 'path' | 'size' | 'createdAt' | 'language';
  /** 排序方向 */
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// SSE 事件类型（轻量级文件通知）
// ============================================================================

/**
 * SSE 完成事件（包含文件数量）
 */
export interface SessionCompletionEvent {
  /** 会话 ID */
  sessionID: string;
  /** 消息 ID */
  messageID: string;
  /** 完成原因 */
  reason?: 'stop' | 'length' | 'tool_calls' | 'error';
  /** 生成的文件数量 */
  filesCount?: number;
}

// ============================================================================
// 工具结果到文件的转换
// ============================================================================

/**
 * 从工具结果解析的文件
 */
export interface ParsedFile {
  /** 文件路径 */
  path: string;
  /** 文件内容 */
  content: string;
  /** 文件语言 */
  language: string;
}

/**
 * 文件解析结果
 */
export interface FileParseResult {
  /** 解析的文件列表 */
  files: ParsedFile[];
  /** 解析的文件数量 */
  count: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
}
