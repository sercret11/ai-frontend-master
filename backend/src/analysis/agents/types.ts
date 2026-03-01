/**
 * 分析智能体共享类型
 *
 * 提供分析智能体实现所需的辅助类型和常量。
 */

import type { AnalysisAgentID } from '../types.js';

/** 智能体执行顺序 */
export const ANALYSIS_AGENT_ORDER: readonly AnalysisAgentID[] = [
  'product-manager',
  'frontend-architect',
  'ui-expert',
  'ux-expert',
] as const;

/** JSON 解析辅助函数 - 从 LLM 输出中提取 JSON */
export function extractJsonFromOutput(raw: string): unknown {
  // 尝试直接解析
  try {
    return JSON.parse(raw);
  } catch {
    // 继续尝试其他方式
  }

  // 尝试从 markdown 代码块中提取
  const jsonBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // 继续尝试其他方式
    }
  }

  // 尝试找到第一个 { 和最后一个 } 之间的内容
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    } catch {
      // 解析失败
    }
  }

  throw new Error('Failed to extract JSON from LLM output');
}

/** 生成唯一 ID */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
