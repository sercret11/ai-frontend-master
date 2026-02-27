/**
 * ProductManagerAgent - 产品需求经理智能体
 *
 * 负责分析用户需求，产出功能需求列表、用户故事和优先级排序。
 * 作为分析层管线的第一个智能体，不接收前序文档。
 *
 * 需求: R1.1, R11.1
 */

import type {
  AnalysisAgent,
  AnalysisContext,
  ProductManagerDocument,
  SessionDocument,
} from '../types.js';
import { extractJsonFromOutput, generateId } from './types.js';

export class ProductManagerAgent implements AnalysisAgent {
  readonly id = 'product-manager' as const;
  readonly title = '产品需求经理';

  /**
   * 构建产品需求分析 prompt
   *
   * 输入上下文包含用户消息、平台和技术栈信息。
   * 作为第一个智能体，previousDocuments 应为空数组。
   */
  buildPrompt(context: AnalysisContext): string {
    const platformInfo = context.platform
      ? `目标平台: ${context.platform}`
      : '目标平台: Web';

    const techStackInfo = context.techStack?.length
      ? `技术栈: ${context.techStack.join(', ')}`
      : '';

    return `你是一位资深的产品需求经理，专注于前端应用的需求分析。

## 任务
分析以下用户需求，产出结构化的产品需求文档。

## 用户需求
${context.userMessage}

## 项目信息
${platformInfo}
${techStackInfo}

## 输出要求
请以 JSON 格式输出，包含以下结构：

\`\`\`json
{
  "functionalRequirements": [
    {
      "id": "FR-001",
      "title": "需求标题",
      "description": "详细描述",
      "priority": "high" | "medium" | "low"
    }
  ],
  "userStories": [
    {
      "id": "US-001",
      "persona": "用户角色",
      "goal": "用户目标",
      "benefit": "预期收益"
    }
  ],
  "priorityOrder": ["FR-001", "FR-002"]
}
\`\`\`

## 分析指南
1. 功能需求应覆盖用户描述的所有核心功能
2. 用户故事应从不同用户角色的视角描述需求
3. 优先级排序应基于业务价值和技术依赖关系
4. 每个需求应有清晰、可验证的描述

请直接输出 JSON，不要包含其他解释文字。`;
  }

  /**
   * 解析 LLM 输出为 ProductManagerDocument
   */
  parseOutput(raw: string): SessionDocument {
    const parsed = extractJsonFromOutput(raw) as {
      functionalRequirements?: Array<{
        id?: string;
        title?: string;
        description?: string;
        priority?: string;
      }>;
      userStories?: Array<{
        id?: string;
        persona?: string;
        goal?: string;
        benefit?: string;
      }>;
      priorityOrder?: string[];
    };

    // 验证并规范化功能需求
    const functionalRequirements = (parsed.functionalRequirements ?? []).map(
      (req, index) => ({
        id: req.id ?? `FR-${String(index + 1).padStart(3, '0')}`,
        title: req.title ?? 'Untitled Requirement',
        description: req.description ?? '',
        priority: this.normalizePriority(req.priority),
      }),
    );

    // 验证并规范化用户故事
    const userStories = (parsed.userStories ?? []).map((story, index) => ({
      id: story.id ?? `US-${String(index + 1).padStart(3, '0')}`,
      persona: story.persona ?? 'User',
      goal: story.goal ?? '',
      benefit: story.benefit ?? '',
    }));

    // 验证优先级排序
    const priorityOrder = parsed.priorityOrder ?? functionalRequirements.map((r) => r.id);

    const document: ProductManagerDocument = {
      id: generateId(),
      agentId: 'product-manager',
      createdAt: Date.now(),
      version: 1,
      content: {
        functionalRequirements,
        userStories,
        priorityOrder,
      },
    };

    return document;
  }

  private normalizePriority(priority?: string): 'high' | 'medium' | 'low' {
    const normalized = priority?.toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
      return normalized;
    }
    return 'medium';
  }
}
