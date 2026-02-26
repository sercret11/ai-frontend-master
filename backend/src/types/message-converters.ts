/**
 * Message Conversion Utilities
 *
 * 提供在 Message 类型之间转换的工具函数
 *
 * @internal
 */

import type { Message } from '@ai-frontend/shared-types';
import type { ContextMessage } from './context';

/**
 * 将 ContextMessage 转换为 Message
 *
 * 用于：上下文构建完成后，持久化到数据库
 *
 * @param ctxMsg - 上下文消息
 * @param sessionID - 会话 ID
 * @returns 完整的 Message 对象
 *
 * @example
 * ```typescript
 * const ctxMsg: ContextMessage = { role: 'user', content: 'Hello', tokens: 5 };
 * const msg = toMessage(ctxMsg, 'session-123');
 * // { id: 'auto-generated', sessionID: 'session-123', role: 'user', content: 'Hello', createdAt: ..., tokens: 5 }
 * ```
 */
export function toMessage(
  ctxMsg: ContextMessage,
  sessionID: string,
  generateId?: () => string
): Message {
  const id = ctxMsg.id || generateId?.() || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const createdAt = ctxMsg.timestamp || Date.now();

  return {
    id,
    sessionID,
    role: ctxMsg.role,
    content: ctxMsg.content,
    parts: ctxMsg.parts,
    createdAt,
  };
}

/**
 * 将 Message 转换为 ContextMessage
 *
 * 用于：从数据库加载消息后，用于上下文构建
 *
 * @param msg - 完整的 Message 对象
 * @returns ContextMessage 对象（不包含 tokens）
 *
 * @example
 * ```typescript
 * const msg: Message = { id: '123', sessionID: 's-1', role: 'user', content: 'Hello', createdAt: ... };
 * const ctxMsg = toContextMessage(msg);
 * // { role: 'user', content: 'Hello', id: '123', timestamp: msg.createdAt }
 * ```
 */
export function toContextMessage(msg: Message): ContextMessage {
  return {
    role: msg.role,
    content: msg.content,
    parts: msg.parts,
    id: msg.id,
    timestamp: msg.createdAt,
  };
}

/**
 * 批量转换 ContextMessage 到 Message
 *
 * @param ctxMessages - 上下文消息数组
 * @param sessionID - 会话 ID
 * @returns Message 数组
 */
export function batchToMessages(
  ctxMessages: ContextMessage[],
  sessionID: string
): Message[] {
  return ctxMessages.map((ctxMsg, index) =>
    toMessage(ctxMsg, sessionID, () => `msg-${sessionID}-${index}`)
  );
}

/**
 * 批量转换 Message 到 ContextMessage
 *
 * @param messages - Message 数组
 * @returns ContextMessage 数组
 */
export function batchToContextMessages(messages: Message[]): ContextMessage[] {
  return messages.map(toContextMessage);
}
