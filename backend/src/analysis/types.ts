/**
 * 分析层（Analysis_Layer）类型定义
 *
 * 定义 4 个分析智能体的接口、上下文、输入/输出，
 * 以及 4 种 SessionDocument 子类型。
 */

import type { RuntimeEventPayload, RuntimeEvent } from '@ai-frontend/shared-types';

// ============================================================================
// Agent ID & Interface
// ============================================================================

export type AnalysisAgentID =
  | 'product-manager'
  | 'frontend-architect'
  | 'ui-expert'
  | 'ux-expert';

export interface AnalysisAgent {
  id: AnalysisAgentID;
  title: string;
  buildPrompt(context: AnalysisContext): string;
  parseOutput(raw: string): SessionDocument;
}

// ============================================================================
// Context & I/O
// ============================================================================

export type RuntimeEventEmitter = (event: RuntimeEventPayload) => RuntimeEvent;

export interface AnalysisContext {
  sessionId: string;
  userMessage: string;
  previousDocuments: SessionDocument[];
  platform?: string;
  techStack?: string[];
}

export interface AnalysisLayerInput {
  sessionId: string;
  userMessage: string;
  platform?: string;
  techStack?: string[];
  abortSignal: AbortSignal;
  emitRuntimeEvent: RuntimeEventEmitter;
}

export interface AnalysisLayerOutput {
  success: boolean;
  documents: SessionDocument[];
  failedAgentId?: AnalysisAgentID;
  error?: string;
}

// ============================================================================
// SessionDocument 基础
// ============================================================================

export interface SessionDocumentBase {
  id: string;
  agentId: AnalysisAgentID;
  createdAt: number;
  version: 1;
}

// ============================================================================
// 产品需求经理输出
// ============================================================================

export interface ProductManagerDocument extends SessionDocumentBase {
  agentId: 'product-manager';
  content: {
    functionalRequirements: Array<{
      id: string;
      title: string;
      description: string;
      priority: 'high' | 'medium' | 'low';
    }>;
    userStories: Array<{
      id: string;
      persona: string;
      goal: string;
      benefit: string;
    }>;
    priorityOrder: string[];
  };
}

// ============================================================================
// 前端架构师输出
// ============================================================================

export interface FrontendArchitectDocument extends SessionDocumentBase {
  agentId: 'frontend-architect';
  content: {
    componentTree: Array<{
      id: string;
      name: string;
      type: 'page' | 'layout' | 'component' | 'widget';
      children: string[];
      props?: Record<string, string>;
    }>;
    routeDesign: Array<{
      path: string;
      componentId: string;
      guard?: string;
    }>;
    stateManagement: {
      approach: 'zustand' | 'context' | 'redux' | 'jotai';
      stores: Array<{
        name: string;
        description: string;
        fields: Record<string, string>;
      }>;
    };
  };
}

// ============================================================================
// UI 专家输出
// ============================================================================

export interface UIExpertDocument extends SessionDocumentBase {
  agentId: 'ui-expert';
  content: {
    visualSpec: {
      colorScheme: string;
      typography: { heading: string; body: string };
      spacing: Record<string, string>;
      borderRadius: string;
    };
    componentStyles: Array<{
      componentId: string;
      styles: Record<string, string>;
      variants?: Record<string, Record<string, string>>;
    }>;
    responsiveLayout: {
      breakpoints: Record<string, number>;
      strategy: 'mobile-first' | 'desktop-first';
    };
  };
}

// ============================================================================
// UX 专家输出
// ============================================================================

export interface UXExpertDocument extends SessionDocumentBase {
  agentId: 'ux-expert';
  content: {
    interactionFlows: Array<{
      id: string;
      name: string;
      steps: Array<{
        action: string;
        expectedResult: string;
        errorHandling?: string;
      }>;
    }>;
    userJourneys: Array<{
      id: string;
      persona: string;
      touchpoints: string[];
      painPoints: string[];
    }>;
    usabilityRecommendations: Array<{
      area: string;
      recommendation: string;
      priority: 'high' | 'medium' | 'low';
    }>;
  };
}

// ============================================================================
// SessionDocument 联合类型
// ============================================================================

export type SessionDocument =
  | ProductManagerDocument
  | FrontendArchitectDocument
  | UIExpertDocument
  | UXExpertDocument;
