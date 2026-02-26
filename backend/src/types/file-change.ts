/**
 * File Change Types - 文件操作类型定义
 *
 * 定义文件操作指令和执行结果的结构
 */

/**
 * 文件操作类型
 */
export type FileAction = 'CREATE' | 'UPDATE' | 'DELETE';

/**
 * 文件操作指令元数据
 */
export interface FileChangeMetadata {
  /** 是否覆盖已存在的文件 (仅用于 CREATE) */
  overwrite?: boolean;

  /** 是否备份文件 (默认 true，用于 UPDATE 和 DELETE) */
  backup?: boolean;

  /** 依赖的文件路径 (用于拓扑排序) */
  dependencies?: string[];

  /** 文件编码 (默认 utf-8) */
  encoding?: BufferEncoding;
}

/**
 * 文件操作指令
 *
 * 描述对单个文件的操作
 */
export interface FileChangeInstruction {
  /** 指令唯一标识符 */
  id: string;

  /** 操作类型 */
  action: FileAction;

  /** 文件相对路径 */
  path: string;

  /** 文件内容 (用于 CREATE 和 UPDATE) */
  content?: string;

  /** 元数据 */
  metadata?: FileChangeMetadata;
}

/**
 * 执行结果
 *
 * 文件操作指令的执行结果
 */
export interface ExecuteResult {
  /** 是否成功 */
  success: boolean;

  /** 执行的指令 */
  instruction: FileChangeInstruction;

  /** 实际文件路径 */
  actualPath?: string;

  /** 备份文件路径 */
  backupPath?: string;

  /** 错误信息 */
  error?: Error;

  /** 执行耗时 (毫秒) */
  duration?: number;
}

/**
 * 失败的指令信息
 */
export interface FailedInstruction {
  /** 指令 */
  instruction: FileChangeInstruction;
  /** 错误信息 */
  error: Error;
}

/**
 * 文件事务
 *
 * 用于批量执行文件操作，支持回滚
 */
export interface FileTransaction {
  /** 事务 ID */
  id: string;

  /** 指令列表 */
  instructions: FileChangeInstruction[];

  /** 状态 */
  status: 'pending' | 'executing' | 'completed' | 'rolled_back' | 'failed' | 'cancelled';

  /** 已执行的指令 */
  executed: FileChangeInstruction[];

  /** 失败的指令 */
  failed?: FailedInstruction[];

  /** 回滚数据 */
  rollbackData?: Map<string, string>;

  /** 开始时间 */
  startTime: number;

  /** 结束时间 */
  endTime?: number;

  /** 错误信息 */
  error?: Error;
}
