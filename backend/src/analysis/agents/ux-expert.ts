/**
 * UXExpertAgent - UX 专家智能体
 *
 * 负责设计交互流程、用户旅程和可用性建议。
 * 接收产品需求经理、前端架构师和 UI 专家的文档作为上下文。
 *
 * 需求: R1.5, R11.4
 */

import type {
  AnalysisAgent,
  AnalysisContext,
  UXExpertDocument,
  ProductManagerDocument,
  FrontendArchitectDocument,
  UIExpertDocument,
  SessionDocument,
} from '../types.js';
import { extractJsonFromOutput, generateId } from './types.js';

export class UXExpertAgent implements AnalysisAgent {
  readonly id = 'ux-expert' as const;
  readonly title = 'UX 专家';

  /**
   * 构建 UX 设计 prompt
   *
   * 接收产品需求经理、前端架构师和 UI 专家的 SessionDocument 作为上下文。
   */
  buildPrompt(context: AnalysisContext): string {
    // 提取前序文档
    const pmDoc = context.previousDocuments.find(
      (doc): doc is ProductManagerDocument => doc.agentId === 'product-manager',
    );
    const archDoc = context.previousDocuments.find(
      (doc): doc is FrontendArchitectDocument =>
        doc.agentId === 'frontend-architect',
    );
    const uiDoc = context.previousDocuments.find(
      (doc): doc is UIExpertDocument => doc.agentId === 'ui-expert',
    );

    const requirementsContext = pmDoc
      ? this.formatPMDocument(pmDoc)
      : '无产品需求文档';

    const architectureContext = archDoc
      ? this.formatArchDocument(archDoc)
      : '无架构设计文档';

    const uiContext = uiDoc ? this.formatUIDocument(uiDoc) : '无 UI 设计文档';

    const platformInfo = context.platform
      ? `目标平台: ${context.platform}`
      : '目标平台: Web';

    return `你是一位资深的 UX 设计专家，专注于用户体验和交互设计。

## 任务
基于产品需求、架构设计和 UI 规范，制定交互流程和用户体验方案。

## 用户原始需求
${context.userMessage}

## 产品需求分析
${requirementsContext}

## 架构设计
${architectureContext}

## UI 设计规范
${uiContext}

## 项目信息
${platformInfo}

## 输出要求
请以 JSON 格式输出，包含以下结构：

\`\`\`json
{
  "interactionFlows": [
    {
      "id": "flow-001",
      "name": "流程名称",
      "steps": [
        {
          "action": "用户操作",
          "expectedResult": "预期结果",
          "errorHandling": "错误处理方式"
        }
      ]
    }
  ],
  "userJourneys": [
    {
      "id": "journey-001",
      "persona": "用户角色",
      "touchpoints": ["触点1", "触点2"],
      "painPoints": ["痛点1", "痛点2"]
    }
  ],
  "usabilityRecommendations": [
    {
      "area": "改进领域",
      "recommendation": "具体建议",
      "priority": "high" | "medium" | "low"
    }
  ]
}
\`\`\`

## 设计指南
1. 交互流程应覆盖主要用户操作场景
2. 用户旅程应从不同用户角色的视角描述
3. 可用性建议应具体、可执行
4. 考虑错误状态和边界情况的处理

请直接输出 JSON，不要包含其他解释文字。`;
  }

  /**
   * 解析 LLM 输出为 UXExpertDocument
   */
  parseOutput(raw: string): SessionDocument {
    const parsed = extractJsonFromOutput(raw) as {
      interactionFlows?: Array<{
        id?: string;
        name?: string;
        steps?: Array<{
          action?: string;
          expectedResult?: string;
          errorHandling?: string;
        }>;
      }>;
      userJourneys?: Array<{
        id?: string;
        persona?: string;
        touchpoints?: string[];
        painPoints?: string[];
      }>;
      usabilityRecommendations?: Array<{
        area?: string;
        recommendation?: string;
        priority?: string;
      }>;
    };

    // 验证并规范化交互流程
    const interactionFlows = (parsed.interactionFlows ?? []).map(
      (flow, index) => ({
        id: flow.id ?? `flow-${String(index + 1).padStart(3, '0')}`,
        name: flow.name ?? `Flow ${index + 1}`,
        steps: (flow.steps ?? []).map((step) => ({
          action: step.action ?? '',
          expectedResult: step.expectedResult ?? '',
          ...(step.errorHandling && { errorHandling: step.errorHandling }),
        })),
      }),
    );

    // 验证并规范化用户旅程
    const userJourneys = (parsed.userJourneys ?? []).map((journey, index) => ({
      id: journey.id ?? `journey-${String(index + 1).padStart(3, '0')}`,
      persona: journey.persona ?? 'User',
      touchpoints: journey.touchpoints ?? [],
      painPoints: journey.painPoints ?? [],
    }));

    // 验证并规范化可用性建议
    const usabilityRecommendations = (
      parsed.usabilityRecommendations ?? []
    ).map((rec) => ({
      area: rec.area ?? '',
      recommendation: rec.recommendation ?? '',
      priority: this.normalizePriority(rec.priority),
    }));

    const document: UXExpertDocument = {
      id: generateId(),
      agentId: 'ux-expert',
      createdAt: Date.now(),
      version: 1,
      content: {
        interactionFlows,
        userJourneys,
        usabilityRecommendations,
      },
    };

    return document;
  }

  private formatPMDocument(doc: ProductManagerDocument): string {
    const stories = doc.content.userStories
      .map((s) => `- 作为${s.persona}，我希望${s.goal}，以便${s.benefit}`)
      .join('\n');

    return `### 用户故事
${stories}`;
  }

  private formatArchDocument(doc: FrontendArchitectDocument): string {
    const routes = doc.content.routeDesign
      .map((r) => `- ${r.path}`)
      .join('\n');

    return `### 页面路由
${routes}`;
  }

  private formatUIDocument(doc: UIExpertDocument): string {
    const breakpoints = Object.entries(doc.content.responsiveLayout.breakpoints)
      .map(([name, value]) => `- ${name}: ${value}px`)
      .join('\n');

    return `### 响应式断点
${breakpoints}

### 布局策略
${doc.content.responsiveLayout.strategy}`;
  }

  private normalizePriority(priority?: string): 'high' | 'medium' | 'low' {
    const normalized = priority?.toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
      return normalized;
    }
    return 'medium';
  }
}
