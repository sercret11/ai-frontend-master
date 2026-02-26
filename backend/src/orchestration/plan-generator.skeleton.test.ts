import { describe, expect, it } from 'vitest';
import { generateExecutionPlan } from './plan-generator';

describe('plan-generator skeleton-first', () => {
  it('builds skeleton-first phases with research checklist', () => {
    const plan = generateExecutionPlan({
      userMessage: 'Build a Next.js dashboard with Zustand',
      routeDecision: {
        agentId: 'frontend-creator',
        mode: 'creator',
        source: 'route',
        confidence: 0.9,
      },
      platform: 'web',
      projectType: 'next-js',
      techStack: ['Next.js', 'React', 'Zustand'],
      sessionMode: 'creator',
    });

    const phases = plan.tasks.map(task => task.phase);
    expect(phases).toContain('skeleton');
    expect(phases).toContain('skeleton-l1-gate');
    expect(phases).toContain('contract-freeze');
    expect(phases).toContain('research');

    const researchTask = plan.tasks.find(task => task.phase === 'research');
    expect(researchTask).toBeTruthy();
    const checklist = researchTask?.metadata?.dependencyChecklist as any[];
    expect(Array.isArray(checklist)).toBe(true);
    expect(checklist.length).toBeGreaterThan(0);
    expect(plan.metadata?.uiBlueprint?.intent).toBe('generic-interactive-application');
    expect(plan.metadata?.uiBlueprint?.routes.length).toBeGreaterThanOrEqual(2);
    expect(plan.metadata?.uiBlueprint?.interactions.length).toBeGreaterThanOrEqual(5);

    const pagesTask = plan.tasks.find(task => task.phase === 'pages');
    const researchId = researchTask?.id;
    expect(pagesTask?.dependencies.includes(researchId || '')).toBe(true);
  });

  it('enables brainstorm strategy when prompt information is sparse', () => {
    const plan = generateExecutionPlan({
      userMessage: '生成web端的外卖后台管理系统',
      routeDecision: {
        agentId: 'frontend-creator',
        mode: 'creator',
        source: 'route',
        confidence: 0.9,
      },
      platform: 'web',
      projectType: 'react-vite',
      techStack: ['React'],
      sessionMode: 'creator',
    });

    const researchTask = plan.tasks.find(task => task.phase === 'research');
    expect(plan.metadata?.requirementStrategy).toBe('brainstorm');
    expect(researchTask?.metadata?.requirementStrategy).toBe('brainstorm');
    expect(researchTask?.description).toContain('Run requirement-brainstorm pass first');
    expect(plan.metadata?.uiBlueprint?.acceptanceGates.minViewCount).toBe(3);
    expect(plan.maxIterations).toBe(6);
  });

  it('keeps direct strategy when prompt is structurally detailed', () => {
    const plan = generateExecutionPlan({
      userMessage:
        '生成 Web 管理端：1. 需要多路由与侧边导航；2. 至少两个数据视图；3. 表单需校验与提交反馈；4. 支持筛选与分页',
      routeDecision: {
        agentId: 'frontend-implementer',
        mode: 'implementer',
        source: 'route',
        confidence: 0.9,
      },
      platform: 'web',
      projectType: 'react-vite',
      techStack: ['React', 'TypeScript'],
      sessionMode: 'implementer',
    });

    const researchTask = plan.tasks.find(task => task.phase === 'research');
    expect(plan.metadata?.requirementStrategy).toBe('direct');
    expect(researchTask?.metadata?.requirementStrategy).toBe('direct');
    expect(researchTask?.description).not.toContain('requirement-brainstorm');
    expect(plan.metadata?.uiBlueprint?.acceptanceGates.minViewCount).toBe(2);
    expect(plan.maxIterations).toBe(5);
  });
});
