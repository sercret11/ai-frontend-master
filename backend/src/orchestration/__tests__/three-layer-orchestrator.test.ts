/**
 * ThreeLayerOrchestrator 集成测试
 *
 * 1. 三层完整流程：Analysis → Planning → Execution 串联执行（真实 LLM 调用）
 * 2. 分析层失败时的错误传播（mock 分析层）
 * 3. 规划层循环依赖时的错误处理（mock 规划层）
 *
 * 需求: R10.1, R10.2, R10.3
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ThreeLayerOrchestrator } from '../three-layer-orchestrator.js';
import { AnalysisLayer } from '../../analysis/analysis-layer.js';
import { PlanningLayer } from '../../planning/planning-layer.js';
import { ExecutionLayer } from '../../execution/execution-layer.js';
import { MultiAgentBlackboard } from '../../runtime/multi-agent/blackboard.js';
import { MultiAgentEventBus } from '../../runtime/multi-agent/event-bus.js';
import { LLMClient } from '../../llm/client.js';
import { RetryEngine } from '../../llm/retry.js';
import { OpenAIAdapter } from '../../llm/adapters/openai.js';
import type { ProviderAdapter } from '../../llm/adapters/types.js';
import type { ProviderID } from '../../llm/types.js';
import type { MultiAgentKernelInput } from '../../runtime/multi-agent/types.js';
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

const shouldSkip =
  !OPENAI_API_KEY ||
  OPENAI_API_KEY === 'your_openai_api_key_here' ||
  OPENAI_API_KEY.startsWith('your_');

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

function createMockEmitter(): {
  emitter: (event: RuntimeEventPayload) => RuntimeEvent;
  events: RuntimeEventPayload[];
} {
  const events: RuntimeEventPayload[] = [];
  const emitter = (event: RuntimeEventPayload): RuntimeEvent => {
    events.push(event);
    return {
      timestamp: Date.now(),
      ...event,
    } as unknown as RuntimeEvent;
  };
  return { emitter, events };
}

function createKernelInput(
  userMessage: string,
  emitter: (event: RuntimeEventPayload) => RuntimeEvent,
  runtimeBudget?: MultiAgentKernelInput['runtimeBudget'],
): MultiAgentKernelInput {
  return {
    sessionId: `test-session-${Date.now()}`,
    runId: `test-run-${Date.now()}`,
    userMessage,
    routeDecision: {
      agentId: 'planner-agent',
      mode: 'creator',
      source: 'auto',
      confidence: 1,
    },
    platform: 'web',
    techStack: ['React', 'TypeScript'],
    runtimeBudget,
    emitRuntimeEvent: emitter,
    abortSignal: new AbortController().signal,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ThreeLayerOrchestrator', () => {
  // =========================================================================
  // Test 1: Full pipeline with real LLM calls
  // =========================================================================
  describe.skipIf(shouldSkip)('Full Pipeline (real LLM)', () => {
    let llmClient: LLMClient;

    beforeAll(() => {
      llmClient = createLLMClient();
    });

    it('should run Analysis → Planning → Execution without throwing', async () => {
      const blackboard = new MultiAgentBlackboard();
      const eventBus = new MultiAgentEventBus();

      const analysisLayer = new AnalysisLayer({
        llmClient,
        provider: 'openai',
        model: AI_DEFAULT_MODEL,
        temperature: 0.7,
        maxOutputTokens: 4096,
      });

      const planningLayer = new PlanningLayer({
        llmClient,
        provider: 'openai',
        model: AI_DEFAULT_MODEL,
        blackboard,
        temperature: 0.7,
        maxOutputTokens: 4096,
      });

      const executionLayer = new ExecutionLayer(
        blackboard,
        llmClient,
        'openai',
        AI_DEFAULT_MODEL,
      );

      const orchestrator = new ThreeLayerOrchestrator(
        analysisLayer,
        planningLayer,
        executionLayer,
        blackboard,
        eventBus,
      );

      const { emitter, events } = createMockEmitter();
      const input = createKernelInput('Create a simple counter app', emitter);

      // Should complete without throwing
      await expect(orchestrator.run(input)).resolves.not.toThrow();

      // Blackboard should have session documents stored
      const docs = blackboard.getSessionDocuments();
      expect(docs.length).toBe(4);

      // Blackboard should have an execution plan stored
      const plan = blackboard.getExecutionPlan();
      expect(plan).not.toBeNull();
      expect(plan!.tasks.length).toBeGreaterThan(0);

      // Events should include orchestration stage events
      const startedEvents = events.filter(e => e.type === 'agent.task.started');
      const completedEvents = events.filter(e => e.type === 'agent.task.completed');
      expect(startedEvents.length).toBeGreaterThanOrEqual(3); // at least analysis, planning, execution
      expect(completedEvents.length).toBeGreaterThanOrEqual(3);
    }, 180000); // 3 minute timeout for full pipeline with real LLM
  });

  // =========================================================================
  // Test 2: Analysis layer failure propagation (mock)
  // =========================================================================
  describe('Analysis Layer Error Propagation', () => {
    it('should propagate analysis layer errors and emit error events', async () => {
      const blackboard = new MultiAgentBlackboard();
      const eventBus = new MultiAgentEventBus();

      // Stub analysis layer that throws
      const mockAnalysisLayer = {
        run: vi.fn().mockRejectedValue(new Error('Analysis LLM call failed: invalid prompt')),
      } as unknown as AnalysisLayer;

      const mockPlanningLayer = {
        run: vi.fn(),
      } as unknown as PlanningLayer;

      const mockExecutionLayer = {
        run: vi.fn(),
      } as unknown as ExecutionLayer;

      const orchestrator = new ThreeLayerOrchestrator(
        mockAnalysisLayer,
        mockPlanningLayer,
        mockExecutionLayer,
        blackboard,
        eventBus,
      );

      const { emitter, events } = createMockEmitter();
      const input = createKernelInput('test message', emitter);

      // Should throw the analysis error
      await expect(orchestrator.run(input)).rejects.toThrow(
        'Analysis LLM call failed: invalid prompt',
      );

      // Planning and execution layers should NOT have been called
      expect(mockPlanningLayer.run).not.toHaveBeenCalled();
      expect(mockExecutionLayer.run).not.toHaveBeenCalled();

      // Error event should have been emitted
      const errorEvents = events.filter(e => e.type === 'run.error');
      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
      const errorPayload = errorEvents[0] as any;
      expect(errorPayload.error).toContain('analysis');

      // EventBus should also have the error event
      const busEvents = eventBus.list();
      expect(busEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should propagate non-success analysis output as error', async () => {
      const blackboard = new MultiAgentBlackboard();
      const eventBus = new MultiAgentEventBus();

      // Stub analysis layer that returns failure (not throwing)
      const mockAnalysisLayer = {
        run: vi.fn().mockResolvedValue({
          success: false,
          documents: [],
          failedAgentId: 'product-manager',
          error: 'PM agent failed to parse LLM output',
        }),
      } as unknown as AnalysisLayer;

      const mockPlanningLayer = {
        run: vi.fn(),
      } as unknown as PlanningLayer;

      const mockExecutionLayer = {
        run: vi.fn(),
      } as unknown as ExecutionLayer;

      const orchestrator = new ThreeLayerOrchestrator(
        mockAnalysisLayer,
        mockPlanningLayer,
        mockExecutionLayer,
        blackboard,
        eventBus,
      );

      const { emitter, events } = createMockEmitter();
      const input = createKernelInput('test message', emitter);

      // Should throw because analysis was not successful
      await expect(orchestrator.run(input)).rejects.toThrow(
        'PM agent failed to parse LLM output',
      );

      // Planning and execution should NOT have been called
      expect(mockPlanningLayer.run).not.toHaveBeenCalled();
      expect(mockExecutionLayer.run).not.toHaveBeenCalled();
    });

    it('should retry transient analysis errors and continue pipeline on recovery', async () => {
      const blackboard = new MultiAgentBlackboard();
      const eventBus = new MultiAgentEventBus();

      const transientError = Object.assign(new Error('fetch failed'), {
        code: 'ECONNRESET',
      });

      const mockAnalysisLayer = {
        run: vi
          .fn()
          .mockRejectedValueOnce(transientError)
          .mockResolvedValue({
            success: true,
            documents: [
              { id: 'doc-1', agentId: 'product-manager', createdAt: Date.now(), version: 1, content: {} },
              { id: 'doc-2', agentId: 'frontend-architect', createdAt: Date.now(), version: 1, content: {} },
              { id: 'doc-3', agentId: 'ui-expert', createdAt: Date.now(), version: 1, content: {} },
              { id: 'doc-4', agentId: 'ux-expert', createdAt: Date.now(), version: 1, content: {} },
            ],
          }),
      } as unknown as AnalysisLayer;

      const mockPlanningLayer = {
        run: vi.fn().mockResolvedValue({
          id: 'plan-1',
          createdAt: Date.now(),
          tasks: [],
        }),
      } as unknown as PlanningLayer;

      const mockExecutionLayer = {
        run: vi.fn().mockResolvedValue({
          success: true,
          patchIntents: [],
          touchedFiles: ['src/App.tsx'],
          degradedTasks: [],
          unresolvedIssues: [],
        }),
      } as unknown as ExecutionLayer;

      const orchestrator = new ThreeLayerOrchestrator(
        mockAnalysisLayer,
        mockPlanningLayer,
        mockExecutionLayer,
        blackboard,
        eventBus,
      );

      const previousAttempts = process.env.RUNTIME_STAGE_RETRY_ATTEMPTS;
      const previousDelay = process.env.RUNTIME_STAGE_RETRY_BASE_DELAY_MS;
      process.env.RUNTIME_STAGE_RETRY_ATTEMPTS = '2';
      process.env.RUNTIME_STAGE_RETRY_BASE_DELAY_MS = '1';

      try {
        const { emitter } = createMockEmitter();
        const input = createKernelInput('test message', emitter);
        await expect(orchestrator.run(input)).resolves.not.toThrow();
      } finally {
        if (previousAttempts === undefined) {
          delete process.env.RUNTIME_STAGE_RETRY_ATTEMPTS;
        } else {
          process.env.RUNTIME_STAGE_RETRY_ATTEMPTS = previousAttempts;
        }
        if (previousDelay === undefined) {
          delete process.env.RUNTIME_STAGE_RETRY_BASE_DELAY_MS;
        } else {
          process.env.RUNTIME_STAGE_RETRY_BASE_DELAY_MS = previousDelay;
        }
      }

      expect(mockAnalysisLayer.run).toHaveBeenCalledTimes(2);
      expect(mockPlanningLayer.run).toHaveBeenCalledTimes(1);
      expect(mockExecutionLayer.run).toHaveBeenCalledTimes(1);
    });
  });

  describe('Execution Layer Degraded Output Propagation', () => {
    it('emits a non-empty run.error when execution is degraded only by failed tasks', async () => {
      const blackboard = new MultiAgentBlackboard();
      const eventBus = new MultiAgentEventBus();

      const mockAnalysisLayer = {
        run: vi.fn().mockResolvedValue({
          success: true,
          documents: [
            { id: 'doc-1', agentId: 'product-manager', createdAt: Date.now(), version: 1, content: {} },
            { id: 'doc-2', agentId: 'frontend-architect', createdAt: Date.now(), version: 1, content: {} },
            { id: 'doc-3', agentId: 'ui-expert', createdAt: Date.now(), version: 1, content: {} },
            { id: 'doc-4', agentId: 'ux-expert', createdAt: Date.now(), version: 1, content: {} },
          ],
        }),
      } as unknown as AnalysisLayer;

      const mockPlanningLayer = {
        run: vi.fn().mockResolvedValue({
          id: 'plan-1',
          createdAt: Date.now(),
          tasks: [],
        }),
      } as unknown as PlanningLayer;

      const mockExecutionLayer = {
        run: vi.fn().mockResolvedValue({
          success: false,
          patchIntents: [],
          touchedFiles: ['src/pages/DashboardPage.tsx'],
          degradedTasks: ['repair-1'],
          unresolvedIssues: [],
        }),
      } as unknown as ExecutionLayer;

      const orchestrator = new ThreeLayerOrchestrator(
        mockAnalysisLayer,
        mockPlanningLayer,
        mockExecutionLayer,
        blackboard,
        eventBus,
      );

      const { emitter, events } = createMockEmitter();
      const input = createKernelInput('test message', emitter);

      await expect(orchestrator.run(input)).resolves.not.toThrow();

      const errorEvents = events.filter(e => e.type === 'run.error');
      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
      const errorPayload = errorEvents[0] as any;
      expect(errorPayload.error).toContain('degraded tasks');
      expect(errorPayload.error).toContain('repair-1');
    });

    it('forwards runtime budget to execution layer and emits budget stop signal', async () => {
      const blackboard = new MultiAgentBlackboard();
      const eventBus = new MultiAgentEventBus();

      const mockAnalysisLayer = {
        run: vi.fn().mockResolvedValue({
          success: true,
          documents: [
            { id: 'doc-1', agentId: 'product-manager', createdAt: Date.now(), version: 1, content: {} },
            { id: 'doc-2', agentId: 'frontend-architect', createdAt: Date.now(), version: 1, content: {} },
            { id: 'doc-3', agentId: 'ui-expert', createdAt: Date.now(), version: 1, content: {} },
            { id: 'doc-4', agentId: 'ux-expert', createdAt: Date.now(), version: 1, content: {} },
          ],
        }),
      } as unknown as AnalysisLayer;

      const mockPlanningLayer = {
        run: vi.fn().mockResolvedValue({
          id: 'plan-1',
          createdAt: Date.now(),
          tasks: [],
        }),
      } as unknown as PlanningLayer;

      const mockExecutionLayer = {
        run: vi.fn().mockResolvedValue({
          success: false,
          patchIntents: [],
          touchedFiles: ['src/generated/task-1.ts'],
          degradedTasks: [],
          unresolvedIssues: ['maxToolCalls reached'],
          budgetStopReason: 'maxToolCalls',
        }),
      } as unknown as ExecutionLayer;

      const orchestrator = new ThreeLayerOrchestrator(
        mockAnalysisLayer,
        mockPlanningLayer,
        mockExecutionLayer,
        blackboard,
        eventBus,
      );

      const { emitter, events } = createMockEmitter();
      const input = createKernelInput('test budget message', emitter, {
        maxToolCalls: 1,
        maxIterations: 3,
      });

      await expect(orchestrator.run(input)).resolves.not.toThrow();

      expect(mockExecutionLayer.run).toHaveBeenCalledTimes(1);
      const executionInput = (mockExecutionLayer.run as any).mock.calls[0][0];
      expect(executionInput.runtimeBudget).toMatchObject({
        maxToolCalls: 1,
        maxIterations: 3,
      });

      const blockedEvent = events.find(event => event.type === 'agent.task.blocked');
      expect(blockedEvent).toBeDefined();
      expect((blockedEvent as any).reason).toContain('maxToolCalls');
    });
  });

  // =========================================================================
  // Test 3: Planning layer cycle detection error propagation (mock)
  // =========================================================================
  describe('Planning Layer Cycle Detection Error Propagation', () => {
    it('should propagate planning layer cycle detection errors', async () => {
      const blackboard = new MultiAgentBlackboard();
      const eventBus = new MultiAgentEventBus();

      // Stub analysis layer that succeeds
      const mockAnalysisLayer = {
        run: vi.fn().mockResolvedValue({
          success: true,
          documents: [
            { id: 'doc-1', agentId: 'product-manager', createdAt: Date.now(), version: 1, content: {} },
            { id: 'doc-2', agentId: 'frontend-architect', createdAt: Date.now(), version: 1, content: {} },
            { id: 'doc-3', agentId: 'ui-expert', createdAt: Date.now(), version: 1, content: {} },
            { id: 'doc-4', agentId: 'ux-expert', createdAt: Date.now(), version: 1, content: {} },
          ],
        }),
      } as unknown as AnalysisLayer;

      // Stub planning layer that throws a cycle detection error
      const mockPlanningLayer = {
        run: vi.fn().mockRejectedValue(
          new Error('Cycle detected in execution plan: task-1 → task-2 → task-1'),
        ),
      } as unknown as PlanningLayer;

      const mockExecutionLayer = {
        run: vi.fn(),
      } as unknown as ExecutionLayer;

      const orchestrator = new ThreeLayerOrchestrator(
        mockAnalysisLayer,
        mockPlanningLayer,
        mockExecutionLayer,
        blackboard,
        eventBus,
      );

      const { emitter, events } = createMockEmitter();
      const input = createKernelInput('test message', emitter);

      // Should throw the cycle detection error
      await expect(orchestrator.run(input)).rejects.toThrow(
        'Cycle detected in execution plan',
      );

      // Analysis layer should have been called
      expect(mockAnalysisLayer.run).toHaveBeenCalledTimes(1);

      // Execution layer should NOT have been called
      expect(mockExecutionLayer.run).not.toHaveBeenCalled();

      // Blackboard should have session documents (stored after analysis success)
      const docs = blackboard.getSessionDocuments();
      expect(docs.length).toBe(4);

      // Error event should have been emitted for planning failure
      const errorEvents = events.filter(e => e.type === 'run.error');
      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
      const errorPayload = errorEvents[0] as any;
      expect(errorPayload.error).toContain('planning');

      // EventBus should also have the error event
      const busEvents = eventBus.list();
      expect(busEvents.length).toBeGreaterThanOrEqual(1);
    });
  });
});
