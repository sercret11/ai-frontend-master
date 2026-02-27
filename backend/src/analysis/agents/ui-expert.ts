/**
 * UIExpertAgent - UI 专家智能体
 *
 * 负责设计视觉规范、组件样式和响应式布局方案。
 * 接收产品需求经理和前端架构师的文档作为上下文。
 *
 * 需求: R1.4, R11.3
 */

import type {
  AnalysisAgent,
  AnalysisContext,
  UIExpertDocument,
  ProductManagerDocument,
  FrontendArchitectDocument,
  SessionDocument,
} from '../types.js';
import { extractJsonFromOutput, generateId } from './types.js';

export class UIExpertAgent implements AnalysisAgent {
  readonly id = 'ui-expert' as const;
  readonly title = 'UI 专家';

  /**
   * 构建 UI 设计 prompt
   *
   * 接收产品需求经理和前端架构师的 SessionDocument 作为上下文。
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

    const requirementsContext = pmDoc
      ? this.formatPMDocument(pmDoc)
      : '无产品需求文档';

    const architectureContext = archDoc
      ? this.formatArchDocument(archDoc)
      : '无架构设计文档';

    const platformInfo = context.platform
      ? `目标平台: ${context.platform}`
      : '目标平台: Web';

    return `你是一位资深的 UI 设计专家，专注于前端应用的视觉设计。

## 任务
基于产品需求和架构设计，制定 UI 视觉规范和组件样式方案。

## 用户原始需求
${context.userMessage}

## 产品需求分析
${requirementsContext}

## 架构设计
${architectureContext}

## 项目信息
${platformInfo}

## 输出要求
请以 JSON 格式输出，包含以下结构：

\`\`\`json
{
  "visualSpec": {
    "colorScheme": "light" | "dark" | "auto",
    "typography": {
      "heading": "字体名称",
      "body": "字体名称"
    },
    "spacing": {
      "xs": "4px",
      "sm": "8px",
      "md": "16px",
      "lg": "24px",
      "xl": "32px"
    },
    "borderRadius": "8px"
  },
  "componentStyles": [
    {
      "componentId": "comp-001",
      "styles": {
        "backgroundColor": "#ffffff",
        "padding": "16px"
      },
      "variants": {
        "primary": { "backgroundColor": "#3b82f6" },
        "secondary": { "backgroundColor": "#6b7280" }
      }
    }
  ],
  "responsiveLayout": {
    "breakpoints": {
      "sm": 640,
      "md": 768,
      "lg": 1024,
      "xl": 1280
    },
    "strategy": "mobile-first" | "desktop-first"
  }
}
\`\`\`

## 设计指南
1. 视觉规范应保持一致性和可访问性
2. 组件样式应与架构设计中的组件对应
3. 响应式布局应考虑多种设备尺寸
4. 颜色方案应符合 WCAG 对比度要求

请直接输出 JSON，不要包含其他解释文字。`;
  }

  /**
   * 解析 LLM 输出为 UIExpertDocument
   */
  parseOutput(raw: string): SessionDocument {
    const parsed = extractJsonFromOutput(raw) as {
      visualSpec?: {
        colorScheme?: string;
        typography?: { heading?: string; body?: string };
        spacing?: Record<string, string>;
        borderRadius?: string;
      };
      componentStyles?: Array<{
        componentId?: string;
        styles?: Record<string, string>;
        variants?: Record<string, Record<string, string>>;
      }>;
      responsiveLayout?: {
        breakpoints?: Record<string, number>;
        strategy?: string;
      };
    };

    // 验证并规范化视觉规范
    const visualSpec = {
      colorScheme: parsed.visualSpec?.colorScheme ?? 'light',
      typography: {
        heading: parsed.visualSpec?.typography?.heading ?? 'Inter',
        body: parsed.visualSpec?.typography?.body ?? 'Inter',
      },
      spacing: parsed.visualSpec?.spacing ?? {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '32px',
      },
      borderRadius: parsed.visualSpec?.borderRadius ?? '8px',
    };

    // 验证并规范化组件样式
    const componentStyles = (parsed.componentStyles ?? []).map((style) => ({
      componentId: style.componentId ?? '',
      styles: style.styles ?? {},
      ...(style.variants && { variants: style.variants }),
    }));

    // 验证并规范化响应式布局
    const responsiveLayout = {
      breakpoints: parsed.responsiveLayout?.breakpoints ?? {
        sm: 640,
        md: 768,
        lg: 1024,
        xl: 1280,
      },
      strategy: this.normalizeStrategy(parsed.responsiveLayout?.strategy),
    };

    const document: UIExpertDocument = {
      id: generateId(),
      agentId: 'ui-expert',
      createdAt: Date.now(),
      version: 1,
      content: {
        visualSpec,
        componentStyles,
        responsiveLayout,
      },
    };

    return document;
  }

  private formatPMDocument(doc: ProductManagerDocument): string {
    const requirements = doc.content.functionalRequirements
      .map((r) => `- [${r.priority}] ${r.title}`)
      .join('\n');

    return `### 功能需求
${requirements}`;
  }

  private formatArchDocument(doc: FrontendArchitectDocument): string {
    const components = doc.content.componentTree
      .map((c) => `- ${c.name} (${c.type})`)
      .join('\n');

    const routes = doc.content.routeDesign
      .map((r) => `- ${r.path}`)
      .join('\n');

    return `### 组件列表
${components}

### 路由
${routes}`;
  }

  private normalizeStrategy(
    strategy?: string,
  ): 'mobile-first' | 'desktop-first' {
    const normalized = strategy?.toLowerCase();
    if (normalized === 'mobile-first' || normalized === 'desktop-first') {
      return normalized;
    }
    return 'mobile-first';
  }
}
