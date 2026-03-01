/**
 * PlanningLayer - 规划层核心逻辑
 *
 * 接收分析层的 4 份 SessionDocument，通过 LLM 工具调用生成结构化的 ExecutionPlan。
 * 验证计划仅引用合法的 ExecutionAgentID，并将计划存储到 Blackboard。
 *
 * 需求: R2.1, R2.2, R2.3, R2.5
 */

import { randomUUID } from 'node:crypto';
import type { LLMClient } from '../llm/client.js';
import type { ProviderID, ToolDefinition, ToolExecutor } from '../llm/types.js';
import type { SessionDocument } from '../analysis/types.js';
import type { MultiAgentBlackboard } from '../runtime/multi-agent/blackboard.js';
import type {
  ExecutionPlan,
  ExecutionPlanTask,
  ExecutionAgentID,
  PlanningLayerInput,
} from './types.js';
import { normalizeTaskDependencies, validateUniqueTaskIds } from '../orchestration/scheduler.js';

// ============================================================================
// Valid agent IDs and their allowed tools (from R4.1)
// ============================================================================

const VALID_AGENT_IDS: ReadonlySet<ExecutionAgentID> = new Set<ExecutionAgentID>([
  'scaffold-agent',
  'page-agent',
  'interaction-agent',
  'state-agent',
  'style-agent',
  'quality-agent',
  'repair-agent',
]);

const AGENT_ALLOWED_TOOLS: Record<ExecutionAgentID, readonly string[]> = {
  'scaffold-agent': ['write', 'apply_diff', 'read'],
  'page-agent': ['read', 'grep', 'glob', 'apply_diff', 'write'],
  'interaction-agent': ['read', 'grep', 'glob', 'apply_diff', 'write'],
  'state-agent': ['read', 'grep', 'glob', 'apply_diff', 'write'],
  'style-agent': ['read', 'grep', 'glob', 'apply_diff', 'write', 'design_search', 'get_color_palette', 'get_typography_pair'],
  'quality-agent': ['read', 'grep', 'glob', 'bash'],
  'repair-agent': ['read', 'grep', 'glob', 'apply_diff', 'write', 'bash'],
};

const DEFAULT_PLANNING_TIMEOUT_MS = 120_000;
const MIN_PLANNING_TIMEOUT_MS = 30_000;
const MAX_PLANNING_TIMEOUT_MS = 300_000;
const RETRY_PLANNING_TIMEOUT_MS = 45_000;

// ============================================================================
// Tool schema for structured LLM output
// ============================================================================

const EXECUTION_PLAN_TOOL: ToolDefinition = {
  name: 'submit_execution_plan',
  description: `Generate an execution plan for the frontend project. The plan contains a list of tasks, each assigned to one of the 7 execution agents: scaffold-agent, page-agent, interaction-agent, state-agent, style-agent, quality-agent, repair-agent. Tasks must specify dependencies (dependsOn) to define execution order. Typical dependency pattern: scaffold-agent runs first (no deps), then page-agent/state-agent/style-agent depend on scaffold, interaction-agent depends on page+state, quality-agent depends on all code-gen agents, repair-agent depends on quality-agent.`,
  inputSchema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'List of execution tasks',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique task identifier (e.g., "task-scaffold-1", "task-page-1")',
            },
            agentId: {
              type: 'string',
              enum: [
                'scaffold-agent',
                'page-agent',
                'interaction-agent',
                'state-agent',
                'style-agent',
                'quality-agent',
                'repair-agent',
              ],
              description: 'The execution agent assigned to this task',
            },
            goal: {
              type: 'string',
              description: 'Clear description of what this task should accomplish',
            },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of tasks that must complete before this task can start',
            },
            tools: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tool IDs available for this task',
            },
          },
          required: ['id', 'agentId', 'goal', 'dependsOn', 'tools'],
        },
      },
    },
    required: ['tasks'],
  },
};

// ============================================================================
// PlanningLayer config & class
// ============================================================================

export interface PlanningLayerConfig {
  llmClient: LLMClient;
  provider: ProviderID;
  model: string;
  blackboard: MultiAgentBlackboard;
  temperature?: number;
  maxOutputTokens?: number;
  planningTimeoutMs?: number;
}

export class PlanningLayer {
  private llmClient: LLMClient;
  private provider: ProviderID;
  private model: string;
  private blackboard: MultiAgentBlackboard;
  private temperature?: number;
  private maxOutputTokens?: number;
  private planningTimeoutMs: number;

  constructor(config: PlanningLayerConfig) {
    this.llmClient = config.llmClient;
    this.provider = config.provider;
    this.model = config.model;
    this.blackboard = config.blackboard;
    this.temperature = config.temperature;
    this.maxOutputTokens = config.maxOutputTokens;
    this.planningTimeoutMs =
      config.planningTimeoutMs ?? this.resolvePlanningTimeoutMs();
  }

  /**
   * Generate an ExecutionPlan from the analysis layer's SessionDocuments.
   *
   * 1. Build a system prompt that includes all 4 SessionDocuments
   * 2. Call LLM with tool calling (submit_execution_plan tool)
   * 3. Parse the tool call arguments into an ExecutionPlan
   * 4. Validate agent IDs and tool assignments
   * 5. Store the plan to Blackboard
   */
  async run(input: PlanningLayerInput): Promise<ExecutionPlan> {
    // Emit planning started event
    input.emitRuntimeEvent({
      type: 'agent.task.started',
      agentId: 'planner-agent',
      taskId: 'planning',
      waveId: 'planning',
      title: '规划层',
      goal: '根据分析文档生成执行计划',
    });

    try {
      const systemPrompt = this.buildSystemPrompt(input.documents);

      // Use tool executor that captures the tool call result
      let planTasks: ExecutionPlanTask[] | null = null;

      const toolExecutor: ToolExecutor = async (name, args) => {
        if (name === 'submit_execution_plan') {
          const rawTasks = args.tasks as Array<Record<string, unknown>>;
          planTasks = rawTasks.map((t) => ({
            id: String(t.id),
            agentId: String(t.agentId) as ExecutionAgentID,
            goal: String(t.goal),
            dependsOn: normalizeTaskDependencies({
              dependsOn: t.dependsOn,
              dependencies: t.dependencies,
            }),
            tools: Array.isArray(t.tools) ? t.tools.map(String) : [],
          }));
          return { content: 'Execution plan received successfully.' };
        }
        return { content: `Unknown tool: ${name}`, isError: true };
      };

      await this.completePlanWithRetry(input, systemPrompt, toolExecutor);

      if (!planTasks || (planTasks as ExecutionPlanTask[]).length === 0) {
        throw new Error('LLM did not generate an execution plan via tool call');
      }

      const normalizedTaskIds = validateUniqueTaskIds(planTasks);
      planTasks = planTasks.map((task, index) => ({
        ...task,
        id: normalizedTaskIds[index],
        dependsOn: normalizeTaskDependencies(task),
      }));

      // Validate agent IDs
      this.validateAgentIds(planTasks);

      // Validate tool assignments
      this.validateToolAssignments(planTasks);

      // Validate dependency references
      this.validateDependencies(planTasks);

      // Detect circular dependencies (R2.4)
      const cycleResult = this.detectCycle(planTasks);
      if (cycleResult.hasCycle) {
        const ids = cycleResult.cycleTaskIds?.join(', ') ?? 'unknown';
        throw new Error(
          `Circular dependency detected in execution plan. Tasks involved: ${ids}`,
        );
      }

      // Build the ExecutionPlan
      const plan: ExecutionPlan = {
        id: randomUUID(),
        createdAt: Date.now(),
        tasks: planTasks,
      };

      // Store to Blackboard (R2.5)
      this.storeToBlackboard(plan);

      // Emit planning completed event
      input.emitRuntimeEvent({
        type: 'agent.task.completed',
        agentId: 'planner-agent',
        taskId: 'planning',
        waveId: 'planning',
        success: true,
        summary: `执行计划生成完成，包含 ${plan.tasks.length} 个任务`,
      });

      return plan;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      input.emitRuntimeEvent({
        type: 'agent.task.completed',
        agentId: 'planner-agent',
        taskId: 'planning',
        waveId: 'planning',
        success: false,
        summary: `规划层失败: ${errorMessage}`,
      });

      throw error;
    }
  }

  /**
   * Detect cycles in the task dependency graph using Kahn's algorithm
   * (topological sort). If a cycle exists, returns the IDs of tasks
   * participating in the cycle.
   *
   * 需求: R2.4
   */
  detectCycle(tasks: ExecutionPlanTask[]): { hasCycle: boolean; cycleTaskIds?: string[] } {
    if (tasks.length === 0) {
      return { hasCycle: false };
    }

    // Build adjacency list and in-degree map
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const task of tasks) {
      if (!inDegree.has(task.id)) {
        inDegree.set(task.id, 0);
      }
      if (!adjacency.has(task.id)) {
        adjacency.set(task.id, []);
      }
    }

    // For each dependency edge: dependsOn means "must come before",
    // so if task B dependsOn task A, there's an edge A → B
    for (const task of tasks) {
      for (const depId of normalizeTaskDependencies(task)) {
        // Only count edges to known task IDs (invalid deps are caught elsewhere)
        if (inDegree.has(depId)) {
          adjacency.get(depId)!.push(task.id);
          inDegree.set(task.id, inDegree.get(task.id)! + 1);
        }
      }
    }

    // Kahn's algorithm: start with all nodes that have in-degree 0
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) {
        queue.push(id);
      }
    }

    let processedCount = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;
      processedCount++;

      for (const neighbor of adjacency.get(current) ?? []) {
        const newDeg = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If we couldn't process all nodes, there's a cycle
    if (processedCount < tasks.length) {
      // Collect the task IDs that are part of the cycle (remaining nodes with in-degree > 0)
      const cycleTaskIds = Array.from(inDegree.entries())
        .filter(([_, deg]) => deg > 0)
        .map(([id]) => id);

      return { hasCycle: true, cycleTaskIds };
    }

    return { hasCycle: false };
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private async completePlanWithRetry(
    input: PlanningLayerInput,
    systemPrompt: string,
    toolExecutor: ToolExecutor,
  ): Promise<void> {
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptTimeoutMs =
        attempt > 1
          ? Math.min(this.planningTimeoutMs, RETRY_PLANNING_TIMEOUT_MS)
          : this.planningTimeoutMs;
      const hardTimeoutMs = attemptTimeoutMs + 5_000;
      try {
        await this.withHardTimeout(
          this.llmClient.completeWithTools(
            {
              provider: this.provider,
              model: this.model,
              systemPrompt,
              messages: [
                {
                  role: 'user',
                  content: 'Based on the analysis documents provided in the system prompt, generate an execution plan for this frontend project. Use the submit_execution_plan tool to submit the plan.',
                },
              ],
              tools: [EXECUTION_PLAN_TOOL],
              temperature: this.temperature,
              maxOutputTokens: this.maxOutputTokens,
              abortSignal: this.createPlanningAbortSignal(
                input.abortSignal,
                attemptTimeoutMs,
              ),
            },
            toolExecutor,
            3, // max 3 rounds should be enough for plan generation
          ),
          hardTimeoutMs,
          `Planning layer hard timed out after ${hardTimeoutMs}ms`,
        );
        return;
      } catch (error: unknown) {
        const shouldRetry =
          attempt < maxAttempts &&
          !input.abortSignal.aborted &&
          this.isTransientPlanningFailure(error);
        if (shouldRetry) {
          const retryAttempt = attempt + 1;
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.warn(
            `[PlanningLayer] transient-error retry=${retryAttempt}/${maxAttempts} error=${errorMessage}`,
          );
          input.emitRuntimeEvent({
            type: 'agent.task.progress',
            agentId: 'planner-agent',
            taskId: 'planning',
            waveId: 'planning',
            progressText: `规划层遇到瞬时异常，重试中 (${retryAttempt}/${maxAttempts})`,
          });
          continue;
        }
        throw error;
      }
    }
  }

  private resolvePlanningTimeoutMs(): number {
    const timeoutMs = Number(
      process.env.PLANNING_LAYER_TIMEOUT_MS ?? DEFAULT_PLANNING_TIMEOUT_MS,
    );
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return DEFAULT_PLANNING_TIMEOUT_MS;
    }
    return Math.min(
      Math.max(Math.floor(timeoutMs), MIN_PLANNING_TIMEOUT_MS),
      MAX_PLANNING_TIMEOUT_MS,
    );
  }

  private withHardTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const timeoutError = new Error(message) as Error & { name: string };
        timeoutError.name = 'TimeoutError';
        reject(timeoutError);
      }, timeoutMs);
      timeout.unref?.();
      promise.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }

  private createPlanningAbortSignal(parentSignal: AbortSignal, timeoutMs: number): AbortSignal {
    if (timeoutMs <= 0) {
      return parentSignal;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      const timeoutError = new Error(
        `Planning layer timed out after ${timeoutMs}ms`,
      ) as Error & { name: string };
      timeoutError.name = 'TimeoutError';
      if (!controller.signal.aborted) {
        controller.abort(timeoutError);
      }
    }, timeoutMs);

    const clearTimeoutIfNeeded = () => {
      clearTimeout(timeout);
    };
    controller.signal.addEventListener('abort', clearTimeoutIfNeeded, { once: true });

    if (parentSignal.aborted) {
      clearTimeoutIfNeeded();
      if (!controller.signal.aborted) {
        controller.abort(parentSignal.reason ?? new DOMException('Aborted', 'AbortError'));
      }
      return controller.signal;
    }

    parentSignal.addEventListener(
      'abort',
      () => {
        clearTimeoutIfNeeded();
        if (!controller.signal.aborted) {
          controller.abort(parentSignal.reason ?? new DOMException('Aborted', 'AbortError'));
        }
      },
      { once: true },
    );

    return controller.signal;
  }

  private isTransientPlanningFailure(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const details = error as Error & {
      code?: string | number;
      status?: number;
      statusCode?: number;
      cause?: unknown;
    };
    if (details.name === 'TimeoutError') {
      return true;
    }
    if (details.statusCode === 0 || details.status === 0) {
      return true;
    }

    const status =
      typeof details.statusCode === 'number'
        ? details.statusCode
        : typeof details.status === 'number'
          ? details.status
          : undefined;
    if (status !== undefined && (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500)) {
      return true;
    }

    const rawCode =
      typeof details.code === 'number'
        ? String(details.code)
        : typeof details.code === 'string'
          ? details.code
          : '';
    const code = rawCode.toLowerCase();
    if (
      code.includes('timeout') ||
      code.includes('etimedout') ||
      code.includes('econnreset') ||
      code.includes('econnaborted') ||
      code.includes('overloaded') ||
      code.includes('rate_limit')
    ) {
      return true;
    }

    const message = details.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('temporar') ||
      message.includes('rate limit') ||
      message.includes('overloaded')
    );
  }

  private buildSystemPrompt(documents: SessionDocument[]): string {
    const docSections = documents.map((doc) => {
      const header = `## ${doc.agentId} (ID: ${doc.id})`;
      const content = JSON.stringify(doc.content, null, 2);
      return `${header}\n\`\`\`json\n${content}\n\`\`\``;
    });

    return `You are the Planning Layer of a multi-agent frontend code generation system.

Your job is to analyze the following 4 analysis documents and generate an execution plan that assigns tasks to the 7 available execution agents.

# Analysis Documents

${docSections.join('\n\n')}

# Available Execution Agents

| Agent ID | Responsibility | Allowed Tools |
|---|---|---|
| scaffold-agent | Project scaffolding: package.json, entry files, routing config, tsconfig, vite config, directory structure | write, apply_diff, read |
| page-agent | Page components, route views, page layouts | read, grep, glob, apply_diff, write |
| interaction-agent | Interaction logic: forms, events, modals, validation | read, grep, glob, apply_diff, write |
| state-agent | State management: stores, data flow, hooks, API layer | read, grep, glob, apply_diff, write |
| style-agent | Styling: themes, design tokens, global styles, responsive layout | read, grep, glob, apply_diff, write, design_search, get_color_palette, get_typography_pair |
| quality-agent | Code verification: file completeness, imports, types, routing | read, grep, glob, bash |
| repair-agent | Fix quality issues: missing files, import paths, type definitions | read, grep, glob, apply_diff, write, bash |

# Dependency Rules

- scaffold-agent MUST run first (Wave 1, no dependencies)
- page-agent, state-agent, style-agent depend on scaffold-agent (Wave 2)
- interaction-agent depends on page-agent and state-agent (Wave 3)
- quality-agent depends on all code generation agents (Wave 4)
- repair-agent depends on quality-agent (Wave 5, only if needed)

# Quality Contract (Non-negotiable)

- Every task must contribute to a complete, interactive, production-grade prototype outcome.
- Do not generate plans that leave TODO/待实现/placeholder/skeleton-only deliverables.
- Router provider must be mounted exactly once at the application entry (src/main.tsx). Do not mount BrowserRouter/RouterProvider again inside App or route modules.
- Route semantics, page naming, and workflows must be grounded in the 4 analysis documents (product-manager, frontend-architect, ui-expert, ux-expert).
- Do not output generic navigation-only plans (for example only dashboard/settings/modules/list detail shells without concrete product workflows).
- Ensure interaction-agent and state-agent tasks explicitly cover event handlers, validation feedback, and loading/success/error UI transitions for core flows.

# Instructions

1. Analyze the documents to understand the project requirements, architecture, UI design, and UX flows.
2. Create tasks for each agent based on the project needs and the quality contract above.
3. Each task must specify: id, agentId, goal (clear description), dependsOn (task IDs), tools (from the agent's allowed tools).
4. Only use the 7 agent IDs listed above.
5. Only assign tools from each agent's allowed tools list.
6. The plan must be executable without placeholder text or missing interaction flows.
7. Call the submit_execution_plan tool with the complete task list.`;  
  }

  /**
   * Validate that all tasks reference valid ExecutionAgentIDs.
   */
  private validateAgentIds(tasks: ExecutionPlanTask[]): void {
    for (const task of tasks) {
      if (!VALID_AGENT_IDS.has(task.agentId)) {
        throw new Error(
          `Invalid agent ID "${task.agentId}" in task "${task.id}". ` +
          `Valid IDs: ${Array.from(VALID_AGENT_IDS).join(', ')}`,
        );
      }
    }
  }

  /**
   * Validate that each task only uses tools allowed for its agent.
   */
  private validateToolAssignments(tasks: ExecutionPlanTask[]): void {
    for (const task of tasks) {
      const allowedTools = AGENT_ALLOWED_TOOLS[task.agentId];
      if (!allowedTools) continue;

      for (const tool of task.tools) {
        if (!allowedTools.includes(tool)) {
          // Auto-fix: filter out unauthorized tools rather than throwing
          task.tools = task.tools.filter((t) => allowedTools.includes(t));
          break;
        }
      }

      // Ensure at least the agent's allowed tools are assigned
      if (task.tools.length === 0) {
        task.tools = [...allowedTools];
      }
    }
  }

  /**
   * Validate that all dependsOn references point to existing task IDs.
   */
  private validateDependencies(tasks: ExecutionPlanTask[]): void {
    const taskIds = new Set(tasks.map((t) => t.id));
    for (const task of tasks) {
      for (const depId of normalizeTaskDependencies(task)) {
        if (!taskIds.has(depId)) {
          throw new Error(
            `Task "${task.id}" depends on non-existent task "${depId}"`,
          );
        }
      }
    }
  }

  /**
   * Store the execution plan to the Blackboard.
   * Uses setExecutionPlan if available, otherwise falls back to setTasks.
   */
  private storeToBlackboard(plan: ExecutionPlan): void {
    // Store as MultiAgentTasks for backward compatibility
    const tasks = plan.tasks.map((t, index) => ({
      id: t.id,
      title: t.goal,
      agentId: t.agentId as string as import('@ai-frontend/shared-types').AgentRuntimeID,
      wave: this.inferWave(t, plan.tasks),
      dependsOn: normalizeTaskDependencies(t),
      goal: t.goal,
    }));
    this.blackboard.setTasks(tasks);
  }

  /**
   * Infer the wave number for a task based on its dependencies.
   * Tasks with no dependencies are wave 0, others are max(dep waves) + 1.
   */
  private inferWave(task: ExecutionPlanTask, allTasks: ExecutionPlanTask[]): number {
    const dependencies = normalizeTaskDependencies(task);
    if (dependencies.length === 0) return 0;

    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    let maxDepWave = 0;
    for (const depId of dependencies) {
      const dep = taskMap.get(depId);
      if (dep) {
        const depWave = this.inferWave(dep, allTasks);
        maxDepWave = Math.max(maxDepWave, depWave);
      }
    }
    return maxDepWave + 1;
  }
}
