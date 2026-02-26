import { describe, expect, it } from 'vitest';
import { ModeRouter as PromptModeRouter } from './router';
import { ModeRouter as ContextModeRouter } from '../context/integration/mode-router';

describe('unified mode routing', () => {
  it('detects mixed-language input with non-trivial word units', () => {
    const analysis = PromptModeRouter.extractAnalysis(
      'Use Next.js 14 + shadcn/ui + Tailwind CSS 开发 SaaS dashboard'
    );

    expect(analysis.wordCount).toBeGreaterThanOrEqual(10);
    expect(analysis.frameworks).toContain('nextjs');
    expect(analysis.styles).toContain('tailwind');
    expect(analysis.styles).toContain('shadcn');
  });

  it('keeps prompt router and smart-context router mode decisions aligned', () => {
    const smartRouter = new ContextModeRouter();
    const samples = [
      'Build a pet care landing page',
      'Use React 18 + TypeScript + Tailwind CSS, implement dashboard with RBAC and audit log',
      'Implement mini-program order page from PRD and Figma with uni-app + uView',
      'Build a marketing website for an AI startup with modern style',
    ];

    for (const message of samples) {
      const promptMode = PromptModeRouter.analyze(PromptModeRouter.extractAnalysis(message)).mode;
      const smartMode = smartRouter.detect(message).mode;
      expect(smartMode).toBe(promptMode);
    }
  });

  it('returns structured route diagnostics', () => {
    const detected = PromptModeRouter.detectAgent({
      userQuery: 'Implement with Next.js, shadcn/ui, Tailwind CSS and PRD details',
      hasPRD: false,
      hasTechStack: false,
      hasFigma: false,
      hasDetailedRequirements: false,
      hasBusinessContext: false,
    });

    expect(detected.version).toBe('router-v3');
    expect(detected.mode).toBe('implementer');
    expect(detected.techSignals?.length || 0).toBeGreaterThan(0);
  });

  it('raises implementer score when implementation intent is present', () => {
    const message = 'Fix Next.js login bug and add unit tests with regression checks';
    const analysis = PromptModeRouter.extractAnalysis(message);
    const scored = PromptModeRouter.analyze(analysis);
    const smartRouter = new ContextModeRouter();
    const smart = smartRouter.detect(message);

    expect(analysis.hasImplementationIntent).toBe(true);
    expect(scored.details.implementationIntentScore).toBe(35);
    expect(scored.mode).toBe('implementer');
    expect(smart.mode).toBe(scored.mode);
  });

  it('merges explicit detection signals with extracted text signals', () => {
    const detected = PromptModeRouter.detectAgent({
      userQuery: 'Build one page',
      hasPRD: true,
      hasTechStack: true,
      hasFigma: false,
      hasDetailedRequirements: false,
      hasBusinessContext: false,
    });

    expect(detected.mode).toBe('implementer');
    expect(detected.reasons.some(reason => reason.includes('explicit-signals=hasPRD,hasTechStack'))).toBe(true);
  });

  it('forces explicit ui library selection from user input', () => {
    const detected = PromptModeRouter.detectAgent({
      userQuery: 'Use React 18 and AntD to implement the dashboard',
      hasPRD: false,
      hasTechStack: false,
      hasFigma: false,
      hasDetailedRequirements: false,
      hasBusinessContext: false,
    });

    expect(detected.uiLibrarySelection?.library).toBe('antd');
    expect(detected.uiLibrarySelection?.source).toBe('explicit');
    expect(detected.blocked).toBe(false);
  });

  it('keeps explicit preferred ui library when using slash notation', () => {
    const detected = PromptModeRouter.detectAgent({
      userQuery: 'Implement the dashboard',
      hasPRD: false,
      hasTechStack: false,
      hasFigma: false,
      hasDetailedRequirements: false,
      hasBusinessContext: false,
      preferredFramework: 'react',
      preferredUiLibrary: 'shadcn/ui',
    });

    expect(detected.uiLibrarySelection?.library).toBe('shadcn');
    expect(detected.uiLibrarySelection?.source).toBe('explicit');
    expect(detected.blocked).toBe(false);
  });

  it('creates clarification task when framework and ui library are incompatible', () => {
    const detected = PromptModeRouter.detectAgent({
      userQuery: 'Implement with React and Element Plus components',
      hasPRD: false,
      hasTechStack: false,
      hasFigma: false,
      hasDetailedRequirements: false,
      hasBusinessContext: false,
    });

    expect(detected.framework).toBe('react');
    expect(detected.uiLibrarySelection?.library).toBe('element-plus');
    expect(detected.blocked).toBe(true);
    expect(detected.clarificationTask?.required).toBe(true);
    expect(detected.decisionTrace?.some(step => step.step === 'ui.compatibility')).toBe(true);
  });
});
