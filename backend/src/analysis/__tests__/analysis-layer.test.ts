/**
 * AnalysisLayer 单元测试
 *
 * 使用真实 LLM 模型调用测试（通过 `.env` 配置的 OpenAI Responses API 端点）。
 *
 * 测试内容：
 * 1. 串行执行顺序：验证 4 个智能体按 PM → Architect → UI → UX 顺序执行
 * 2. 上下文累积传递：验证第 N 个智能体接收前 N-1 份文档
 * 3. 成功时产出恰好 4 份 SessionDocument，每份包含有效内容
 * 4. 中途失败中止行为
 *
 * 需求: R1.1, R1.6, R1.7
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { AnalysisLayer, type AnalysisLayerConfig } from '../analysis-layer.js';
import { LLMClient } from '../../llm/client.js';
import { RetryEngine } from '../../llm/retry.js';
import { OpenAIAdapter } from '../../llm/adapters/openai.js';
import type { ProviderAdapter } from '../../llm/adapters/types.js';
import type { ProviderID } from '../../llm/types.js';
import type { AnalysisLayerInput, SessionDocument, AnalysisAgentID } from '../types.js';
import type { RuntimeEvent, RuntimeEventPayload } from '@ai-frontend/shared-types';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from root .env file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://vpsairobot.com';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_DEFAULT_MODEL = process.env.AI_DEFAULT_MODEL || 'gpt-5.3-codex';

// Skip tests if no API key is configured
const shouldSkip = !OPENAI_API_KEY || OPENAI_API_KEY === 'your_openai_api_key_here' || OPENAI_API_KEY.startsWith('your_');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLLMClient(): LLMClient {
  const openaiAdapter = new OpenAIAdapter({
    baseUrl: OPENAI_BASE_URL,
    apiKey: OPENAI_API_KEY,
    protocol: 'responses',
  });

  const adapters = new Map<ProviderID, ProviderAdapter>([
    ['openai', openaiAdapter],
  ]);

  const retryEngine = new RetryEngine({
    maxRetries: 2,
    baseDelayMs: 1000,
    maxJitterMs: 200,
  });

  return new LLMClient(adapters, retryEngine);
}

function createAnalysisLayer(llmClient: LLMClient): AnalysisLayer {
  const config: AnalysisLayerConfig = {
    llmClient,
    provider: 'openai',
    model: AI_DEFAULT_MODEL,
    temperature: 0.7,
    maxOutputTokens: 4096,
  };

  return new AnalysisLayer(config);
}

function createMockEmitter(): {
  emitter: (event: RuntimeEventPayload) => RuntimeEvent;
  events: RuntimeEventPayload[];
} {
  const events: RuntimeEventPayload[] = [];
  const emitter = (event: RuntimeEventPayload): RuntimeEvent => {
    events.push(event);
    return {
      id: `event-${events.length}`,
      timestamp: Date.now(),
      ...event,
    } as RuntimeEvent;
  };
  return { emitter, events };
}

function createInput(
  userMessage: string,
  emitter: (event: RuntimeEventPayload) => RuntimeEvent,
): AnalysisLayerInput {
  return {
    sessionId: `test-session-${Date.now()}`,
    userMessage,
    platform: 'web',
    techStack: ['React', 'TypeScript'],
    abortSignal: new AbortController().signal,
    emitRuntimeEvent: emitter,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(shouldSkip)('AnalysisLayer', () => {
  let llmClient: LLMClient;
  let analysisLayer: AnalysisLayer;

  beforeAll(() => {
    llmClient = createLLMClient();
    analysisLayer = createAnalysisLayer(llmClient);
  });

  describe('Serial Execution Order', () => {
    it('should execute 4 agents in PM → Architect → UI → UX order', async () => {
      const { emitter, events } = createMockEmitter();
      const input = createInput('创建一个简单的待办事项应用', emitter);

      const result = await analysisLayer.run(input);

      // Verify success
      expect(result.success).toBe(true);
      expect(result.documents).toHaveLength(4);

      // Verify execution order from events
      const startedEvents = events.filter(e => e.type === 'agent.task.started');
      expect(startedEvents).toHaveLength(4);

      const taskIds = startedEvents.map(e => (e as any).taskId);
      expect(taskIds).toEqual([
        'analysis-product-manager',
        'analysis-frontend-architect',
        'analysis-ui-expert',
        'analysis-ux-expert',
      ]);

      // Verify document order matches agent order
      const agentIds = result.documents.map(doc => doc.agentId);
      expect(agentIds).toEqual([
        'product-manager',
        'frontend-architect',
        'ui-expert',
        'ux-expert',
      ]);
    }, 120000); // 2 minute timeout for real LLM calls
  });

  describe('Context Accumulation', () => {
    it('should pass N-1 previous documents to agent N', async () => {
      // We'll spy on the agents to verify context accumulation
      const { emitter } = createMockEmitter();
      const input = createInput('创建一个用户登录页面', emitter);

      // Create a new analysis layer with spied agents
      const spiedLayer = createAnalysisLayer(llmClient);
      const agents = spiedLayer.getAgents();

      // Track buildPrompt calls and their context
      const contextSizes: number[] = [];
      const originalBuildPrompts = agents.map(agent => agent.buildPrompt.bind(agent));

      agents.forEach((agent, index) => {
        const originalBuildPrompt = originalBuildPrompts[index];
        vi.spyOn(agent, 'buildPrompt').mockImplementation((context) => {
          contextSizes.push(context.previousDocuments.length);
          return originalBuildPrompt(context);
        });
      });

      const result = await spiedLayer.run(input);

      // Verify success
      expect(result.success).toBe(true);

      // Verify context accumulation:
      // Agent 0 (PM): 0 previous documents
      // Agent 1 (Architect): 1 previous document
      // Agent 2 (UI): 2 previous documents
      // Agent 3 (UX): 3 previous documents
      expect(contextSizes).toEqual([0, 1, 2, 3]);
    }, 120000);
  });

  describe('Success Case', () => {
    it('should produce exactly 4 SessionDocuments with valid content', async () => {
      const { emitter } = createMockEmitter();
      const input = createInput('创建一个电商产品列表页面', emitter);

      const result = await analysisLayer.run(input);

      // Verify success
      expect(result.success).toBe(true);
      expect(result.documents).toHaveLength(4);
      expect(result.failedAgentId).toBeUndefined();
      expect(result.error).toBeUndefined();

      // Verify each document has valid structure
      for (const doc of result.documents) {
        expect(doc.id).toBeTruthy();
        expect(doc.createdAt).toBeGreaterThan(0);
        expect(doc.version).toBe(1);
        expect(doc.content).toBeDefined();
      }

      // Verify ProductManagerDocument
      const pmDoc = result.documents[0];
      expect(pmDoc.agentId).toBe('product-manager');
      if (pmDoc.agentId === 'product-manager') {
        expect(pmDoc.content.functionalRequirements).toBeDefined();
        expect(Array.isArray(pmDoc.content.functionalRequirements)).toBe(true);
        expect(pmDoc.content.userStories).toBeDefined();
        expect(Array.isArray(pmDoc.content.userStories)).toBe(true);
        expect(pmDoc.content.priorityOrder).toBeDefined();
        expect(Array.isArray(pmDoc.content.priorityOrder)).toBe(true);
      }

      // Verify FrontendArchitectDocument
      const archDoc = result.documents[1];
      expect(archDoc.agentId).toBe('frontend-architect');
      if (archDoc.agentId === 'frontend-architect') {
        expect(archDoc.content.componentTree).toBeDefined();
        expect(Array.isArray(archDoc.content.componentTree)).toBe(true);
        expect(archDoc.content.routeDesign).toBeDefined();
        expect(Array.isArray(archDoc.content.routeDesign)).toBe(true);
        expect(archDoc.content.stateManagement).toBeDefined();
        expect(archDoc.content.stateManagement.approach).toBeDefined();
      }

      // Verify UIExpertDocument
      const uiDoc = result.documents[2];
      expect(uiDoc.agentId).toBe('ui-expert');
      if (uiDoc.agentId === 'ui-expert') {
        expect(uiDoc.content.visualSpec).toBeDefined();
        expect(uiDoc.content.componentStyles).toBeDefined();
        expect(Array.isArray(uiDoc.content.componentStyles)).toBe(true);
        expect(uiDoc.content.responsiveLayout).toBeDefined();
      }

      // Verify UXExpertDocument
      const uxDoc = result.documents[3];
      expect(uxDoc.agentId).toBe('ux-expert');
      if (uxDoc.agentId === 'ux-expert') {
        expect(uxDoc.content.interactionFlows).toBeDefined();
        expect(Array.isArray(uxDoc.content.interactionFlows)).toBe(true);
        expect(uxDoc.content.userJourneys).toBeDefined();
        expect(Array.isArray(uxDoc.content.userJourneys)).toBe(true);
        expect(uxDoc.content.usabilityRecommendations).toBeDefined();
        expect(Array.isArray(uxDoc.content.usabilityRecommendations)).toBe(true);
      }
    }, 120000);
  });

  describe('Mid-Failure Abort Behavior', () => {
    it('should abort and return failedAgentId when aborted mid-execution', async () => {
      const { emitter, events } = createMockEmitter();
      const controller = new AbortController();

      const input: AnalysisLayerInput = {
        sessionId: `test-session-${Date.now()}`,
        userMessage: '创建一个复杂的仪表盘应用',
        platform: 'web',
        techStack: ['React', 'TypeScript'],
        abortSignal: controller.signal,
        emitRuntimeEvent: emitter,
      };

      // Abort after a short delay (should abort during first or second agent)
      setTimeout(() => controller.abort(), 2000);

      const result = await analysisLayer.run(input);

      // Verify failure
      expect(result.success).toBe(false);
      expect(result.failedAgentId).toBeDefined();
      expect(result.error).toBeDefined();

      // Verify partial documents (0-3 depending on when abort happened)
      expect(result.documents.length).toBeLessThan(4);

      // Verify the failed agent is one of the valid agent IDs
      const validAgentIds: AnalysisAgentID[] = [
        'product-manager',
        'frontend-architect',
        'ui-expert',
        'ux-expert',
      ];
      expect(validAgentIds).toContain(result.failedAgentId);
    }, 30000);

    it('should return failedAgentId when LLM call fails', async () => {
      // Create a client with invalid API key to trigger failure
      const invalidAdapter = new OpenAIAdapter({
        baseUrl: OPENAI_BASE_URL,
        apiKey: 'invalid-api-key-for-testing',
        protocol: 'responses',
      });

      const invalidAdapters = new Map<ProviderID, ProviderAdapter>([
        ['openai', invalidAdapter],
      ]);

      const invalidClient = new LLMClient(
        invalidAdapters,
        new RetryEngine({ maxRetries: 0, baseDelayMs: 100, maxJitterMs: 0 }),
      );

      const invalidLayer = new AnalysisLayer({
        llmClient: invalidClient,
        provider: 'openai',
        model: AI_DEFAULT_MODEL,
      });

      const { emitter, events } = createMockEmitter();
      const input = createInput('创建一个简单的应用', emitter);

      const result = await invalidLayer.run(input);

      // Verify failure
      expect(result.success).toBe(false);
      expect(result.failedAgentId).toBe('product-manager'); // First agent should fail
      expect(result.error).toBeDefined();
      expect(result.documents).toHaveLength(0);

      // Verify failure event was emitted
      const completedEvents = events.filter(e => e.type === 'agent.task.completed');
      expect(completedEvents.length).toBeGreaterThan(0);
      const failedEvent = completedEvents.find(e => !(e as any).success);
      expect(failedEvent).toBeDefined();
    }, 30000);
  });

  describe('Event Emission', () => {
    it('should emit started and completed events for each agent', async () => {
      const { emitter, events } = createMockEmitter();
      const input = createInput('创建一个简单的计数器应用', emitter);

      const result = await analysisLayer.run(input);

      // Verify success
      expect(result.success).toBe(true);

      // Verify events
      const startedEvents = events.filter(e => e.type === 'agent.task.started');
      const completedEvents = events.filter(e => e.type === 'agent.task.completed');

      // Should have 4 started and 4 completed events
      expect(startedEvents).toHaveLength(4);
      expect(completedEvents).toHaveLength(4);

      // Verify all completed events are successful
      for (const event of completedEvents) {
        expect((event as any).success).toBe(true);
      }

      // Verify event order: started → completed for each agent
      const eventOrder = events.map(e => ({
        type: e.type,
        taskId: (e as any).taskId,
      }));

      // Each agent should have started before completed
      const agentTaskIds = [
        'analysis-product-manager',
        'analysis-frontend-architect',
        'analysis-ui-expert',
        'analysis-ux-expert',
      ];

      for (const taskId of agentTaskIds) {
        const startedIndex = eventOrder.findIndex(
          e => e.type === 'agent.task.started' && e.taskId === taskId,
        );
        const completedIndex = eventOrder.findIndex(
          e => e.type === 'agent.task.completed' && e.taskId === taskId,
        );
        expect(startedIndex).toBeLessThan(completedIndex);
      }
    }, 120000);
  });
});
