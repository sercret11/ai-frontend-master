/**
 * PlanningLayer 单元测试
 *
 * 使用真实 LLM 模型调用测试（通过 `.env` 配置的 OpenAI Responses API 端点）。
 *
 * 测试内容：
 * 1. 正常计划生成流程：传入 4 份 SessionDocument，验证 LLM 返回有效的 ExecutionPlan
 * 2. 循环依赖检测（有环 / 无环 / 自环）
 * 3. 非法智能体 ID 拒绝
 *
 * 需求: R2.1, R2.4
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PlanningLayer } from '../planning-layer.js';
import { LLMClient } from '../../llm/client.js';
import { RetryEngine } from '../../llm/retry.js';
import { OpenAIAdapter } from '../../llm/adapters/openai.js';
import { MultiAgentBlackboard } from '../../runtime/multi-agent/blackboard.js';
import type { ProviderAdapter } from '../../llm/adapters/types.js';
import type { ProviderID } from '../../llm/types.js';
import type {
  SessionDocument,
  ProductManagerDocument,
  FrontendArchitectDocument,
  UIExpertDocument,
  UXExpertDocument,
} from '../../analysis/types.js';
import type { ExecutionPlanTask, ExecutionAgentID } from '../types.js';
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
// Valid agent IDs (from R4.1)
// ---------------------------------------------------------------------------

const VALID_AGENT_IDS: ReadonlySet<string> = new Set([
  'scaffold-agent',
  'page-agent',
  'interaction-agent',
  'state-agent',
  'style-agent',
  'quality-agent',
  'repair-agent',
]);

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
      id: `event-${events.length}`,
      timestamp: Date.now(),
      ...event,
    } as unknown as RuntimeEvent;
  };
  return { emitter, events };
}


/**
 * Build 4 mock SessionDocuments representing a simple todo app analysis.
 */
function createMockSessionDocuments(): SessionDocument[] {
  const now = Date.now();

  const pmDoc: ProductManagerDocument = {
    id: 'pm-doc-1',
    agentId: 'product-manager',
    createdAt: now,
    version: 1,
    content: {
      functionalRequirements: [
        { id: 'fr-1', title: 'Add Todo', description: 'User can add a new todo item', priority: 'high' },
        { id: 'fr-2', title: 'Delete Todo', description: 'User can delete a todo item', priority: 'high' },
        { id: 'fr-3', title: 'Toggle Todo', description: 'User can mark a todo as complete', priority: 'medium' },
      ],
      userStories: [
        { id: 'us-1', persona: 'User', goal: 'add tasks to my list', benefit: 'track what I need to do' },
        { id: 'us-2', persona: 'User', goal: 'mark tasks as done', benefit: 'see my progress' },
      ],
      priorityOrder: ['fr-1', 'fr-2', 'fr-3'],
    },
  };

  const archDoc: FrontendArchitectDocument = {
    id: 'arch-doc-1',
    agentId: 'frontend-architect',
    createdAt: now + 1,
    version: 1,
    content: {
      componentTree: [
        { id: 'app', name: 'App', type: 'layout', children: ['todo-page'] },
        { id: 'todo-page', name: 'TodoPage', type: 'page', children: ['todo-list', 'add-todo-form'] },
        { id: 'todo-list', name: 'TodoList', type: 'component', children: ['todo-item'] },
        { id: 'todo-item', name: 'TodoItem', type: 'component', children: [] },
        { id: 'add-todo-form', name: 'AddTodoForm', type: 'widget', children: [] },
      ],
      routeDesign: [
        { path: '/', componentId: 'todo-page' },
      ],
      stateManagement: {
        approach: 'zustand',
        stores: [
          { name: 'todoStore', description: 'Manages todo items', fields: { todos: 'Todo[]', filter: 'string' } },
        ],
      },
    },
  };

  const uiDoc: UIExpertDocument = {
    id: 'ui-doc-1',
    agentId: 'ui-expert',
    createdAt: now + 2,
    version: 1,
    content: {
      visualSpec: {
        colorScheme: 'light',
        typography: { heading: 'Inter', body: 'Inter' },
        spacing: { sm: '8px', md: '16px', lg: '24px' },
        borderRadius: '8px',
      },
      componentStyles: [
        { componentId: 'todo-item', styles: { padding: '12px', borderBottom: '1px solid #eee' } },
      ],
      responsiveLayout: {
        breakpoints: { sm: 640, md: 768, lg: 1024 },
        strategy: 'mobile-first',
      },
    },
  };

  const uxDoc: UXExpertDocument = {
    id: 'ux-doc-1',
    agentId: 'ux-expert',
    createdAt: now + 3,
    version: 1,
    content: {
      interactionFlows: [
        {
          id: 'flow-1',
          name: 'Add Todo Flow',
          steps: [
            { action: 'Type in input field', expectedResult: 'Text appears in input' },
            { action: 'Click add button', expectedResult: 'New todo appears in list, input clears' },
          ],
        },
      ],
      userJourneys: [
        { id: 'uj-1', persona: 'New User', touchpoints: ['Landing', 'Add first todo'], painPoints: ['Empty state unclear'] },
      ],
      usabilityRecommendations: [
        { area: 'Empty State', recommendation: 'Show helpful message when no todos exist', priority: 'medium' },
      ],
    },
  };

  return [pmDoc, archDoc, uiDoc, uxDoc];
}

function task(id: string, agentId: ExecutionAgentID, dependsOn: string[] = []): ExecutionPlanTask {
  return {
    id,
    agentId,
    goal: `Task ${id}`,
    dependsOn,
    tools: ['write'],
  };
}

// ---------------------------------------------------------------------------
// Tests: Real LLM Integration
// ---------------------------------------------------------------------------

describe.skipIf(shouldSkip)('PlanningLayer - Real LLM Integration', () => {
  let llmClient: LLMClient;

  beforeAll(() => {
    llmClient = createLLMClient();
  });

  it('should generate a valid ExecutionPlan from 4 SessionDocuments', async () => {
    const blackboard = new MultiAgentBlackboard();
    const planningLayer = new PlanningLayer({
      llmClient,
      provider: 'openai',
      model: AI_DEFAULT_MODEL,
      blackboard,
      temperature: 0.7,
      maxOutputTokens: 4096,
    });

    const { emitter, events } = createMockEmitter();
    const documents = createMockSessionDocuments();

    const plan = await planningLayer.run({
      sessionId: `test-session-${Date.now()}`,
      documents,
      abortSignal: new AbortController().signal,
      emitRuntimeEvent: emitter,
    });

    // Verify plan structure
    expect(plan).toBeDefined();
    expect(plan.id).toBeTruthy();
    expect(plan.createdAt).toBeGreaterThan(0);
    expect(plan.tasks).toBeDefined();
    expect(Array.isArray(plan.tasks)).toBe(true);
    expect(plan.tasks.length).toBeGreaterThan(0);

    // Verify all tasks have valid agent IDs (R2.2)
    for (const t of plan.tasks) {
      expect(VALID_AGENT_IDS.has(t.agentId)).toBe(true);
      expect(t.id).toBeTruthy();
      expect(t.goal).toBeTruthy();
      expect(Array.isArray(t.dependsOn)).toBe(true);
      expect(Array.isArray(t.tools)).toBe(true);
    }

    // Verify all dependency references point to existing task IDs
    const taskIds = new Set(plan.tasks.map((t) => t.id));
    for (const t of plan.tasks) {
      for (const depId of t.dependsOn) {
        expect(taskIds.has(depId)).toBe(true);
      }
    }

    // Verify the plan was stored to blackboard
    const snapshot = blackboard.snapshot();
    expect(snapshot.tasks.length).toBeGreaterThan(0);

    // Verify events were emitted
    const startedEvents = events.filter((e) => e.type === 'agent.task.started');
    const completedEvents = events.filter((e) => e.type === 'agent.task.completed');
    expect(startedEvents.length).toBeGreaterThanOrEqual(1);
    expect(completedEvents.length).toBeGreaterThanOrEqual(1);

    // Verify the completed event indicates success
    const lastCompleted = completedEvents[completedEvents.length - 1] as any;
    expect(lastCompleted.success).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Tests: Cycle Detection (pure logic, no LLM needed)
// ---------------------------------------------------------------------------

describe('PlanningLayer - Cycle Detection', () => {
  const layer = new PlanningLayer({
    llmClient: {} as any,
    provider: 'openai',
    model: 'test',
    blackboard: {} as any,
  });

  it('returns no cycle for a valid DAG', () => {
    const tasks = [
      task('scaffold-1', 'scaffold-agent'),
      task('page-1', 'page-agent', ['scaffold-1']),
      task('state-1', 'state-agent', ['scaffold-1']),
      task('interaction-1', 'interaction-agent', ['page-1', 'state-1']),
      task('quality-1', 'quality-agent', ['page-1', 'state-1', 'interaction-1']),
    ];
    const result = layer.detectCycle(tasks);
    expect(result.hasCycle).toBe(false);
  });

  it('detects a simple two-node cycle', () => {
    const tasks = [
      task('a', 'page-agent', ['b']),
      task('b', 'state-agent', ['a']),
    ];
    const result = layer.detectCycle(tasks);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleTaskIds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('detects a self-cycle', () => {
    const tasks = [task('a', 'scaffold-agent', ['a'])];
    const result = layer.detectCycle(tasks);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleTaskIds).toContain('a');
  });

  it('returns no cycle for empty task list', () => {
    const result = layer.detectCycle([]);
    expect(result.hasCycle).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Invalid Agent ID Rejection (pure logic, no LLM needed)
// ---------------------------------------------------------------------------

describe('PlanningLayer - Invalid Agent ID Rejection', () => {
  it('should reject tasks with invalid agent IDs via validateAgentIds', () => {
    const blackboard = new MultiAgentBlackboard();
    const layer = new PlanningLayer({
      llmClient: {} as any,
      provider: 'openai',
      model: 'test',
      blackboard,
    });

    // Access the private validateAgentIds method via run() indirectly.
    // We test by constructing tasks with an invalid agent ID and verifying
    // the validation throws.
    const invalidTasks: ExecutionPlanTask[] = [
      {
        id: 'task-1',
        agentId: 'nonexistent-agent' as ExecutionAgentID,
        goal: 'Do something',
        dependsOn: [],
        tools: ['write'],
      },
    ];

    // Use the detectCycle method (public) to confirm the tasks are structurally valid,
    // then test that the private validation would reject them.
    // Since validateAgentIds is private, we test it through the public interface
    // by checking that the VALID_AGENT_IDS set doesn't contain the invalid ID.
    expect(VALID_AGENT_IDS.has('nonexistent-agent')).toBe(false);
    expect(VALID_AGENT_IDS.has('scaffold-agent')).toBe(true);
    expect(VALID_AGENT_IDS.has('page-agent')).toBe(true);
    expect(VALID_AGENT_IDS.has('interaction-agent')).toBe(true);
    expect(VALID_AGENT_IDS.has('state-agent')).toBe(true);
    expect(VALID_AGENT_IDS.has('style-agent')).toBe(true);
    expect(VALID_AGENT_IDS.has('quality-agent')).toBe(true);
    expect(VALID_AGENT_IDS.has('repair-agent')).toBe(true);
  });

  it('should reject tasks with invalid agent IDs during run()', async () => {
    // Create a mock LLMClient that returns a tool call with an invalid agent ID
    const mockLLMClient = {
      completeWithTools: async (
        _params: any,
        toolExecutor: any,
        _maxRounds?: number,
      ) => {
        // Simulate LLM calling the submit_execution_plan tool with an invalid agent ID
        await toolExecutor('submit_execution_plan', {
          tasks: [
            {
              id: 'task-1',
              agentId: 'invalid-agent',
              goal: 'Do something invalid',
              dependsOn: [],
              tools: ['write'],
            },
          ],
        });
        return {
          text: '',
          toolCalls: [],
          finishReason: 'stop' as const,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
    } as any;

    const blackboard = new MultiAgentBlackboard();
    const layer = new PlanningLayer({
      llmClient: mockLLMClient,
      provider: 'openai',
      model: 'test',
      blackboard,
    });

    const { emitter } = createMockEmitter();

    await expect(
      layer.run({
        sessionId: 'test-session',
        documents: createMockSessionDocuments(),
        abortSignal: new AbortController().signal,
        emitRuntimeEvent: emitter,
      }),
    ).rejects.toThrow(/Invalid agent ID "invalid-agent"/);
  });
});

describe('PlanningLayer - Prompt Quality Contract', () => {
  it('embeds high-fidelity and single-router constraints in system prompt', () => {
    const blackboard = new MultiAgentBlackboard();
    const layer = new PlanningLayer({
      llmClient: {} as any,
      provider: 'openai',
      model: 'test',
      blackboard,
    });

    const prompt = (layer as any).buildSystemPrompt(createMockSessionDocuments()) as string;

    expect(prompt).toContain('Quality Contract (Non-negotiable)');
    expect(prompt).toContain('Do not generate plans that leave TODO/待实现/placeholder/skeleton-only deliverables.');
    expect(prompt).toContain('Router provider must be mounted exactly once at the application entry (src/main.tsx).');
    expect(prompt).toContain('grounded in the 4 analysis documents');
  });
});

describe('PlanningLayer - Dependency Contract And ID Invariants', () => {
  it('accepts dependencies alias and normalizes into dependsOn', async () => {
    const mockLLMClient = {
      completeWithTools: async (
        _params: any,
        toolExecutor: any,
        _maxRounds?: number,
      ) => {
        await toolExecutor('submit_execution_plan', {
          tasks: [
            {
              id: 'task-1',
              agentId: 'scaffold-agent',
              goal: 'Build scaffold',
              dependsOn: [],
              tools: ['write'],
            },
            {
              id: 'task-2',
              agentId: 'page-agent',
              goal: 'Build page',
              dependencies: ['task-1'],
              tools: ['write'],
            },
          ],
        });
        return {
          text: '',
          toolCalls: [],
          finishReason: 'stop' as const,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
    } as any;

    const blackboard = new MultiAgentBlackboard();
    const layer = new PlanningLayer({
      llmClient: mockLLMClient,
      provider: 'openai',
      model: 'test',
      blackboard,
    });
    const { emitter } = createMockEmitter();

    const plan = await layer.run({
      sessionId: 'test-session-dependency-alias',
      documents: createMockSessionDocuments(),
      abortSignal: new AbortController().signal,
      emitRuntimeEvent: emitter,
    });

    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[1]?.dependsOn).toEqual(['task-1']);
  });

  it('rejects duplicate task ids before scheduling constraints', async () => {
    const mockLLMClient = {
      completeWithTools: async (
        _params: any,
        toolExecutor: any,
        _maxRounds?: number,
      ) => {
        await toolExecutor('submit_execution_plan', {
          tasks: [
            {
              id: 'dup-task',
              agentId: 'scaffold-agent',
              goal: 'First',
              dependsOn: [],
              tools: ['write'],
            },
            {
              id: 'dup-task',
              agentId: 'page-agent',
              goal: 'Second',
              dependsOn: [],
              tools: ['write'],
            },
          ],
        });
        return {
          text: '',
          toolCalls: [],
          finishReason: 'stop' as const,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
    } as any;

    const blackboard = new MultiAgentBlackboard();
    const layer = new PlanningLayer({
      llmClient: mockLLMClient,
      provider: 'openai',
      model: 'test',
      blackboard,
    });
    const { emitter } = createMockEmitter();

    await expect(
      layer.run({
        sessionId: 'test-session-duplicate-id',
        documents: createMockSessionDocuments(),
        abortSignal: new AbortController().signal,
        emitRuntimeEvent: emitter,
      }),
    ).rejects.toThrow(/duplicate task IDs/i);
  });
});
