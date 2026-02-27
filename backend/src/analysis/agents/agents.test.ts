/**
 * 分析智能体单元测试
 *
 * 测试 4 个分析智能体的 buildPrompt 和 parseOutput 方法。
 */

import { describe, it, expect } from 'vitest';
import { ProductManagerAgent } from './product-manager.js';
import { FrontendArchitectAgent } from './frontend-architect.js';
import { UIExpertAgent } from './ui-expert.js';
import { UXExpertAgent } from './ux-expert.js';
import type {
  AnalysisContext,
  ProductManagerDocument,
  FrontendArchitectDocument,
  UIExpertDocument,
} from '../types.js';

describe('ProductManagerAgent', () => {
  const agent = new ProductManagerAgent();

  it('should have correct id and title', () => {
    expect(agent.id).toBe('product-manager');
    expect(agent.title).toBe('产品需求经理');
  });

  it('should build prompt with user message', () => {
    const context: AnalysisContext = {
      sessionId: 'test-session',
      userMessage: '创建一个待办事项应用',
      previousDocuments: [],
    };

    const prompt = agent.buildPrompt(context);

    expect(prompt).toContain('创建一个待办事项应用');
    expect(prompt).toContain('产品需求经理');
    expect(prompt).toContain('functionalRequirements');
  });

  it('should parse valid JSON output', () => {
    const raw = JSON.stringify({
      functionalRequirements: [
        {
          id: 'FR-001',
          title: '添加待办事项',
          description: '用户可以添加新的待办事项',
          priority: 'high',
        },
      ],
      userStories: [
        {
          id: 'US-001',
          persona: '普通用户',
          goal: '快速添加待办事项',
          benefit: '提高工作效率',
        },
      ],
      priorityOrder: ['FR-001'],
    });

    const doc = agent.parseOutput(raw) as ProductManagerDocument;

    expect(doc.agentId).toBe('product-manager');
    expect(doc.version).toBe(1);
    expect(doc.content.functionalRequirements).toHaveLength(1);
    expect(doc.content.functionalRequirements[0].title).toBe('添加待办事项');
    expect(doc.content.userStories).toHaveLength(1);
    expect(doc.content.priorityOrder).toEqual(['FR-001']);
  });

  it('should parse JSON from markdown code block', () => {
    const raw = `Here is the analysis:

\`\`\`json
{
  "functionalRequirements": [
    { "id": "FR-001", "title": "Test", "description": "Test desc", "priority": "medium" }
  ],
  "userStories": [],
  "priorityOrder": ["FR-001"]
}
\`\`\`

That's the output.`;

    const doc = agent.parseOutput(raw) as ProductManagerDocument;

    expect(doc.content.functionalRequirements).toHaveLength(1);
    expect(doc.content.functionalRequirements[0].title).toBe('Test');
  });

  it('should normalize invalid priority to medium', () => {
    const raw = JSON.stringify({
      functionalRequirements: [
        { id: 'FR-001', title: 'Test', description: 'Test', priority: 'invalid' },
      ],
      userStories: [],
      priorityOrder: [],
    });

    const doc = agent.parseOutput(raw) as ProductManagerDocument;

    expect(doc.content.functionalRequirements[0].priority).toBe('medium');
  });
});

describe('FrontendArchitectAgent', () => {
  const agent = new FrontendArchitectAgent();

  it('should have correct id and title', () => {
    expect(agent.id).toBe('frontend-architect');
    expect(agent.title).toBe('前端架构师');
  });

  it('should build prompt with PM document context', () => {
    const pmDoc: ProductManagerDocument = {
      id: 'pm-doc-1',
      agentId: 'product-manager',
      createdAt: Date.now(),
      version: 1,
      content: {
        functionalRequirements: [
          { id: 'FR-001', title: '添加待办', description: '添加待办事项', priority: 'high' },
        ],
        userStories: [
          { id: 'US-001', persona: '用户', goal: '添加待办', benefit: '提高效率' },
        ],
        priorityOrder: ['FR-001'],
      },
    };

    const context: AnalysisContext = {
      sessionId: 'test-session',
      userMessage: '创建待办应用',
      previousDocuments: [pmDoc],
    };

    const prompt = agent.buildPrompt(context);

    expect(prompt).toContain('添加待办');
    expect(prompt).toContain('componentTree');
    expect(prompt).toContain('routeDesign');
  });

  it('should parse valid JSON output', () => {
    const raw = JSON.stringify({
      componentTree: [
        { id: 'comp-001', name: 'HomePage', type: 'page', children: [] },
      ],
      routeDesign: [
        { path: '/', componentId: 'comp-001' },
      ],
      stateManagement: {
        approach: 'zustand',
        stores: [
          { name: 'todoStore', description: '待办存储', fields: { todos: 'Todo[]' } },
        ],
      },
    });

    const doc = agent.parseOutput(raw) as FrontendArchitectDocument;

    expect(doc.agentId).toBe('frontend-architect');
    expect(doc.content.componentTree).toHaveLength(1);
    expect(doc.content.componentTree[0].name).toBe('HomePage');
    expect(doc.content.routeDesign).toHaveLength(1);
    expect(doc.content.stateManagement.approach).toBe('zustand');
  });

  it('should normalize invalid component type to component', () => {
    const raw = JSON.stringify({
      componentTree: [
        { id: 'comp-001', name: 'Test', type: 'invalid', children: [] },
      ],
      routeDesign: [],
      stateManagement: { approach: 'zustand', stores: [] },
    });

    const doc = agent.parseOutput(raw) as FrontendArchitectDocument;

    expect(doc.content.componentTree[0].type).toBe('component');
  });
});

describe('UIExpertAgent', () => {
  const agent = new UIExpertAgent();

  it('should have correct id and title', () => {
    expect(agent.id).toBe('ui-expert');
    expect(agent.title).toBe('UI 专家');
  });

  it('should build prompt with PM and Architect documents', () => {
    const pmDoc: ProductManagerDocument = {
      id: 'pm-doc-1',
      agentId: 'product-manager',
      createdAt: Date.now(),
      version: 1,
      content: {
        functionalRequirements: [
          { id: 'FR-001', title: '功能1', description: '描述', priority: 'high' },
        ],
        userStories: [],
        priorityOrder: [],
      },
    };

    const archDoc: FrontendArchitectDocument = {
      id: 'arch-doc-1',
      agentId: 'frontend-architect',
      createdAt: Date.now(),
      version: 1,
      content: {
        componentTree: [
          { id: 'comp-001', name: 'HomePage', type: 'page', children: [] },
        ],
        routeDesign: [{ path: '/', componentId: 'comp-001' }],
        stateManagement: { approach: 'zustand', stores: [] },
      },
    };

    const context: AnalysisContext = {
      sessionId: 'test-session',
      userMessage: '创建应用',
      previousDocuments: [pmDoc, archDoc],
    };

    const prompt = agent.buildPrompt(context);

    expect(prompt).toContain('HomePage');
    expect(prompt).toContain('visualSpec');
    expect(prompt).toContain('componentStyles');
  });

  it('should parse valid JSON output', () => {
    const raw = JSON.stringify({
      visualSpec: {
        colorScheme: 'light',
        typography: { heading: 'Inter', body: 'Inter' },
        spacing: { sm: '8px', md: '16px' },
        borderRadius: '8px',
      },
      componentStyles: [
        { componentId: 'comp-001', styles: { padding: '16px' } },
      ],
      responsiveLayout: {
        breakpoints: { sm: 640, md: 768 },
        strategy: 'mobile-first',
      },
    });

    const doc = agent.parseOutput(raw) as UIExpertDocument;

    expect(doc.agentId).toBe('ui-expert');
    expect(doc.content.visualSpec.colorScheme).toBe('light');
    expect(doc.content.responsiveLayout.strategy).toBe('mobile-first');
  });
});

describe('UXExpertAgent', () => {
  const agent = new UXExpertAgent();

  it('should have correct id and title', () => {
    expect(agent.id).toBe('ux-expert');
    expect(agent.title).toBe('UX 专家');
  });

  it('should build prompt with all previous documents', () => {
    const pmDoc: ProductManagerDocument = {
      id: 'pm-doc-1',
      agentId: 'product-manager',
      createdAt: Date.now(),
      version: 1,
      content: {
        functionalRequirements: [],
        userStories: [
          { id: 'US-001', persona: '用户', goal: '完成任务', benefit: '提高效率' },
        ],
        priorityOrder: [],
      },
    };

    const archDoc: FrontendArchitectDocument = {
      id: 'arch-doc-1',
      agentId: 'frontend-architect',
      createdAt: Date.now(),
      version: 1,
      content: {
        componentTree: [],
        routeDesign: [{ path: '/home', componentId: 'comp-001' }],
        stateManagement: { approach: 'zustand', stores: [] },
      },
    };

    const uiDoc: UIExpertDocument = {
      id: 'ui-doc-1',
      agentId: 'ui-expert',
      createdAt: Date.now(),
      version: 1,
      content: {
        visualSpec: {
          colorScheme: 'light',
          typography: { heading: 'Inter', body: 'Inter' },
          spacing: {},
          borderRadius: '8px',
        },
        componentStyles: [],
        responsiveLayout: {
          breakpoints: { sm: 640 },
          strategy: 'mobile-first',
        },
      },
    };

    const context: AnalysisContext = {
      sessionId: 'test-session',
      userMessage: '创建应用',
      previousDocuments: [pmDoc, archDoc, uiDoc],
    };

    const prompt = agent.buildPrompt(context);

    expect(prompt).toContain('完成任务');
    expect(prompt).toContain('/home');
    expect(prompt).toContain('mobile-first');
    expect(prompt).toContain('interactionFlows');
  });

  it('should parse valid JSON output', () => {
    const raw = JSON.stringify({
      interactionFlows: [
        {
          id: 'flow-001',
          name: '添加待办流程',
          steps: [
            { action: '点击添加按钮', expectedResult: '显示输入框' },
          ],
        },
      ],
      userJourneys: [
        {
          id: 'journey-001',
          persona: '新用户',
          touchpoints: ['首页', '添加页'],
          painPoints: ['不知道如何开始'],
        },
      ],
      usabilityRecommendations: [
        { area: '导航', recommendation: '添加引导提示', priority: 'high' },
      ],
    });

    const doc = agent.parseOutput(raw);

    expect(doc.agentId).toBe('ux-expert');
    if (doc.agentId === 'ux-expert') {
      expect(doc.content.interactionFlows).toHaveLength(1);
      expect(doc.content.interactionFlows[0].name).toBe('添加待办流程');
      expect(doc.content.userJourneys).toHaveLength(1);
      expect(doc.content.usabilityRecommendations[0].priority).toBe('high');
    }
  });
});

describe('extractJsonFromOutput', () => {
  it('should handle JSON with extra text before and after', () => {
    const agent = new ProductManagerAgent();
    const raw = `Here is my analysis:

{
  "functionalRequirements": [],
  "userStories": [],
  "priorityOrder": []
}

Hope this helps!`;

    const doc = agent.parseOutput(raw);
    expect(doc.agentId).toBe('product-manager');
  });
});
