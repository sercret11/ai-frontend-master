import type { AgentRuntimeID } from '@ai-frontend/shared-types';
import { MultiAgentBlackboard } from './blackboard';
import { MultiAgentEventBus } from './event-bus';
import type {
  MultiAgentKernelInput,
  MultiAgentTask,
} from './types';

// Three-layer architecture imports
import { AnalysisLayer } from '../../analysis/analysis-layer';
import { PlanningLayer } from '../../planning/planning-layer';
import { ExecutionLayer } from '../../execution/execution-layer';
import { ThreeLayerOrchestrator } from '../../orchestration/three-layer-orchestrator';

// LLM infrastructure imports
import { LLMClient } from '../../llm/client';
import { RetryEngine } from '../../llm/retry';
import { OpenAIAdapter } from '../../llm/adapters/openai';
import { AnthropicAdapter } from '../../llm/adapters/anthropic';
import { GoogleAdapter } from '../../llm/adapters/google';
import type { ProviderID } from '../../llm/types';
import type { ProviderAdapter } from '../../llm/adapters/types';

/**
 * Legacy wave-based task definitions.
 *
 * These are no longer used for execution (the ThreeLayerOrchestrator handles
 * scheduling), but are kept so that `getBlackboardSnapshot()` returns a
 * backwards-compatible shape for any consumers that inspect the task list.
 */
const MULTI_AGENT_TASKS: MultiAgentTask[] = [
  {
    id: 'task-planner',
    title: 'Planning',
    agentId: 'planner-agent',
    wave: 1,
    dependsOn: [],
    goal: 'decompose request into an executable graph',
  },
  {
    id: 'task-architect',
    title: 'Architecture Baseline',
    agentId: 'architect-agent',
    wave: 2,
    dependsOn: ['task-planner'],
    goal: 'stabilize architecture boundaries and contracts',
  },
  {
    id: 'task-research',
    title: 'Research Context',
    agentId: 'research-agent',
    wave: 3,
    dependsOn: ['task-architect'],
    goal: 'prepare framework and dependency context',
  },
  {
    id: 'task-page',
    title: 'Page Build',
    agentId: 'page-agent',
    wave: 3,
    dependsOn: ['task-architect'],
    goal: 'implement page-level structure',
  },
  {
    id: 'task-interaction',
    title: 'Interaction Build',
    agentId: 'interaction-agent',
    wave: 3,
    dependsOn: ['task-architect'],
    goal: 'implement interaction flow and UX state transitions',
  },
  {
    id: 'task-state',
    title: 'State Build',
    agentId: 'state-agent',
    wave: 3,
    dependsOn: ['task-architect'],
    goal: 'implement store and state contract',
  },
  {
    id: 'task-quality',
    title: 'Quality Gate',
    agentId: 'quality-agent',
    wave: 4,
    dependsOn: ['task-research', 'task-page', 'task-interaction', 'task-state'],
    goal: 'evaluate delivery quality and output acceptance state',
  },
];

export class MultiAgentKernel {
  private readonly eventBus = new MultiAgentEventBus();
  private readonly blackboard = new MultiAgentBlackboard();

  constructor(private readonly input: MultiAgentKernelInput) {
    // Register legacy tasks for backwards-compatible blackboard snapshots.
    this.blackboard.setTasks(MULTI_AGENT_TASKS);
  }

  /**
   * Run the three-layer orchestration pipeline.
   *
   * Internally creates the AnalysisLayer, PlanningLayer, ExecutionLayer and
   * ThreeLayerOrchestrator, then delegates the full run to the orchestrator.
   *
   * The public interface (constructor, run, getEventLog, getBlackboardSnapshot)
   * remains unchanged so that the API layer and WebSocket layer require no
   * modifications.
   *
   * 需求: R10.1, R10.2, R10.3
   */
  async run(): Promise<void> {
    // ------------------------------------------------------------------
    // 1. Build LLMClient from environment configuration
    // ------------------------------------------------------------------
    const provider = (this.input.modelProvider ?? process.env.AI_DEFAULT_PROVIDER ?? 'openai') as ProviderID;
    const model = this.input.modelId ?? process.env.AI_DEFAULT_MODEL ?? 'gpt-4o';

    const adapters = new Map<ProviderID, ProviderAdapter>();
    adapters.set(
      'openai',
      new OpenAIAdapter({
        baseUrl: process.env.OPENAI_BASE_URL,
        apiKey: process.env.OPENAI_API_KEY ?? '',
        protocol: 'responses',
        providerId: 'openai',
      }),
    );
    adapters.set(
      'anthropic',
      new AnthropicAdapter({
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      }),
    );
    adapters.set(
      'google',
      new GoogleAdapter({
        baseUrl: process.env.GOOGLE_BASE_URL,
        apiKey: process.env.GOOGLE_API_KEY ?? '',
      }),
    );
    adapters.set(
      'zhipuai',
      new OpenAIAdapter({
        baseUrl: process.env.ZHIPUAI_BASE_URL,
        apiKey: process.env.ZHIPUAI_API_KEY ?? '',
        protocol: 'chat-completions',
        providerId: 'zhipuai',
      }),
    );
    adapters.set(
      'dashscope',
      new OpenAIAdapter({
        baseUrl: process.env.DASHSCOPE_BASE_URL,
        apiKey: process.env.DASHSCOPE_API_KEY ?? '',
        protocol: 'chat-completions',
        providerId: 'dashscope',
      }),
    );

    const retryEngine = new RetryEngine();
    const llmClient = new LLMClient(adapters, retryEngine);

    // ------------------------------------------------------------------
    // 2. Instantiate the three layers
    // ------------------------------------------------------------------
    const analysisLayer = new AnalysisLayer({
      llmClient,
      provider,
      model,
    });

    const planningLayer = new PlanningLayer({
      llmClient,
      provider,
      model,
      blackboard: this.blackboard,
    });

    const executionLayer = new ExecutionLayer(
      this.blackboard,
      llmClient,
      provider,
      model,
    );

    // ------------------------------------------------------------------
    // 3. Create orchestrator and delegate
    // ------------------------------------------------------------------
    const orchestrator = new ThreeLayerOrchestrator(
      analysisLayer,
      planningLayer,
      executionLayer,
      this.blackboard,
      this.eventBus,
    );

    // Wrap emitRuntimeEvent so events are also published to our local
    // eventBus, keeping getEventLog() functional.
    const originalEmit = this.input.emitRuntimeEvent;
    const wrappedInput: MultiAgentKernelInput = {
      ...this.input,
      runtimeBudget: this.input.runtimeBudget,
      emitRuntimeEvent: (event) => {
        const runtimeEvent = originalEmit(event);
        this.eventBus.publish(runtimeEvent);
        return runtimeEvent;
      },
    };

    await orchestrator.run(wrappedInput);
  }

  getEventLog() {
    return this.eventBus.list();
  }

  getBlackboardSnapshot() {
    return this.blackboard.snapshot();
  }
}

export function createMultiAgentTaskMap(tasks: MultiAgentTask[]): Map<AgentRuntimeID, MultiAgentTask[]> {
  const map = new Map<AgentRuntimeID, MultiAgentTask[]>();
  tasks.forEach(task => {
    const list = map.get(task.agentId) || [];
    list.push(task);
    map.set(task.agentId, list);
  });
  return map;
}
