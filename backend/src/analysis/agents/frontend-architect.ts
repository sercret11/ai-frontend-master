/**
 * FrontendArchitectAgent - 前端架构师智能体
 *
 * 负责设计组件树结构、路由设计和状态管理方案。
 * 接收产品需求经理的文档作为上下文。
 *
 * 需求: R1.3, R11.2
 */

import type {
  AnalysisAgent,
  AnalysisContext,
  FrontendArchitectDocument,
  ProductManagerDocument,
  SessionDocument,
} from '../types.js';
import { extractJsonFromOutput, generateId } from './types.js';

export class FrontendArchitectAgent implements AnalysisAgent {
  readonly id = 'frontend-architect' as const;
  readonly title = '前端架构师';

  /**
   * 构建架构设计 prompt
   *
   * 接收产品需求经理的 SessionDocument 作为上下文。
   */
  buildPrompt(context: AnalysisContext): string {
    // 提取产品需求经理文档
    const pmDoc = context.previousDocuments.find(
      (doc): doc is ProductManagerDocument => doc.agentId === 'product-manager',
    );

    const requirementsContext = pmDoc
      ? this.formatPMDocument(pmDoc)
      : '无产品需求文档';

    const platformInfo = context.platform
      ? `目标平台: ${context.platform}`
      : '目标平台: Web';

    const techStackInfo = context.techStack?.length
      ? `技术栈: ${context.techStack.join(', ')}`
      : '技术栈: React + TypeScript';

    return `你是一位资深的前端架构师，专注于 React 应用的架构设计。

## 任务
基于产品需求文档，设计前端应用的架构方案。

## 用户原始需求
${context.userMessage}

## 产品需求分析
${requirementsContext}

## 项目信息
${platformInfo}
${techStackInfo}

## 输出要求
请以 JSON 格式输出，包含以下结构：

\`\`\`json
{
  "componentTree": [
    {
      "id": "comp-001",
      "name": "ComponentName",
      "type": "page" | "layout" | "component" | "widget",
      "children": ["comp-002"],
      "props": { "propName": "propType" }
    }
  ],
  "routeDesign": [
    {
      "path": "/path",
      "componentId": "comp-001",
      "guard": "authGuard"
    }
  ],
  "stateManagement": {
    "approach": "zustand" | "context" | "redux" | "jotai",
    "stores": [
      {
        "name": "storeName",
        "description": "store 描述",
        "fields": { "fieldName": "fieldType" }
      }
    ]
  }
}
\`\`\`

## 设计指南
1. 组件树应体现清晰的层次结构（页面 → 布局 → 组件 → 小部件）
2. 路由设计应覆盖所有页面级组件
3. 状态管理方案应根据应用复杂度选择合适的方案
4. 组件命名应遵循 PascalCase 规范

请直接输出 JSON，不要包含其他解释文字。`;
  }

  /**
   * 解析 LLM 输出为 FrontendArchitectDocument
   */
  parseOutput(raw: string): SessionDocument {
    const parsed = extractJsonFromOutput(raw) as {
      componentTree?: Array<{
        id?: string;
        name?: string;
        type?: string;
        children?: string[];
        props?: Record<string, string>;
      }>;
      routeDesign?: Array<{
        path?: string;
        componentId?: string;
        guard?: string;
      }>;
      stateManagement?: {
        approach?: string;
        stores?: Array<{
          name?: string;
          description?: string;
          fields?: Record<string, string>;
        }>;
      };
    };

    // 验证并规范化组件树
    const componentTree = (parsed.componentTree ?? []).map((comp, index) => ({
      id: comp.id ?? `comp-${String(index + 1).padStart(3, '0')}`,
      name: comp.name ?? `Component${index + 1}`,
      type: this.normalizeComponentType(comp.type),
      children: comp.children ?? [],
      ...(comp.props && { props: comp.props }),
    }));

    // 验证并规范化路由设计
    const routeDesign = (parsed.routeDesign ?? []).map((route) => ({
      path: route.path ?? '/',
      componentId: route.componentId ?? '',
      ...(route.guard && { guard: route.guard }),
    }));

    // 验证并规范化状态管理
    const stateManagement = {
      approach: this.normalizeStateApproach(parsed.stateManagement?.approach),
      stores: (parsed.stateManagement?.stores ?? []).map((store) => ({
        name: store.name ?? 'store',
        description: store.description ?? '',
        fields: store.fields ?? {},
      })),
    };

    const document: FrontendArchitectDocument = {
      id: generateId(),
      agentId: 'frontend-architect',
      createdAt: Date.now(),
      version: 1,
      content: {
        componentTree,
        routeDesign,
        stateManagement,
      },
    };

    return document;
  }

  private formatPMDocument(doc: ProductManagerDocument): string {
    const requirements = doc.content.functionalRequirements
      .map((r) => `- [${r.priority}] ${r.title}: ${r.description}`)
      .join('\n');

    const stories = doc.content.userStories
      .map((s) => `- 作为${s.persona}，我希望${s.goal}，以便${s.benefit}`)
      .join('\n');

    return `### 功能需求
${requirements}

### 用户故事
${stories}

### 优先级排序
${doc.content.priorityOrder.join(' → ')}`;
  }

  private normalizeComponentType(
    type?: string,
  ): 'page' | 'layout' | 'component' | 'widget' {
    const normalized = type?.toLowerCase();
    if (
      normalized === 'page' ||
      normalized === 'layout' ||
      normalized === 'component' ||
      normalized === 'widget'
    ) {
      return normalized;
    }
    return 'component';
  }

  private normalizeStateApproach(
    approach?: string,
  ): 'zustand' | 'context' | 'redux' | 'jotai' {
    const normalized = approach?.toLowerCase();
    if (
      normalized === 'zustand' ||
      normalized === 'context' ||
      normalized === 'redux' ||
      normalized === 'jotai'
    ) {
      return normalized;
    }
    return 'zustand';
  }
}
