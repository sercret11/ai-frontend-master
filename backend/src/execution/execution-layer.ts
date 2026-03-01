/**
 * Execution_Layer â€?æ‰§è¡Œå±?
 *
 * Orchestrates execution-layer agents according to an ExecutionPlan produced
 * by the Planning_Layer.  Tasks are grouped into *waves* via topological sort
 * (Kahn's algorithm) so that independent tasks run in parallel while
 * respecting dependency ordering.
 *
 * éœ€æ±? R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7,
 *       R4.4, R4.5, R4.6, R4.7, R4.8, R4.9, R4.10, R4.11, R4.12
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ExecutionPlanTask } from '../planning/types';
import type {
  ExecutionContext,
  ExecutionLayerInput,
  ExecutionLayerOutput,
  TaskResult,
  QualityGateState,
} from './types';
import type {
  MergedPatchBatch,
  PatchIntent,
  RuntimeBudgetConsumption,
  RuntimeBudgetStopReason,
  RuntimeExecutionBudget,
} from '../runtime/multi-agent/types';
import type { MultiAgentBlackboard } from '../runtime/multi-agent/blackboard';
import type { LLMClient } from '../llm/client';
import type { ProviderID, ToolDefinition, ToolExecutor } from '../llm/types';
import { getExecutionAgent } from './agents/index';
import { mergePatchIntents } from '../runtime/multi-agent/patch-crdt';
import { ToolRegistry } from '../tool/registry';
import { FileStorage } from '../storage/file-storage';

const NON_MUTATING_AGENT_IDS = new Set(['quality-agent']);
const RETRY_ON_MISSING_MUTATION_AGENT_IDS = new Set([
  'scaffold-agent',
  'page-agent',
  'state-agent',
  'style-agent',
  'interaction-agent',
  'repair-agent',
]);
const MUTATION_RETRY_TOOL_IDS = new Set(['write', 'apply_diff']);
const PRESERVE_CONTEXT_ON_RETRY_AGENT_IDS = new Set(RETRY_ON_MISSING_MUTATION_AGENT_IDS);
const DEFAULT_EXECUTION_AGENT_TIMEOUT_MS = 120_000;
const MIN_EXECUTION_AGENT_TIMEOUT_MS = 30_000;
const MAX_EXECUTION_AGENT_TIMEOUT_MS = 300_000;
const RETRY_EXECUTION_AGENT_TIMEOUT_MS = 180_000;
const SCAFFOLD_AGENT_ID = 'scaffold-agent';
const REPAIR_AGENT_ID = 'repair-agent';
const SCAFFOLD_EXECUTION_AGENT_TIMEOUT_MS = 180_000;
const MAX_SCAFFOLD_EXECUTION_AGENT_TIMEOUT_MS = 300_000;
const REPAIR_EXECUTION_AGENT_TIMEOUT_MS = 300_000;
const MAX_REPAIR_EXECUTION_AGENT_TIMEOUT_MS = 300_000;
const RETRY_REPAIR_EXECUTION_AGENT_TIMEOUT_MS = 300_000;

interface ExecutionBudgetState {
  limits: RuntimeExecutionBudget;
  usedIterations: number;
  usedToolCalls: number;
  startedAt: number;
  stopReason?: RuntimeBudgetStopReason;
  stopMessage?: string;
  finalScore?: number;
}

type BudgetCheckedExecutionContext = ExecutionContext & {
  budgetState?: ExecutionBudgetState;
};

class RuntimeBudgetExceededError extends Error {
  readonly reason: RuntimeBudgetStopReason;

  constructor(reason: RuntimeBudgetStopReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = 'RuntimeBudgetExceededError';
  }
}

function requiresArtifactMutation(agentId: string): boolean {
  return !NON_MUTATING_AGENT_IDS.has(agentId);
}

function selectToolIdsForAttempt(
  toolIds: string[],
  mutationRequired: boolean,
  attempt: number,
  agentId: string,
): string[] {
  if (!mutationRequired || attempt === 1) {
    return toolIds;
  }

  if (PRESERVE_CONTEXT_ON_RETRY_AGENT_IDS.has(agentId)) {
    return toolIds;
  }

  const narrowed = toolIds.filter(toolId => MUTATION_RETRY_TOOL_IDS.has(toolId));
  return narrowed.length > 0 ? narrowed : toolIds;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert a Zod schema to a JSON Schema object suitable for `ToolDefinition.inputSchema`.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema) as Record<string, unknown>;
  } catch {
    // Fallback: return a permissive schema if conversion fails
    return { type: 'object' };
  }
}

/**
 * Build `ToolDefinition[]` for the given tool IDs by looking them up in the
 * ToolRegistry, initialising each tool, and converting its Zod parameter
 * schema to JSON Schema.
 */
async function buildToolDefinitions(toolIds: string[]): Promise<ToolDefinition[]> {
  const definitions: ToolDefinition[] = [];
  for (const toolId of toolIds) {
    const toolInfo = await ToolRegistry.getById(toolId);
    if (!toolInfo) continue;
    const initialised = await toolInfo.init();
    definitions.push({
      name: toolId,
      description: initialised.description,
      inputSchema: zodToJsonSchema(initialised.parameters),
    });
  }
  return definitions;
}

/**
 * Create a `ToolExecutor` that bridges the LLMClient's simple
 * `(name, args) => Promise<{content, isError?}>` interface to the
 * ToolRegistry's `ToolInfo.init().execute()` pattern.
 *
 * Tool calls are executed within the given session so that file-mutating
 * tools (write, apply_diff) persist their changes via `FileStorage`.
 */
function createToolExecutor(
  sessionId: string,
  messageId: string,
  agentId: string,
  abortSignal: AbortSignal,
  provider: ProviderID,
  model: string,
  options?: {
    onBeforeToolCall?: (toolName: string) => { allowed: true } | { allowed: false; message: string };
  },
): ToolExecutor {
  return async (name: string, args: Record<string, unknown>) => {
    const budgetDecision = options?.onBeforeToolCall?.(name);
    if (budgetDecision && !budgetDecision.allowed) {
      return {
        content: `RUNTIME_BUDGET_EXCEEDED: ${budgetDecision.message}`,
        isError: true,
      };
    }

    try {
      const callID = `${messageId}-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await ToolRegistry.executeWithPolicy(name, args, {
        providerID: provider,
        modelID: model,
        agentID: agentId,
        sessionID: sessionId,
        messageID: messageId,
        abort: abortSignal,
        callID,
      });
      return { content: result.output, isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Tool execution failed: ${message}`, isError: true };
    }
  };
}

/**
 * Snapshot files before/after tool execution and produce `PatchIntent[]`
 * for any files that were created or modified.
 */
function collectPatchIntents(
  sessionId: string,
  taskId: string,
  agentId: string,
  waveIndex: number,
  beforeFiles: Array<{ path: string; content: string }>,
): PatchIntent[] {
  const beforeMap = new Map(beforeFiles.map(f => [f.path, f.content]));
  const afterFiles = FileStorage.getAllFiles(sessionId);
  const intents: PatchIntent[] = [];
  const waveId = `wave-${waveIndex}`;

  for (const file of afterFiles) {
    const previous = beforeMap.get(file.path);
    if (previous === file.content) continue;

    const digest = createHash('sha1').update(file.content).digest('hex');
    intents.push({
      id: `intent-${taskId}-${intents.length + 1}`,
      waveId,
      taskId,
      agentId: agentId as any,
      filePath: file.path,
      content: file.content,
      contentHash: digest,
      createdAt: Date.now(),
    });
  }

  return intents;
}

// ============================================================================
// ExecutionLayer
// ============================================================================

export class ExecutionLayer {
  private executionAgentTimeoutMs: number;

  constructor(
    private blackboard: MultiAgentBlackboard,
    private llmClient: LLMClient,
    private provider: ProviderID,
    private model: string,
  ) {
    this.executionAgentTimeoutMs = this.resolveExecutionAgentTimeoutMs();
  }

  // ---------------------------------------------------------------------------
  // Public entry point (stub â€?implemented in task 9.6)
  // ---------------------------------------------------------------------------

  /**
   * Run the full execution pipeline: schedule â†?waves â†?merge â†?quality.
   *
   * 1. Extract ExecutionContext from input
   * 2. Schedule tasks into waves via topological sort
   * 3. For each wave: run tasks in parallel, collect & merge PatchIntents
   * 4. After code-gen waves, run quality gate + repair loop
   * 5. Build and return ExecutionLayerOutput
   *
   * éœ€æ±? R3.6, R4.4, R4.5
   */
  async run(input: ExecutionLayerInput): Promise<ExecutionLayerOutput> {
    const budgetState = this.createBudgetState(input.runtimeBudget);
    const context: BudgetCheckedExecutionContext = {
      sessionId: input.sessionId,
      runId: input.runId,
      userMessage: input.userMessage,
      platform: input.platform,
      techStack: input.techStack,
      runtimeBudget: input.runtimeBudget,
      abortSignal: input.abortSignal,
      emitRuntimeEvent: input.emitRuntimeEvent,
      budgetState,
    };

    // 1. Schedule tasks into waves
    const waves = this.scheduleWaves(input.plan.tasks);

    // Accumulators for the final output
    const allPatchIntents: PatchIntent[] = [];
    const allTouchedFiles = new Set<string>();
    const degradedTasks: string[] = [];
    const unresolvedIssues: string[] = [];

    // Emit execution start event
    input.emitRuntimeEvent({
      type: 'agent.task.progress',
      agentId: 'scaffold-agent',
      taskId: 'execution-layer',
      waveId: 'execution',
      progressText: `Starting execution â€?${waves.length} wave(s), ${input.plan.tasks.length} task(s)`,
    });
    this.emitConfiguredBudgetEvents(context);

    // 2. Execute each wave sequentially
    let lastCodeGenWaveIndex = -1;
    let qualityState: QualityGateState = {
      gate: 'quality-gate',
      status: 'pending',
      summary: 'quality gate not started',
    };

    for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
      const waveTasks = waves[waveIndex];
      if (!waveTasks || waveTasks.length === 0) continue;
      const executionWaveTasks = waveTasks.filter(
        task => task.agentId !== 'quality-agent' && task.agentId !== 'repair-agent',
      );
      if (executionWaveTasks.length === 0) {
        continue;
      }

      try {
        this.assertDurationBudget(context, `before wave ${waveIndex + 1}`);
      } catch (error) {
        if (this.isRuntimeBudgetExceededError(error)) {
          this.markBudgetStop(context, error.reason, error.message);
          break;
        }
        throw error;
      }

      // Emit wave start event
      input.emitRuntimeEvent({
        type: 'agent.task.progress',
        agentId: executionWaveTasks[0].agentId,
        taskId: `wave-${waveIndex}`,
        waveId: `wave-${waveIndex}`,
        progressText: `Wave ${waveIndex + 1}/${waves.length} starting â€?${executionWaveTasks.length} task(s): ${executionWaveTasks.map(t => t.agentId).join(', ')}`,
      });

      // Run all tasks in this wave in parallel
      let results: TaskResult[];
      try {
        results = await this.runWave(executionWaveTasks, context, waveIndex);
      } catch (error) {
        if (this.isRuntimeBudgetExceededError(error)) {
          this.markBudgetStop(context, error.reason, error.message);
          break;
        }
        throw error;
      }

      // Collect PatchIntents from all task results
      const waveIntents: PatchIntent[] = [];
      for (const result of results) {
        if (result.success) {
          waveIntents.push(...result.patchIntents);
          result.touchedFiles.forEach(f => allTouchedFiles.add(f));

          // Share generated components via Blackboard for page-agent / interaction-agent coordination
          if (result.agentId === 'page-agent' || result.agentId === 'scaffold-agent') {
            const componentFiles = result.touchedFiles.filter(
              f => f.includes('/components/') || f.includes('/pages/') || f.includes('/views/'),
            );
            if (componentFiles.length > 0) {
              this.blackboard.addGeneratedComponents(componentFiles);
            }
          }
        } else {
          // Record failed task to Blackboard
          this.blackboard.addFailedTask(result.taskId, result.error ?? 'Unknown error');
          // quality/repair wave tasks can fail as part of the planned execution
          // while the dedicated quality-repair loop still converges afterwards.
          // Keep them in diagnostics, but do not force global degraded status here.
          const isBlockingFailure =
            result.agentId !== 'quality-agent' && result.agentId !== 'repair-agent';
          if (isBlockingFailure) {
            degradedTasks.push(result.taskId);
          }
        }
      }

      // Detect and merge conflicts within this wave
      if (waveIntents.length > 0) {
        const merged = this.detectAndMergeConflicts(waveIntents);
        allPatchIntents.push(...waveIntents);
        merged.touchedFiles.forEach(f => allTouchedFiles.add(f));

        // Track unresolved conflicts
        for (const conflict of merged.conflicts) {
          if (conflict.status === 'open') {
            unresolvedIssues.push(
              `Conflict in ${conflict.filePath}: ${conflict.reason}`,
            );
          }
        }
      }

      // Track the last wave that contains code-gen agents (not quality/repair)
      const isCodeGenWave = waveTasks.some(
        t => t.agentId !== 'quality-agent' && t.agentId !== 'repair-agent',
      );
      if (isCodeGenWave) {
        lastCodeGenWaveIndex = waveIndex;
      }

      // Emit wave complete event
      input.emitRuntimeEvent({
        type: 'agent.task.progress',
        agentId: executionWaveTasks[0].agentId,
        taskId: `wave-${waveIndex}`,
        waveId: `wave-${waveIndex}`,
        progressText: `Wave ${waveIndex + 1}/${waves.length} complete â€?${waveIntents.length} patch intent(s)`,
      });
      this.emitBudgetCheckpoint(context, `wave ${waveIndex + 1} complete`);

      if (context.budgetState?.stopReason) {
        break;
      }
    }

    // 3. Run quality gate + repair loop after all code-gen waves
    const qualityWaveIndex = lastCodeGenWaveIndex + 1;
    if (!context.budgetState?.stopReason) {
      const qualityMaxRounds = this.resolveQualityMaxRounds(context);
      if (!context.budgetState?.stopReason) {
        try {
          qualityState = await this.runQualityRepairLoop(context, qualityWaveIndex, qualityMaxRounds);
        } catch (error) {
          if (this.isRuntimeBudgetExceededError(error)) {
            this.markBudgetStop(context, error.reason, error.message);
          } else {
            throw error;
          }
        }
      } else {
        qualityState = {
          gate: 'quality-gate',
          status: 'failed',
          summary: `Quality gate skipped due to budget stop: ${context.budgetState.stopReason}`,
        };
      }
    } else {
      qualityState = {
        gate: 'quality-gate',
        status: 'failed',
        summary: `Quality gate skipped due to budget stop: ${context.budgetState.stopReason}`,
      };
    }

    if (qualityState.status === 'failed') {
      const summary = qualityState.summary ?? 'Quality gate failed after repair rounds';
      unresolvedIssues.push(summary);
    }

    const finalScore = this.calculateFinalScore(qualityState, degradedTasks, unresolvedIssues);
    if (context.budgetState) {
      context.budgetState.finalScore = finalScore;
    }

    const targetScore = context.budgetState?.limits.targetScore;
    if (typeof targetScore === 'number' && finalScore < targetScore) {
      const message = `target score ${targetScore} not reached (final score ${finalScore})`;
      this.markBudgetStop(context, 'targetScore', message);
      unresolvedIssues.push(message);
    }

    if (
      context.budgetState?.stopMessage &&
      !unresolvedIssues.includes(context.budgetState.stopMessage)
    ) {
      unresolvedIssues.push(context.budgetState.stopMessage);
    }

    // 4. Build final output
    const touchedFilesArray = [...allTouchedFiles];
    const success =
      degradedTasks.length === 0 &&
      unresolvedIssues.length === 0 &&
      qualityState.status === 'passed' &&
      !context.budgetState?.stopReason;

    const budgetUsage = this.snapshotBudgetUsage(context);

    return {
      success,
      patchIntents: allPatchIntents,
      touchedFiles: touchedFilesArray,
      degradedTasks,
      unresolvedIssues,
      budgetUsage,
      budgetStopReason: context.budgetState?.stopReason,
    };
  }

  // ---------------------------------------------------------------------------
  // Wave scheduling â€?Kahn's algorithm topological sort (task 9.2)
  // ---------------------------------------------------------------------------

  /**
   * Group tasks into waves using topological sort (Kahn's algorithm).
   *
   * Each wave contains tasks whose dependencies have all been satisfied by
   * earlier waves.  Tasks within the same wave can execute in parallel.
   *
   * Typical wave layout for the default agent dependency graph:
   *   Wave 1 â€?scaffold-agent  (no deps)
   *   Wave 2 â€?page-agent, state-agent, style-agent  (depend on scaffold)
   *   Wave 3 â€?interaction-agent  (depends on page + state)
   *   Wave 4 â€?quality-agent  (depends on all code-gen agents)
   *   Wave 5 â€?repair-agent   (conditional, depends on quality)
   *
   * @throws Error if the dependency graph contains a cycle.
   */
  scheduleWaves(tasks: ExecutionPlanTask[]): ExecutionPlanTask[][] {
    if (tasks.length === 0) {
      return [];
    }

    // Build adjacency structures
    const taskMap = new Map<string, ExecutionPlanTask>();
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>(); // taskId â†?list of tasks that depend on it

    for (const task of tasks) {
      taskMap.set(task.id, task);
      inDegree.set(task.id, 0);
      dependents.set(task.id, []);
    }

    // Populate in-degrees and dependents map.
    // Only count dependencies that reference tasks within the provided list;
    // external / unknown dependency IDs are silently ignored so the scheduler
    // stays resilient to partial plans.
    const taskIds = new Set(taskMap.keys());

    for (const task of tasks) {
      let degree = 0;
      for (const depId of task.dependsOn) {
        if (taskIds.has(depId)) {
          degree++;
          dependents.get(depId)!.push(task.id);
        }
      }
      inDegree.set(task.id, degree);
    }

    // Kahn's algorithm â€?level-by-level (each level = one wave)
    const waves: ExecutionPlanTask[][] = [];
    let remaining = tasks.length;

    // Seed: all tasks with in-degree 0
    let currentWave: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) {
        currentWave.push(id);
      }
    }

    while (currentWave.length > 0) {
      // Materialise the wave
      const wave: ExecutionPlanTask[] = currentWave.map(id => taskMap.get(id)!);
      waves.push(wave);
      remaining -= wave.length;

      // Prepare next wave
      const nextWave: string[] = [];
      for (const id of currentWave) {
        for (const depId of dependents.get(id)!) {
          const newDeg = inDegree.get(depId)! - 1;
          inDegree.set(depId, newDeg);
          if (newDeg === 0) {
            nextWave.push(depId);
          }
        }
      }

      currentWave = nextWave;
    }

    // If there are remaining tasks they form a cycle
    if (remaining > 0) {
      const cycleIds = [...inDegree.entries()]
        .filter(([, deg]) => deg > 0)
        .map(([id]) => id);
      throw new Error(
        `Cycle detected in execution plan â€?tasks involved: ${cycleIds.join(', ')}`,
      );
    }

    return waves;
  }

  // ---------------------------------------------------------------------------
  // Wave parallel execution (task 9.3)
  // ---------------------------------------------------------------------------

  /**
   * Execute all tasks in a single wave in parallel using `Promise.allSettled`.
   *
   * For each task:
   * 1. Look up the execution agent via `getExecutionAgent(task.agentId)`
   * 2. Build the agent's system prompt
   * 3. Resolve tool definitions from the agent's allowed-tools whitelist
   * 4. Create a `ToolExecutor` bridging ToolRegistry to LLMClient
   * 5. Snapshot session files before execution
   * 6. Call `LLMClient.completeWithTools()` to run the LLM + tool loop
   * 7. Diff session files to collect `PatchIntent[]`
   * 8. Submit PatchIntents to the Blackboard
   *
   * A single task failure does NOT block other tasks in the same wave.
   * Failed tasks are recorded to the Blackboard and returned with
   * `success: false` in their `TaskResult`.
   *
   * éœ€æ±? R3.1, R3.3, R3.7
   */
  async runWave(
    tasks: ExecutionPlanTask[],
    context: ExecutionContext,
    waveIndex: number = 0,
  ): Promise<TaskResult[]> {
    const results: TaskResult[] = [];

    // Execute deterministically within a wave so each task diff is isolated
    // from concurrently mutating tasks.
    for (const task of tasks) {
      try {
        results.push(await this.executeTask(task, context, waveIndex));
      } catch (error) {
        if (this.isRuntimeBudgetExceededError(error)) {
          throw error;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        this.blackboard.upsertQualityGate({
          gate: `task-${task.id}`,
          status: 'failed',
          summary: errorMessage,
        });
        results.push({
          taskId: task.id,
          agentId: task.agentId,
          success: false,
          patchIntents: [],
          touchedFiles: [],
          error: errorMessage,
        });
      }
    }

    return results;
  }
  // ---------------------------------------------------------------------------
  // Single task execution (private helper for runWave)
  // ---------------------------------------------------------------------------

  /**
   * Execute a single `ExecutionPlanTask` by driving the agent through the
   * LLMClient tool-calling loop.
   */
  private async executeTask(
    task: ExecutionPlanTask,
    context: ExecutionContext,
    waveIndex: number,
  ): Promise<TaskResult> {
    const budgetContext = context as BudgetCheckedExecutionContext;
    const agent = getExecutionAgent(task.agentId);
    const sessionDocuments = this.blackboard.getSessionDocuments();
    const waveId = `wave-${waveIndex}`;

    this.consumeIterationBudget(budgetContext, task, waveId);
    this.assertDurationBudget(budgetContext, `before task ${task.id}`);

    context.emitRuntimeEvent({
      type: 'agent.task.progress',
      agentId: task.agentId,
      taskId: task.id,
      waveId,
      progressText: `starting task: ${task.goal}`,
    });

    const systemPrompt = agent.buildPrompt({
      sessionId: context.sessionId,
      runId: context.runId,
      userMessage: context.userMessage,
      task: {
        id: task.id,
        title: task.goal,
        agentId: task.agentId,
        wave: waveIndex,
        dependsOn: task.dependsOn,
        goal: task.goal,
      },
      routeDecision: {
        agentId: task.agentId,
        mode: 'implementer',
        source: 'execution-layer' as any,
        confidence: 100,
      },
      platform: context.platform as any,
      techStack: context.techStack,
      sessionDocuments,
      emitRuntimeEvent: context.emitRuntimeEvent,
      abortSignal: context.abortSignal,
    });

    const mergedToolIds = [...new Set([...agent.allowedTools, ...task.tools])];

    const mutationRequired = requiresArtifactMutation(task.agentId);
    const shouldRetryMissingMutation =
      mutationRequired && RETRY_ON_MISSING_MUTATION_AGENT_IDS.has(task.agentId);
    const maxMutationAttempts = shouldRetryMissingMutation ? 3 : 1;
    const beforeFiles = FileStorage.getAllFiles(context.sessionId);
    const enforceResolvableImports = task.agentId === 'repair-agent';

    let patchIntents: PatchIntent[] = [];
    let responseText = '';
    let unresolvedImportIssues: string[] = [];

    for (let attempt = 1; attempt <= maxMutationAttempts; attempt++) {
      this.assertDurationBudget(budgetContext, `before task ${task.id} attempt ${attempt}`);
      const attemptStartedAt = Date.now();
      const allowedToolIds = selectToolIdsForAttempt(
        mergedToolIds,
        mutationRequired,
        attempt,
        task.agentId,
      );
      const toolDefs = await buildToolDefinitions(allowedToolIds);
      const messageId = `exec-${context.runId}-${task.id}-${Date.now()}-a${attempt}`;
      const toolExecutor = createToolExecutor(
        context.sessionId,
        messageId,
        task.agentId,
        context.abortSignal,
        this.provider,
        this.model,
        {
          onBeforeToolCall: (toolName) =>
            this.reserveToolCallBudget(budgetContext, task, waveId, toolName),
        },
      );
      const baseTaskTimeoutMs = this.resolveTaskExecutionTimeoutMs(task);
      const retryTimeoutCapMs =
        task.agentId === REPAIR_AGENT_ID
          ? RETRY_REPAIR_EXECUTION_AGENT_TIMEOUT_MS
          : RETRY_EXECUTION_AGENT_TIMEOUT_MS;
      const attemptTimeoutMs =
        attempt > 1
          ? Math.min(baseTaskTimeoutMs, retryTimeoutCapMs)
          : baseTaskTimeoutMs;
      const remainingDurationMs = this.getRemainingDurationMs(budgetContext);
      const taskTimeoutMs =
        typeof remainingDurationMs === 'number'
          ? Math.max(1, Math.min(attemptTimeoutMs, remainingDurationMs))
          : attemptTimeoutMs;
      const taskAbortSignal = this.createTaskAbortSignal(context.abortSignal, taskTimeoutMs);
      const hardTimeoutMs = taskTimeoutMs + 5_000;

      const retryHint = attempt === 1
        ? ''
        : [
            '',
            `Retry ${attempt - 1} produced no file mutation.`,
            `Task goal: ${task.goal}`,
            'You MUST call write or apply_diff and mutate at least one project file in this attempt.',
            'Do not use discovery-only tool calls in retries.',
            'Do not return narrative-only output.',
          ].join('\n');
      const unresolvedImportRetryHint =
        enforceResolvableImports && attempt > 1 && unresolvedImportIssues.length > 0
          ? [
              '',
              'Previous attempt left unresolved imports. Resolve all listed import issues in this attempt.',
              ...unresolvedImportIssues.slice(0, 20).map((issue, index) => `${index + 1}. ${issue}`),
              '',
              'Do not create placeholder/template stub files only to silence import errors.',
              'If an import path is wrong, fix the import path.',
              'If a module is truly missing, implement the real module with concrete behavior and UI.',
            ].join('\n')
          : '';

      let llmResponse;
      console.log(
        `[ExecutionLayer] session=${context.sessionId} task=${task.id} agent=${task.agentId} attempt=${attempt}/${maxMutationAttempts} start tools=${allowedToolIds.join(',')} timeoutMs=${taskTimeoutMs}`,
      );
      try {
        llmResponse = await this.withHardTimeout(
          this.llmClient.completeWithTools(
            {
              provider: this.provider,
              model: this.model,
              systemPrompt,
              messages: [{ role: 'user', content: `${context.userMessage}${retryHint}${unresolvedImportRetryHint}` }],
              tools: toolDefs,
              abortSignal: taskAbortSignal,
            },
            toolExecutor,
          ),
          hardTimeoutMs,
          `Execution task hard timed out after ${hardTimeoutMs}ms`,
        );
      } catch (error: unknown) {
        if (this.isRuntimeBudgetExceededError(error)) {
          throw error;
        }

        const shouldRetryOnTransientFailure =
          attempt < maxMutationAttempts && this.isTransientExecutionFailure(error);
        if (shouldRetryOnTransientFailure) {
          const retryAttempt = attempt + 1;
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.warn(
            `[ExecutionLayer] session=${context.sessionId} task=${task.id} agent=${task.agentId} transient-error retry=${retryAttempt}/${maxMutationAttempts} error=${errorMessage}`,
          );
          context.emitRuntimeEvent({
            type: 'agent.task.progress',
            agentId: task.agentId,
            taskId: task.id,
            waveId,
            progressText: `retrying due to transient execution error (attempt ${retryAttempt}/${maxMutationAttempts})`,
          });
          continue;
        }
        throw error;
      }

      this.throwIfBudgetStopped(budgetContext);

      responseText = llmResponse.text;
      patchIntents = collectPatchIntents(
        context.sessionId,
        task.id,
        task.agentId,
        waveIndex,
        beforeFiles,
      );
      console.log(
        `[ExecutionLayer] session=${context.sessionId} task=${task.id} agent=${task.agentId} attempt=${attempt}/${maxMutationAttempts} completed durationMs=${Date.now() - attemptStartedAt} responseChars=${llmResponse.text.length} patchIntents=${patchIntents.length}`,
      );

      if (enforceResolvableImports) {
        unresolvedImportIssues = this.collectCurrentUnresolvedImportIssues(context.sessionId);
        if (unresolvedImportIssues.length > 0) {
          const issuePreview = unresolvedImportIssues.slice(0, 4).join(' | ');
          console.warn(
            `[ExecutionLayer] session=${context.sessionId} task=${task.id} agent=${task.agentId} attempt=${attempt}/${maxMutationAttempts} unresolved-imports=${unresolvedImportIssues.length} preview=${issuePreview}`,
          );
          if (attempt < maxMutationAttempts) {
            context.emitRuntimeEvent({
              type: 'agent.task.progress',
              agentId: task.agentId,
              taskId: task.id,
              waveId,
              progressText: `retrying due to unresolved imports (attempt ${attempt + 1}/${maxMutationAttempts})`,
            });
            continue;
          }
        }
      }

      if (!mutationRequired || patchIntents.length > 0) {
        break;
      }

      if (attempt < maxMutationAttempts) {
        context.emitRuntimeEvent({
          type: 'agent.task.progress',
          agentId: task.agentId,
          taskId: task.id,
          waveId,
          progressText: `retrying due to missing file mutation (attempt ${attempt + 1}/${maxMutationAttempts})`,
        });
      }
    }

    if (mutationRequired && patchIntents.length === 0) {
      const errorMessage = 'task completed without required artifact mutation';
      context.emitRuntimeEvent({
        type: 'agent.task.progress',
        agentId: task.agentId,
        taskId: task.id,
        waveId,
        progressText: `failed - ${errorMessage}`,
      });
      return {
        taskId: task.id,
        agentId: task.agentId,
        success: false,
        patchIntents: [],
        touchedFiles: [],
        responseText,
        error: errorMessage,
      };
    }

    if (enforceResolvableImports && unresolvedImportIssues.length > 0) {
      const errorMessage = `repair task completed with unresolved imports: ${unresolvedImportIssues.slice(0, 8).join(' | ')}`;
      context.emitRuntimeEvent({
        type: 'agent.task.progress',
        agentId: task.agentId,
        taskId: task.id,
        waveId,
        progressText: `failed - ${errorMessage}`,
      });
      return {
        taskId: task.id,
        agentId: task.agentId,
        success: false,
        patchIntents: [],
        touchedFiles: [],
        responseText,
        error: errorMessage,
      };
    }

    if (patchIntents.length > 0) {
      this.blackboard.addPatchIntents(patchIntents);
    }

    context.emitRuntimeEvent({
      type: 'agent.task.progress',
      agentId: task.agentId,
      taskId: task.id,
      waveId,
      progressText: `completed - ${patchIntents.length} file(s) changed`,
    });

    return {
      taskId: task.id,
      agentId: task.agentId,
      success: true,
      patchIntents,
      touchedFiles: patchIntents.map(p => p.filePath),
      responseText,
    };
  }

  private createBudgetState(inputBudget?: RuntimeExecutionBudget): ExecutionBudgetState | undefined {
    if (!inputBudget) {
      return undefined;
    }

    const limits: RuntimeExecutionBudget = {};
    if (typeof inputBudget.maxIterations === 'number' && Number.isFinite(inputBudget.maxIterations)) {
      limits.maxIterations = Math.max(1, Math.floor(inputBudget.maxIterations));
    }
    if (typeof inputBudget.maxDurationMs === 'number' && Number.isFinite(inputBudget.maxDurationMs)) {
      limits.maxDurationMs = Math.max(1, Math.floor(inputBudget.maxDurationMs));
    }
    if (typeof inputBudget.maxToolCalls === 'number' && Number.isFinite(inputBudget.maxToolCalls)) {
      limits.maxToolCalls = Math.max(1, Math.floor(inputBudget.maxToolCalls));
    }
    if (typeof inputBudget.targetScore === 'number' && Number.isFinite(inputBudget.targetScore)) {
      limits.targetScore = Math.max(0, Math.min(100, Math.floor(inputBudget.targetScore)));
    }

    if (
      limits.maxIterations === undefined &&
      limits.maxDurationMs === undefined &&
      limits.maxToolCalls === undefined &&
      limits.targetScore === undefined
    ) {
      return undefined;
    }

    return {
      limits,
      usedIterations: 0,
      usedToolCalls: 0,
      startedAt: Date.now(),
    };
  }

  private emitConfiguredBudgetEvents(context: BudgetCheckedExecutionContext): void {
    const state = context.budgetState;
    if (!state) {
      return;
    }

    if (typeof state.limits.maxIterations === 'number') {
      this.emitBudgetUsageEvent(
        context,
        'steps',
        state.usedIterations,
        state.limits.maxIterations,
        `execution budget configured: maxIterations=${state.limits.maxIterations}`,
      );
    }
    if (typeof state.limits.maxDurationMs === 'number') {
      this.emitBudgetUsageEvent(
        context,
        'ms',
        0,
        state.limits.maxDurationMs,
        `execution budget configured: maxDurationMs=${state.limits.maxDurationMs}`,
      );
    }
    if (typeof state.limits.maxToolCalls === 'number') {
      this.emitBudgetUsageEvent(
        context,
        'calls',
        state.usedToolCalls,
        state.limits.maxToolCalls,
        `execution budget configured: maxToolCalls=${state.limits.maxToolCalls}`,
      );
    }
    if (typeof state.limits.targetScore === 'number') {
      context.emitRuntimeEvent({
        type: 'agent.task.progress',
        agentId: 'quality-agent',
        taskId: 'execution-budget',
        waveId: 'execution',
        progressText: `execution budget targetScore=${state.limits.targetScore}`,
      });
    }
  }

  private emitBudgetCheckpoint(context: BudgetCheckedExecutionContext, message: string): void {
    const state = context.budgetState;
    if (!state) {
      return;
    }

    if (typeof state.limits.maxIterations === 'number') {
      this.emitBudgetUsageEvent(
        context,
        'steps',
        state.usedIterations,
        state.limits.maxIterations,
        message,
      );
    }
    if (typeof state.limits.maxDurationMs === 'number') {
      this.emitBudgetUsageEvent(
        context,
        'ms',
        this.getElapsedMs(context),
        state.limits.maxDurationMs,
        message,
      );
    }
    if (typeof state.limits.maxToolCalls === 'number') {
      this.emitBudgetUsageEvent(
        context,
        'calls',
        state.usedToolCalls,
        state.limits.maxToolCalls,
        message,
      );
    }
  }

  private emitBudgetUsageEvent(
    context: BudgetCheckedExecutionContext,
    unit: 'steps' | 'ms' | 'calls',
    used: number,
    limit: number,
    message: string,
  ): void {
    const remaining = Math.max(limit - used, 0);
    context.emitRuntimeEvent({
      type: 'autonomy.budget',
      scope: 'run',
      unit,
      used,
      limit,
      remaining,
      status: this.calculateBudgetStatus(used, limit),
      message,
    });
  }

  private calculateBudgetStatus(used: number, limit: number): 'ok' | 'warning' | 'exhausted' {
    if (limit <= 0) {
      return 'exhausted';
    }
    const remaining = limit - used;
    if (remaining <= 0) {
      return 'exhausted';
    }
    if (remaining / limit <= 0.2) {
      return 'warning';
    }
    return 'ok';
  }

  private getElapsedMs(context: BudgetCheckedExecutionContext): number {
    const startedAt = context.budgetState?.startedAt;
    if (typeof startedAt !== 'number') {
      return 0;
    }
    return Math.max(Date.now() - startedAt, 0);
  }

  private getRemainingDurationMs(context: BudgetCheckedExecutionContext): number | undefined {
    const state = context.budgetState;
    if (!state || typeof state.limits.maxDurationMs !== 'number') {
      return undefined;
    }
    return Math.max(state.limits.maxDurationMs - this.getElapsedMs(context), 0);
  }

  private assertDurationBudget(context: BudgetCheckedExecutionContext, stage: string): void {
    const state = context.budgetState;
    if (!state || typeof state.limits.maxDurationMs !== 'number') {
      return;
    }

    const elapsedMs = this.getElapsedMs(context);
    if (elapsedMs < state.limits.maxDurationMs) {
      return;
    }

    const message = `maxDurationMs exceeded at ${stage}: elapsed ${elapsedMs}ms / limit ${state.limits.maxDurationMs}ms`;
    this.markBudgetStop(context, 'maxDurationMs', message);
    throw new RuntimeBudgetExceededError('maxDurationMs', message);
  }

  private consumeIterationBudget(
    context: BudgetCheckedExecutionContext,
    task: ExecutionPlanTask,
    waveId: string,
  ): void {
    const state = context.budgetState;
    if (!state) {
      return;
    }

    if (
      typeof state.limits.maxIterations === 'number' &&
      state.usedIterations >= state.limits.maxIterations
    ) {
      const message = `maxIterations reached (${state.limits.maxIterations}) before task ${task.id}`;
      this.markBudgetStop(context, 'maxIterations', message);
      throw new RuntimeBudgetExceededError('maxIterations', message);
    }

    state.usedIterations += 1;

    if (typeof state.limits.maxIterations === 'number') {
      this.emitBudgetUsageEvent(
        context,
        'steps',
        state.usedIterations,
        state.limits.maxIterations,
        `task ${task.id} started in ${waveId}`,
      );
    }
  }

  private reserveToolCallBudget(
    context: BudgetCheckedExecutionContext,
    task: ExecutionPlanTask,
    waveId: string,
    toolName: string,
  ): { allowed: true } | { allowed: false; message: string } {
    const state = context.budgetState;
    if (!state) {
      return { allowed: true };
    }

    try {
      this.assertDurationBudget(context, `tool call ${toolName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { allowed: false, message };
    }

    if (typeof state.limits.maxToolCalls === 'number' && state.usedToolCalls >= state.limits.maxToolCalls) {
      const message = `maxToolCalls reached (${state.limits.maxToolCalls}) before calling ${toolName} in task ${task.id}`;
      this.markBudgetStop(context, 'maxToolCalls', message);
      return { allowed: false, message };
    }

    state.usedToolCalls += 1;
    if (typeof state.limits.maxToolCalls === 'number') {
      this.emitBudgetUsageEvent(
        context,
        'calls',
        state.usedToolCalls,
        state.limits.maxToolCalls,
        `tool ${toolName} executed by ${task.agentId} (${waveId})`,
      );
    }
    return { allowed: true };
  }

  private throwIfBudgetStopped(context: BudgetCheckedExecutionContext): void {
    const state = context.budgetState;
    if (!state?.stopReason) {
      return;
    }
    throw new RuntimeBudgetExceededError(
      state.stopReason,
      state.stopMessage ?? `runtime budget stop (${state.stopReason})`,
    );
  }

  private markBudgetStop(
    context: BudgetCheckedExecutionContext,
    reason: RuntimeBudgetStopReason,
    message: string,
  ): void {
    const state = context.budgetState;
    if (!state || state.stopReason) {
      return;
    }

    state.stopReason = reason;
    state.stopMessage = message;

    if (reason === 'targetScore') {
      context.emitRuntimeEvent({
        type: 'agent.task.progress',
        agentId: 'quality-agent',
        taskId: 'execution-budget',
        waveId: 'execution',
        progressText: `budget stop: ${message}`,
      });
      return;
    }

    let unit: 'steps' | 'ms' | 'calls' = 'steps';
    let used = 0;
    let limit = 0;
    if (reason === 'maxDurationMs') {
      unit = 'ms';
      used = this.getElapsedMs(context);
      limit = state.limits.maxDurationMs ?? used;
    } else if (reason === 'maxToolCalls') {
      unit = 'calls';
      used = state.usedToolCalls;
      limit = state.limits.maxToolCalls ?? used;
    } else {
      unit = 'steps';
      used = state.usedIterations;
      limit = state.limits.maxIterations ?? used;
    }

    context.emitRuntimeEvent({
      type: 'autonomy.budget',
      scope: 'run',
      unit,
      used,
      limit,
      remaining: 0,
      status: 'exhausted',
      message,
    });
  }

  private isRuntimeBudgetExceededError(error: unknown): error is RuntimeBudgetExceededError {
    return error instanceof RuntimeBudgetExceededError;
  }

  private resolveQualityMaxRounds(context: BudgetCheckedExecutionContext): number {
    const state = context.budgetState;
    if (!state || typeof state.limits.maxIterations !== 'number') {
      return 5;
    }

    const remainingIterations = state.limits.maxIterations - state.usedIterations;
    if (remainingIterations <= 0) {
      this.markBudgetStop(
        context,
        'maxIterations',
        `maxIterations reached (${state.limits.maxIterations}) before quality loop`,
      );
      return 0;
    }

    return Math.min(5, Math.max(remainingIterations - 1, 0));
  }

  private calculateFinalScore(
    qualityState: QualityGateState,
    degradedTasks: string[],
    unresolvedIssues: string[],
  ): number {
    let score = 100;
    if (qualityState.status !== 'passed') {
      score -= 35;
    }
    score -= degradedTasks.length * 15;
    score -= unresolvedIssues.length * 10;
    return Math.max(0, Math.min(100, score));
  }

  private snapshotBudgetUsage(context: BudgetCheckedExecutionContext): RuntimeBudgetConsumption | undefined {
    const state = context.budgetState;
    if (!state) {
      return undefined;
    }

    return {
      usedIterations: state.usedIterations,
      usedToolCalls: state.usedToolCalls,
      elapsedMs: this.getElapsedMs(context),
      finalScore: state.finalScore,
    };
  }

  private resolveExecutionAgentTimeoutMs(): number {
    const timeoutMs = Number(
      process.env.EXECUTION_AGENT_TIMEOUT_MS ?? DEFAULT_EXECUTION_AGENT_TIMEOUT_MS,
    );
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return DEFAULT_EXECUTION_AGENT_TIMEOUT_MS;
    }
    return Math.min(
      Math.max(Math.floor(timeoutMs), MIN_EXECUTION_AGENT_TIMEOUT_MS),
      MAX_EXECUTION_AGENT_TIMEOUT_MS,
    );
  }

  private resolveTaskExecutionTimeoutMs(task: ExecutionPlanTask): number {
    if (task.agentId === SCAFFOLD_AGENT_ID) {
      return Math.min(
        Math.max(this.executionAgentTimeoutMs, SCAFFOLD_EXECUTION_AGENT_TIMEOUT_MS),
        MAX_SCAFFOLD_EXECUTION_AGENT_TIMEOUT_MS,
      );
    }
    if (task.agentId === REPAIR_AGENT_ID) {
      return Math.min(
        Math.max(this.executionAgentTimeoutMs, REPAIR_EXECUTION_AGENT_TIMEOUT_MS),
        MAX_REPAIR_EXECUTION_AGENT_TIMEOUT_MS,
      );
    }
    return this.executionAgentTimeoutMs;
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

  private createTaskAbortSignal(parentSignal: AbortSignal, timeoutMs: number): AbortSignal {
    if (timeoutMs <= 0) {
      return parentSignal;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      const timeoutError = new Error(
        `Execution task request timed out after ${timeoutMs}ms`,
      ) as Error & { name: string };
      timeoutError.name = 'TimeoutError';
      if (!controller.signal.aborted) {
        controller.abort(timeoutError);
      }
    }, timeoutMs);
    timeout.unref?.();

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

  private isTransientExecutionFailure(error: unknown): boolean {
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

    const causeRecord = details.cause as {
      code?: string | number;
      message?: string;
      name?: string;
      status?: number;
      statusCode?: number;
    };
    if (causeRecord?.name === 'TimeoutError') {
      return true;
    }
    if (causeRecord?.statusCode === 0 || causeRecord?.status === 0) {
      return true;
    }

    const rawCode = details.code ?? causeRecord?.code;
    const code =
      rawCode == null
        ? ''
        : typeof rawCode === 'string'
          ? rawCode.toUpperCase()
          : String(rawCode).toUpperCase();
    if (
      code &&
      ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
    ) {
      return true;
    }

    const message = [details.message, causeRecord?.message]
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
      .toLowerCase();
    return (
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('socket hang up') ||
      message.includes('timed out') ||
      message.includes('timeout')
    );
  }

  // ---------------------------------------------------------------------------
  // Stubs for remaining methods (implemented in later tasks)
  // ---------------------------------------------------------------------------

  /**
   * Detect and merge conflicting PatchIntents within a single wave.
   *
   * Groups intents by `filePath`.  Files touched by a single agent pass
   * through unchanged.  When multiple agents modify the same file the
   * existing CRDT merge logic (`mergePatchIntents`) is used â€?it applies a
   * last-writer-wins strategy ordered by `createdAt` and records a
   * `ConflictRecord` for every multi-source file.
   *
   * Unresolvable conflicts (e.g. identical timestamps from different agents)
   * are still recorded and marked as `open` so downstream consumers can
   * surface them.
   *
   * éœ€æ±? R3.4, R3.5
   */
  private detectAndMergeConflicts(intents: PatchIntent[]): MergedPatchBatch {
    if (intents.length === 0) {
      return {
        id: 'patch-batch-empty',
        waveId: '',
        merged: [],
        conflicts: [],
        touchedFiles: [],
      };
    }

    // Derive the waveId from the first intent (all intents in a batch share
    // the same wave).
    const waveId = intents[0].waveId;

    // Delegate to the existing CRDT merge utility which already handles:
    //   - grouping by filePath
    //   - single-intent pass-through (no conflict)
    //   - multi-intent last-writer-wins + conflict recording
    const batch = mergePatchIntents(waveId, intents);

    // Persist every conflict to the Blackboard so it is visible to the
    // quality-agent and any downstream inspection.
    for (const conflict of batch.conflicts) {
      this.blackboard.addConflict(conflict);
    }

    return batch;
  }

  /**
   * Quality gate check + repair loop (max 2 rounds).
   *
   * Runs the quality-agent to validate generated code.  If the quality check
   * fails, triggers the repair-agent to fix the issues, then re-runs the
   * quality check.  This cycle repeats up to `maxRounds` times.
   *
   * After `maxRounds` repair attempts the quality gate is still failing, the
   * task is marked as degraded and unresolved issues are recorded.
   *
   * éœ€æ±? R4.6, R4.7, R4.11, R4.12
   */
  private async runQualityRepairLoop(
    context: ExecutionContext,
    waveIndex: number,
    maxRounds: number = 2,
  ): Promise<QualityGateState> {
    const qualityGateName = 'quality-gate';
    let lastQualitySummary = '';
    let lastQualityIssues: string[] = [];

    for (let round = 0; round <= maxRounds; round++) {
      // -----------------------------------------------------------------------
      // Run quality-agent
      // -----------------------------------------------------------------------
      const qualityTask: ExecutionPlanTask = {
        id: `quality-check-round-${round}`,
        agentId: 'quality-agent',
        goal: round === 0
          ? 'Validate generated code for completeness, consistency, and runnability. ' +
            'Output "QUALITY_PASSED" if all checks pass, or list concrete issues if any fail.'
          : 'Re-validate generated code after repair round ' + round + '. ' +
            'Previous issues: ' + lastQualitySummary + '. ' +
            'Output "QUALITY_PASSED" if all checks now pass, or list remaining issues.',
        dependsOn: [],
        tools: ['read', 'grep', 'glob', 'bash'],
      };

      context.emitRuntimeEvent({
        type: 'agent.task.progress',
        agentId: 'quality-agent',
        taskId: qualityTask.id,
        waveId: `wave-${waveIndex}`,
        progressText: round === 0
          ? 'running quality gate check'
          : `running quality re-check (after repair round ${round})`,
      });

      let qualityResult: TaskResult;
      try {
        qualityResult = await this.executeTask(qualityTask, context, waveIndex);
      } catch (err) {
        if (this.isRuntimeBudgetExceededError(err)) {
          throw err;
        }

        // Quality-agent itself crashed â€?treat as failed
        const errorMsg = err instanceof Error ? err.message : String(err);
        lastQualitySummary = `quality-agent crashed: ${errorMsg}`;
        this.blackboard.upsertQualityGate({
          gate: qualityGateName,
          status: 'failed',
          summary: lastQualitySummary,
        });
        // If we still have repair rounds left, continue to repair
        if (round < maxRounds) {
          await this.runRepairRound(context, waveIndex, round + 1, [lastQualitySummary]);
          continue;
        }
        // Out of rounds â€?degraded
        return this.buildDegradedState(qualityGateName, lastQualitySummary);
      }

      // Determine pass/fail from the quality-agent's response
      const artifactIssues = this.collectArtifactQualityIssues(context.sessionId);
      const modelIssues = this.extractActionableQualityIssues(qualityResult);
      const actionableModelIssues = artifactIssues.length === 0 ? modelIssues : [];
      const passed = artifactIssues.length === 0
        && (this.isQualityPassed(qualityResult) || actionableModelIssues.length === 0);

      if (passed) {
        const state: QualityGateState = {
          gate: qualityGateName,
          status: 'passed',
          summary: 'All quality checks passed.',
        };
        this.blackboard.upsertQualityGate(state);
        return state;
      }

      // Quality failed â€?record the issues
      lastQualityIssues = [
        ...artifactIssues.map(issue => `artifact: ${issue}`),
        ...actionableModelIssues.map(issue => `model: ${issue}`),
      ];
      const summarySections: string[] = [];
      if (artifactIssues.length > 0) {
        summarySections.push(`Artifact issues:\n- ${artifactIssues.join('\n- ')}`);
        if (modelIssues.length > 0) {
          summarySections.push(
            'Model-reported issues are ignored while artifact issues remain unresolved.',
          );
        }
      }
      if (actionableModelIssues.length > 0) {
        summarySections.push(`Model issues:\n- ${actionableModelIssues.join('\n- ')}`);
      }
      if (lastQualityIssues.length === 0) {
        lastQualityIssues = [
          'No actionable quality findings were parsed. Re-check generated files for concrete compile/runtime issues and missing interactions.',
        ];
        summarySections.push(lastQualityIssues[0]);
      }
      lastQualitySummary = summarySections.join('\n\n');

      this.blackboard.upsertQualityGate({
        gate: qualityGateName,
        status: 'failed',
        summary: lastQualitySummary,
      });

      // If we've exhausted all repair rounds, return degraded
      if (round >= maxRounds) {
        return this.buildDegradedState(qualityGateName, lastQualitySummary);
      }

      // -----------------------------------------------------------------------
      // Run repair-agent
      // -----------------------------------------------------------------------
      await this.runRepairRound(context, waveIndex, round + 1, lastQualityIssues);
    }

    // Should not reach here, but safety net
    return this.buildDegradedState(qualityGateName, lastQualitySummary);
  }

  /**
   * Execute a single repair round using the repair-agent.
   */
  private async runRepairRound(
    context: ExecutionContext,
    waveIndex: number,
    roundNumber: number,
    qualityIssues: string[],
  ): Promise<TaskResult> {
    const workspaceScope = this.resolvePrimaryWorkspaceScope(context.sessionId);
    const workspaceRootLabel = workspaceScope.workspaceRootPrefix.length > 0
      ? workspaceScope.workspaceRootPrefix
      : '[project-root]';
    const unresolvedImportIssues = this.collectCurrentUnresolvedImportIssues(context.sessionId);
    const routerIssue = qualityIssues.find(
      issue => issue.startsWith('Router is missing architect routes:'),
    );
    const routerFixDirectives = this.buildRouterRepairDirectives(context.sessionId, routerIssue);
    const issueList = qualityIssues.length > 0
      ? qualityIssues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')
      : '1. No actionable issue details were provided. Re-check generated code for concrete quality failures.';
    const importIssueList = unresolvedImportIssues.length > 0
      ? unresolvedImportIssues.slice(0, 30).map((issue, index) => `${index + 1}. ${issue}`).join('\n')
      : '';
    const repairTask: ExecutionPlanTask = {
      id: `repair-round-${roundNumber}`,
      agentId: REPAIR_AGENT_ID,
      goal: [
        'Fix the following actionable quality issues:',
        issueList,
        ...(importIssueList
          ? [
              '',
              'Resolve all unresolved import issues detected from current files:',
              importIssueList,
            ]
          : []),
        ...(routerFixDirectives.length > 0
          ? [
              '',
              ...routerFixDirectives,
            ]
          : []),
        '',
        'Mandatory completion criteria for this repair task:',
        '1. Zero unresolved imports in the current workspace.',
        '2. Generated workspace is buildable (`npm run build` passes).',
        '3. Do not introduce imports to non-existent modules.',
        '4. Route fixes must be applied in the router source wired by the app entry. Avoid creating parallel broken route trees.',
        '5. If a referenced module is missing, either implement a real interactive module or remove the broken reference.',
        '',
        'Execution strategy:',
        '- Resolve unresolved imports first, then address fidelity and interaction quality issues.',
        '- Keep route definitions and page modules consistent in one coherent tree.',
        '- Prefer patching existing files over introducing overlapping route files.',
        '- Restrict all edits to the primary runtime workspace root.',
        '',
        'Apply targeted fixes. Minimize change scope while preserving architecture constraints.',
        'Do not ask for repository/codebase access. Operate directly on the current workspace files.',
        `Primary runtime workspace root: ${workspaceRootLabel}`,
        'Do not patch mirrored source trees that are outside the primary runtime workspace root.',
        'Do not create placeholder/template stub files to bypass validation.',
        'Any new file must be a concrete, production-quality implementation.',
      ].join('\n'),
      dependsOn: [],
      tools: ['read', 'grep', 'glob', 'apply_diff', 'write', 'bash'],
    };

    context.emitRuntimeEvent({
      type: 'agent.task.progress',
      agentId: REPAIR_AGENT_ID,
      taskId: repairTask.id,
      waveId: `wave-${waveIndex}`,
      progressText: `repair round ${roundNumber} â€?fixing quality issues`,
    });

    try {
      return await this.executeTask(repairTask, context, waveIndex);
    } catch (err) {
      if (this.isRuntimeBudgetExceededError(err)) {
        throw err;
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        taskId: repairTask.id,
        agentId: REPAIR_AGENT_ID,
        success: false,
        patchIntents: [],
        touchedFiles: [],
        error: `repair-agent crashed: ${errorMsg}`,
      };
    }
  }

  private extractActionableQualityIssues(result: TaskResult): string[] {
    const issues = new Set<string>();

    if (result.error?.trim()) {
      issues.add(`quality-agent execution error: ${result.error.trim()}`);
    }

    const response = (result.responseText ?? '').replace(/\r/g, '\n').trim();
    if (!response || this.isContextRequestText(response)) {
      return [...issues];
    }

    const normalizedLines = response
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean);

    for (const line of normalizedLines) {
      if (!this.isActionableQualityIssueLine(line)) {
        continue;
      }
      const clipped = line.length > 320 ? `${line.slice(0, 317)}...` : line;
      issues.add(clipped);
    }

    return [...issues].slice(0, 12);
  }

  private isContextRequestText(text: string): boolean {
    const lower = text.toLowerCase();
    const contextSignals = [
      'please provide',
      'share the repository',
      'share your repository',
      'share the codebase',
      'provide the codebase',
      'cannot access your code',
      "can't access your code",
      'i do not have access',
      "i don't have access",
      'without the codebase',
      'without your code',
      'need your repo',
      'need repository access',
    ];
    const hasContextSignal = contextSignals.some(signal => lower.includes(signal));
    if (!hasContextSignal) {
      return false;
    }

    const hasConcreteEvidence =
      /(^|\s)(src\/|app\/|pages\/|components\/|hooks\/|stores\/|[\w./-]+\.(tsx?|jsx?|ts|js|css|scss|json|md))(?::\d+)?/i.test(text)
      || /\b(ts\d{4}|npm err|eslint|typecheck|lint|vite build|module not found|cannot find module)\b/i.test(lower);

    return !hasConcreteEvidence;
  }

  private isActionableQualityIssueLine(line: string): boolean {
    const lower = line.toLowerCase();
    if (!lower) {
      return false;
    }

    const passIndicators = [
      'quality_passed',
      'all checks passed',
      'no issues found',
      'all validations passed',
      'quality gate passed',
      'no errors found',
      'no problems found',
    ];
    if (passIndicators.some(indicator => lower.includes(indicator))) {
      return false;
    }

    if (this.isContextRequestText(line)) {
      return false;
    }

    const hasIssueKeyword =
      /\b(error|failed|issue|missing|cannot|invalid|broken|unresolved|empty|not found|mismatch|crash|warning)\b/i.test(line);
    if (!hasIssueKeyword) {
      return false;
    }

    return true;
  }

  /**
   * Determine whether the quality-agent's result indicates a pass.
   *
   * Heuristic: the quality-agent is instructed to output "QUALITY_PASSED"
   * when all checks pass.  We also check for common pass indicators and
   * the absence of failure indicators.
   */
  private isQualityPassed(result: TaskResult): boolean {
    // If the task itself failed, quality did not pass
    if (!result.success) return false;

    const text = (result.responseText ?? '').toLowerCase();

    // Explicit pass marker
    if (text.includes('quality_passed')) return true;

    // Common pass indicators
    const passIndicators = [
      'all checks passed',
      'no issues found',
      'all validations passed',
      'quality gate passed',
      'no errors found',
      'no problems found',
    ];
    if (passIndicators.some(indicator => text.includes(indicator))) return true;

    // If the response is empty or very short with no failure indicators, treat as pass
    // (quality-agent may have found nothing to report)
    if (text.length < 50) {
      const failIndicators = ['fail', 'error', 'issue', 'missing', 'broken', 'invalid'];
      if (!failIndicators.some(indicator => text.includes(indicator))) return true;
    }

    return false;
  }

  private resolvePrimaryWorkspaceScope(sessionId: string): {
    workspaceRootPrefix: string;
    workspaceFiles: Array<{ path: string; content: string }>;
    uiFiles: Array<{ path: string; content: string }>;
  } {
    const normalizedFiles = FileStorage.getAllFiles(sessionId).map(file => ({
      path: this.normalizePath(file.path),
      content: file.content,
    }));
    if (normalizedFiles.length === 0) {
      return {
        workspaceRootPrefix: '',
        workspaceFiles: [],
        uiFiles: [],
      };
    }

    const normalizedUiFiles = normalizedFiles.filter(
      file => this.isUiSourceFilePath(file.path),
    );
    if (normalizedUiFiles.length === 0) {
      return {
        workspaceRootPrefix: '',
        workspaceFiles: normalizedFiles,
        uiFiles: [],
      };
    }

    const prefixCounts = new Map<string, number>();
    for (const file of normalizedUiFiles) {
      const prefix = this.extractUiWorkspacePrefix(file.path);
      if (prefix === null) {
        continue;
      }
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
    if (prefixCounts.size === 0) {
      return {
        workspaceRootPrefix: '',
        workspaceFiles: normalizedFiles,
        uiFiles: normalizedUiFiles,
      };
    }

    const workspaceRootPrefix = [...prefixCounts.entries()]
      .sort(([leftPrefix, leftCount], [rightPrefix, rightCount]) => {
        if (rightCount !== leftCount) {
          return rightCount - leftCount;
        }
        const leftDepth = leftPrefix.length === 0 ? 0 : leftPrefix.split('/').filter(Boolean).length;
        const rightDepth = rightPrefix.length === 0 ? 0 : rightPrefix.split('/').filter(Boolean).length;
        if (leftDepth !== rightDepth) {
          return leftDepth - rightDepth;
        }
        return leftPrefix.length - rightPrefix.length;
      })[0]?.[0] ?? '';
    const siblingWorkspacePrefixes = new Set(
      [...prefixCounts.keys()].filter(
        prefix => prefix !== workspaceRootPrefix && prefix.length > 0,
      ),
    );
    const inPrimaryWorkspace = (path: string): boolean => {
      if (workspaceRootPrefix.length > 0) {
        return path === workspaceRootPrefix || path.startsWith(`${workspaceRootPrefix}/`);
      }

      const uiPrefix = this.extractUiWorkspacePrefix(path);
      if (uiPrefix !== null) {
        return uiPrefix.length === 0;
      }
      for (const siblingPrefix of siblingWorkspacePrefixes) {
        if (path === siblingPrefix || path.startsWith(`${siblingPrefix}/`)) {
          return false;
        }
      }
      return true;
    };

    const workspaceFiles = normalizedFiles.filter(file => inPrimaryWorkspace(file.path));
    const workspaceUiFiles = workspaceFiles.filter(file => this.isUiSourceFilePath(file.path));
    const fallbackUiFiles = normalizedUiFiles.filter(
      file => (this.extractUiWorkspacePrefix(file.path) ?? '') === workspaceRootPrefix,
    );

    return {
      workspaceRootPrefix,
      workspaceFiles,
      uiFiles: workspaceUiFiles.length > 0 ? workspaceUiFiles : fallbackUiFiles,
    };
  }

  private isUiSourceFilePath(path: string): boolean {
    return /(^|\/)src\/.*\.(tsx|jsx|ts|js)$/i.test(path)
      && !/\.test\.(tsx|jsx|ts|js)$/i.test(path);
  }

  private extractUiWorkspacePrefix(path: string): string | null {
    const normalizedPath = this.normalizePath(path);
    const lowerPath = normalizedPath.toLowerCase();
    if (lowerPath.startsWith('src/')) {
      return '';
    }
    const marker = '/src/';
    const markerIndex = lowerPath.indexOf(marker);
    if (markerIndex < 0) {
      return null;
    }
    return normalizedPath.slice(0, markerIndex);
  }

  /**
   * Validate generated artifacts directly to catch placeholder-only pages.
   */
  private collectArtifactQualityIssues(sessionId: string): string[] {
    const issues: string[] = [];
    const { workspaceFiles, uiFiles } = this.resolvePrimaryWorkspaceScope(sessionId);
    if (workspaceFiles.length === 0) {
      return issues;
    }
    if (uiFiles.length === 0) {
      return issues;
    }

    const normalizedUiFiles = uiFiles;
    const entryFile = this.selectEntryUiFile(normalizedUiFiles);
    const scopedUiFiles = this.collectReachableUiFiles(normalizedUiFiles, entryFile?.path);
    const qualityScopeFiles = scopedUiFiles.length > 0 ? scopedUiFiles : normalizedUiFiles;

    const pageLikeFiles = qualityScopeFiles.filter(
      file => /(^|\/)(App|.*Page)\.(tsx|jsx|ts|js)$/i.test(file.path),
    );

    for (const file of pageLikeFiles) {
      const compact = file.content.replace(/\s+/g, ' ').trim();
      if (/return\s*<\s*(section|div|main|article)\s*\/\s*>;?/i.test(compact)) {
        issues.push(`${file.path} renders only an empty container`);
        continue;
      }
      if (/return\s*<\s*(section|div|main|article)\s*>\s*<\/\s*(section|div|main|article)\s*>;?/i.test(compact)) {
        issues.push(`${file.path} renders an empty wrapper without business content`);
        continue;
      }
      const placeholderInsensitiveContent = file.content.replace(
        /\bplaceholder\s*=\s*(?:\{[^}]*\}|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')/gi,
        '',
      );
      if (this.containsPlaceholderMarkers(placeholderInsensitiveContent)) {
        issues.push(`${file.path} contains placeholder markers`);
      }

      const isErrorPage = /(^|\/)src\/pages\/errors\//i.test(file.path);
      if (!isErrorPage && this.isLowFidelityPage(file.content)) {
        issues.push(`${file.path} appears low-fidelity (single-block placeholder-like page without workflow UI)`);
      }
    }

    if (!entryFile) {
      issues.push('No runtime entry module was generated (missing React root mount)');
    } else {
      const entryContent = entryFile.content;
      const mountsReactRoot = /createRoot\s*\(/.test(entryContent) && /render\s*\(/.test(entryContent);
      const hasRouterBootstrap = /\bBrowserRouter\b/.test(entryContent) || /\bRouterProvider\b/.test(entryContent);
      const importsAppShell = /import\s+[\s\S]*\b(App|RootApp)\b[\s\S]*from\s+['"][^'"]*(\/|^)(App|RootApp|pages\/RootApp)['"]/m.test(entryContent);
      const mountsAppShellTag = /<\s*(App|RootApp)\b/.test(entryContent);
      const mountsAppShell = hasRouterBootstrap || (importsAppShell && mountsAppShellTag);
      if (!mountsReactRoot || !mountsAppShell) {
        issues.push(`${entryFile.path} does not mount a routed app shell (App/RootApp + router)`);
      }
    }

    const routeSourceFiles = qualityScopeFiles.filter(
      file =>
        (entryFile?.path ? file.path === entryFile.path : false)
        || /(^|\/)src\/main\.(tsx|jsx|ts|js)$/i.test(file.path)
        || /(^|\/)src\/(App|pages\/RootApp)\.(tsx|jsx|ts|js)$/i.test(file.path)
        || /(^|\/)src\/router\/.*\.(tsx|jsx|ts|js)$/i.test(file.path)
        || /(^|\/)src\/routes\/.*\.(tsx|jsx|ts|js)$/i.test(file.path),
    );
    const routeSourceText = routeSourceFiles.map(file => file.content).join('\n');
    if (routeSourceText.trim().length > 0) {
      const entryHasRouterProvider = entryFile
        ? this.hasMountedRouterProvider(entryFile.content)
        : false;
      const appShellHasRouterProvider = routeSourceFiles.some(
        file =>
          (!entryFile || file.path !== entryFile.path)
          && this.hasMountedRouterProvider(file.content),
      );
      if (entryHasRouterProvider && appShellHasRouterProvider) {
        issues.push(
          `Detected nested router providers: mount router once in entry module "${entryFile?.path || 'entry'}" and remove additional BrowserRouter/RouterProvider wrappers`,
        );
      }

      const hasRoutingComposition =
        /\bRoutes?\b/.test(routeSourceText)
        || /\bRoute\b/.test(routeSourceText)
        || /\buseRoutes\b/.test(routeSourceText)
        || /\bcreateBrowserRouter\b/.test(routeSourceText)
        || /\bRouterProvider\b/.test(routeSourceText)
        || /\bNavigate\b/.test(routeSourceText);
      if (!hasRoutingComposition) {
        issues.push('Application shell lacks router-driven page composition');
      }

      const routeSegments = this.extractRouteSegments(routeSourceText);
      const genericRouteSegments = new Set([
        'dashboard',
        'home',
        'index',
        'settings',
        'module',
        'modules',
        'orders',
        'products',
        'users',
        'list',
        'detail',
        'worklist',
        'analytics',
        'reports',
      ]);
      if (routeSegments.length >= 3) {
        const nonGenericSegments = routeSegments.filter(
          segment => !genericRouteSegments.has(segment),
        );
        if (nonGenericSegments.length === 0) {
          issues.push(
            'Application routes only define generic navigation semantics; align route semantics with analysis requirements',
          );
        }
      }

      const missingArchitectRoutes = this.findMissingArchitectRoutes(routeSourceText);
      if (missingArchitectRoutes.length > 0) {
        const routeFileHints = routeSourceFiles
          .map(file => file.path)
          .filter(path =>
            /(^|\/)src\/(App\.(tsx|jsx|ts|js)|pages\/RootApp\.(tsx|jsx|ts|js))/i.test(path)
            || /(^|\/)src\/router\/.*\.(tsx|jsx|ts|js)$/i.test(path)
            || /(^|\/)src\/routes\/.*\.(tsx|jsx|ts|js)$/i.test(path),
          )
          .slice(0, 5);
        const routeHintSuffix = routeFileHints.length > 0
          ? ` Route source files: ${routeFileHints.join(', ')}`
          : '';
        issues.push(
          `Router is missing architect routes: ${missingArchitectRoutes.slice(0, 8).join(', ')}.${routeHintSuffix}`,
        );
      }
    }

    const hasInteractionHandler = qualityScopeFiles.some(
      file => /\bon(?:Click|Change|Submit|Input|KeyDown|KeyUp|Focus|Blur)\s*=\s*\{/i.test(file.content),
    );
    if (!hasInteractionHandler) {
      issues.push('UI source files do not expose interactive event handlers (onClick/onChange/onSubmit/etc.)');
    }

    const hasStateHook = qualityScopeFiles.some(file => /\buse(State|Reducer|Memo|Effect|Ref)\s*\(/.test(file.content));
    if (!hasStateHook) {
      issues.push('UI source files do not contain React stateful hooks required for interactive behavior');
    }

    for (const file of qualityScopeFiles) {
      if (!this.hasUnstableStoreObjectSelector(file.content)) {
        continue;
      }
      issues.push(
        `${file.path} uses a store selector that returns a new object literal each render; use stable selectors or shallow equality to avoid render loops`,
      );
    }

    const filePathSet = new Set(
      workspaceFiles.map(file => file.path),
    );
    issues.push(...this.collectMissingImportIssues(qualityScopeFiles, filePathSet, workspaceFiles));
    issues.push(...this.collectImportExportContractIssues(qualityScopeFiles, filePathSet, workspaceFiles));

    return [...new Set(issues)];
  }

  private collectReachableUiFiles(
    uiFiles: Array<{ path: string; content: string }>,
    entryPath?: string,
  ): Array<{ path: string; content: string }> {
    if (uiFiles.length === 0) {
      return [];
    }

    const fileByPath = new Map<string, { path: string; content: string }>();
    for (const file of uiFiles) {
      fileByPath.set(file.path, file);
    }
    const existingPaths = new Set(fileByPath.keys());

    const inferredEntryPath = entryPath ?? this.selectEntryUiFile(uiFiles)?.path ?? '';
    const entryCandidates = [inferredEntryPath].filter(Boolean);
    const resolvedEntry = entryCandidates.find(candidate => fileByPath.has(candidate));
    if (!resolvedEntry) {
      return uiFiles;
    }

    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    const visited = new Set<string>();
    const queue: string[] = [resolvedEntry];

    while (queue.length > 0) {
      const currentPath = queue.shift();
      if (!currentPath || visited.has(currentPath)) {
        continue;
      }
      visited.add(currentPath);

      const file = fileByPath.get(currentPath);
      if (!file) {
        continue;
      }

      const fileDir = currentPath.includes('/')
        ? currentPath.slice(0, currentPath.lastIndexOf('/'))
        : '';
      const importPattern =
        /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

      let match: RegExpExecArray | null = null;
      while ((match = importPattern.exec(file.content)) !== null) {
        const rawSpecifier = (match[1] ?? match[2] ?? '').trim();
        if (!rawSpecifier) {
          continue;
        }

        const specifier = rawSpecifier.split('?')[0]?.split('#')[0] ?? rawSpecifier;
        const resolvedBase = this.resolveImportSpecifierBase(fileDir, specifier, existingPaths);
        if (!resolvedBase) {
          continue;
        }

        const candidates = new Set<string>([resolvedBase]);
        for (const ext of extensions) {
          candidates.add(`${resolvedBase}${ext}`);
          candidates.add(`${resolvedBase}/index${ext}`);
        }

        for (const candidate of candidates) {
          if (fileByPath.has(candidate) && !visited.has(candidate)) {
            queue.push(candidate);
          }
        }
      }
    }

    return uiFiles.filter(file => visited.has(file.path));
  }

  private hasMountedRouterProvider(content: string): boolean {
    return /<\s*(BrowserRouter|HashRouter|MemoryRouter|RouterProvider)\b/.test(content);
  }

  private hasUnstableStoreObjectSelector(content: string): boolean {
    return /use[A-Za-z0-9_]*Store\s*\(\s*\(\s*state\s*\)\s*=>\s*\(\s*\{/i.test(content);
  }

  private selectEntryUiFile(
    uiFiles: Array<{ path: string; content: string }>,
  ): { path: string; content: string } | null {
    if (uiFiles.length === 0) {
      return null;
    }

    const scored = uiFiles.map(file => {
      const source = file.content || '';
      let score = 0;

      if (/\bcreateRoot\s*\(/.test(source) || /\bReactDOM\.render\s*\(/.test(source)) score += 120;
      if (/\bdocument\.getElementById\s*\(/.test(source) && /\brender\s*\(/.test(source)) score += 40;
      if (/\bRouterProvider\b|\bBrowserRouter\b/.test(source)) score += 20;
      if (/^\s*import\s+/m.test(source)) score += 10;
      if (/\bexport\s+default\b/.test(source) && !/\brender\s*\(/.test(source)) score -= 30;

      const depth = file.path.split('/').length;
      return { file, score, depth };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.depth - b.depth;
    });

    const best = scored[0];
    if (!best || best.score <= 0) {
      return null;
    }
    return best.file;
  }

  private containsPlaceholderMarkers(content: string): boolean {
    if (/(todo|fixme|coming soon|to be implemented|\bplaceholder\s+(component|content|page|screen|module|stub)\b)/i.test(content)) {
      return true;
    }
    return /(待实现|未实现|占位(?!符)|占位页面|占位模块|后续补充|敬请期待|示例数据|mock数据)/i.test(content);
  }

  private extractRouteSegments(appShellContent: string): string[] {
    const segments = new Set<string>();
    const routePatterns = [
      /path\s*=\s*['"]\/([^'"]+)['"]/g,
      /path\s*:\s*['"]\/([^'"]+)['"]/g,
    ];
    for (const pattern of routePatterns) {
      let match: RegExpExecArray | null = null;
      while ((match = pattern.exec(appShellContent)) !== null) {
        const raw = match[1]?.trim();
        if (!raw) {
          continue;
        }
        const firstSegment = raw
          .split('/')
          .map(part => part.trim().toLowerCase())
          .find(part => part && !part.startsWith(':'));
        if (firstSegment) {
          segments.add(firstSegment);
        }
      }
    }
    return [...segments];
  }

  private collectCurrentUnresolvedImportIssues(sessionId: string): string[] {
    const { workspaceFiles, uiFiles } = this.resolvePrimaryWorkspaceScope(sessionId);
    if (workspaceFiles.length === 0) {
      return [];
    }
    if (uiFiles.length === 0) {
      return [];
    }
    const filePathSet = new Set(
      workspaceFiles.map(file => file.path),
    );
    return [
      ...this.collectMissingImportIssues(uiFiles, filePathSet, workspaceFiles),
      ...this.collectImportExportContractIssues(uiFiles, filePathSet, workspaceFiles),
    ];
  }

  private collectMissingImportIssues(
    uiFiles: Array<{ path: string; content: string }>,
    existingPaths: Set<string>,
    allFiles: Array<{ path: string; content: string }>,
  ): string[] {
    const issues: string[] = [];
    const importPattern =
      /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
    const extensions = [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.json',
      '.css',
      '.scss',
      '.sass',
      '.less',
      '.pcss',
      '.styl',
      '.svg',
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
    ];
    const usedAliasSpecifiers = new Set<string>();

    for (const file of uiFiles) {
      const normalizedFilePath = this.normalizePath(file.path);
      const fileDir = normalizedFilePath.includes('/')
        ? normalizedFilePath.slice(0, normalizedFilePath.lastIndexOf('/'))
        : '';

      let match: RegExpExecArray | null = null;
      while ((match = importPattern.exec(file.content)) !== null) {
        const rawSpecifier = (match[1] ?? match[2] ?? '').trim();
        if (rawSpecifier.length === 0) {
          continue;
        }
        const specifier = rawSpecifier.split('?')[0]?.split('#')[0] ?? rawSpecifier;
        const resolvedBase = this.resolveImportSpecifierBase(fileDir, specifier, existingPaths);
        if (!resolvedBase) {
          continue;
        }
        if (specifier.startsWith('@/')) {
          usedAliasSpecifiers.add(specifier);
        }

        const candidates = new Set<string>();
        candidates.add(resolvedBase);
        for (const ext of extensions) {
          candidates.add(`${resolvedBase}${ext}`);
          candidates.add(`${resolvedBase}/index${ext}`);
        }

        const exists = [...candidates].some(candidate => existingPaths.has(candidate));
        if (!exists) {
          issues.push(`${normalizedFilePath} has unresolved import "${rawSpecifier}"`);
        }
      }
    }

    if (usedAliasSpecifiers.size > 0) {
      issues.push(...this.collectAliasConfigurationIssues(allFiles, usedAliasSpecifiers));
    }

    return issues;
  }

  private collectImportExportContractIssues(
    uiFiles: Array<{ path: string; content: string }>,
    existingPaths: Set<string>,
    allFiles: Array<{ path: string; content: string }>,
  ): string[] {
    const issues: string[] = [];
    const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    const normalizedFiles = allFiles.map(file => ({
      path: this.normalizePath(file.path),
      content: file.content,
    }));
    const exportMap = new Map<string, { hasDefault: boolean; named: Set<string> }>();
    for (const file of normalizedFiles) {
      const pathLower = file.path.toLowerCase();
      if (!codeExtensions.some(ext => pathLower.endsWith(ext))) {
        continue;
      }
      exportMap.set(file.path, this.parseModuleExports(file.content));
    }

    const importPattern = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
    for (const file of uiFiles) {
      const normalizedFilePath = this.normalizePath(file.path);
      const fileDir = normalizedFilePath.includes('/')
        ? normalizedFilePath.slice(0, normalizedFilePath.lastIndexOf('/'))
        : '';

      let match: RegExpExecArray | null = null;
      while ((match = importPattern.exec(file.content)) !== null) {
        const clause = (match[1] ?? '').trim();
        const rawSpecifier = (match[2] ?? '').trim();
        if (!clause || !rawSpecifier) {
          continue;
        }

        const specifier = rawSpecifier.split('?')[0]?.split('#')[0] ?? rawSpecifier;
        const resolvedBase = this.resolveImportSpecifierBase(fileDir, specifier, existingPaths);
        if (!resolvedBase) {
          continue;
        }

        const targetFilePath = this.resolveExistingImportTarget(resolvedBase, existingPaths);
        if (!targetFilePath) {
          continue;
        }
        const targetLower = targetFilePath.toLowerCase();
        if (!codeExtensions.some(ext => targetLower.endsWith(ext))) {
          continue;
        }

        const contract = this.parseImportClause(clause);
        if (!contract) {
          continue;
        }
        const targetExports = exportMap.get(targetFilePath);
        if (!targetExports) {
          continue;
        }

        if (contract.defaultImport && !targetExports.hasDefault) {
          issues.push(
            `${normalizedFilePath} imports default from "${rawSpecifier}" but ${targetFilePath} has no default export`,
          );
        }
        for (const namedImport of contract.namedImports) {
          if (!targetExports.named.has(namedImport)) {
            issues.push(
              `${normalizedFilePath} imports { ${namedImport} } from "${rawSpecifier}" but ${targetFilePath} does not export it`,
            );
          }
        }
      }
    }

    return issues;
  }

  private resolveExistingImportTarget(
    resolvedBase: string,
    existingPaths: Set<string>,
  ): string | null {
    const candidates = [
      resolvedBase,
      `${resolvedBase}.ts`,
      `${resolvedBase}.tsx`,
      `${resolvedBase}.js`,
      `${resolvedBase}.jsx`,
      `${resolvedBase}.mjs`,
      `${resolvedBase}.cjs`,
      `${resolvedBase}/index.ts`,
      `${resolvedBase}/index.tsx`,
      `${resolvedBase}/index.js`,
      `${resolvedBase}/index.jsx`,
      `${resolvedBase}/index.mjs`,
      `${resolvedBase}/index.cjs`,
    ];
    for (const candidate of candidates) {
      if (existingPaths.has(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private parseModuleExports(content: string): { hasDefault: boolean; named: Set<string> } {
    const hasDefault = /\bexport\s+default\b/.test(content);
    const named = new Set<string>();

    const namedDeclarationPattern =
      /\bexport\s+(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
    let declarationMatch: RegExpExecArray | null = null;
    while ((declarationMatch = namedDeclarationPattern.exec(content)) !== null) {
      const symbol = declarationMatch[1];
      if (symbol) {
        named.add(symbol);
      }
    }

    const namedExportListPattern = /\bexport\s*\{([^}]+)\}/g;
    let listMatch: RegExpExecArray | null = null;
    while ((listMatch = namedExportListPattern.exec(content)) !== null) {
      const list = listMatch[1];
      if (!list) {
        continue;
      }
      list
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .forEach(item => {
          const aliasParts = item.split(/\s+as\s+/i).map(part => part.trim());
          const exported = aliasParts.length > 1 ? aliasParts[1] : aliasParts[0];
          if (exported && exported !== 'default') {
            named.add(exported);
          }
        });
    }

    return { hasDefault, named };
  }

  private parseImportClause(
    clause: string,
  ): { defaultImport: string | null; namedImports: string[] } | null {
    if (!clause || clause.startsWith('*')) {
      return null;
    }

    const trimmed = clause.replace(/^type\s+/, '').trim();
    const namedImports: string[] = [];
    const namedMatch = trimmed.match(/\{([^}]+)\}/);
    if (namedMatch?.[1]) {
      namedMatch[1]
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .forEach(item => {
          const withoutType = item.replace(/^type\s+/, '').trim();
          if (!withoutType) {
            return;
          }
          const aliasParts = withoutType.split(/\s+as\s+/i).map(part => part.trim());
          const imported = aliasParts[0];
          if (imported && imported !== 'default') {
            namedImports.push(imported);
          }
        });
    }

    const defaultPart = trimmed.split(',')[0]?.trim() ?? '';
    const hasDefaultImport = defaultPart.length > 0 && !defaultPart.startsWith('{');
    const defaultImport = hasDefaultImport ? defaultPart : null;

    return { defaultImport, namedImports };
  }

  private resolveImportSpecifierBase(
    fileDir: string,
    specifier: string,
    existingPaths?: Set<string>,
  ): string | null {
    if (specifier.startsWith('.')) {
      return this.resolveRelativeImportPath(fileDir, specifier);
    }
    if (specifier.startsWith('@/')) {
      return this.normalizePath(`src/${specifier.slice(2)}`);
    }
    if (specifier.startsWith('src/')) {
      return this.normalizePath(specifier);
    }
    const scopedAliasMatch = specifier.match(/^@([A-Za-z0-9_-]+)(?:\/(.*))?$/);
    if (scopedAliasMatch) {
      const aliasHead = scopedAliasMatch[1] ?? '';
      const aliasTail = scopedAliasMatch[2] ?? '';
      if (aliasHead) {
        const suffix = aliasTail.length > 0 ? `${aliasHead}/${aliasTail}` : aliasHead;
        for (const prefix of this.collectSrcPrefixes(existingPaths)) {
          const candidateBase = prefix ? `${prefix}/src/${suffix}` : `src/${suffix}`;
          const normalizedCandidateBase = this.normalizePath(candidateBase);
          if (!existingPaths || this.doesImportBaseResolve(normalizedCandidateBase, existingPaths)) {
            return normalizedCandidateBase;
          }
        }
      }
    }
    return null;
  }

  private collectSrcPrefixes(existingPaths?: Set<string>): string[] {
    if (!existingPaths || existingPaths.size === 0) {
      return [''];
    }

    const prefixes = new Set<string>();
    for (const path of existingPaths) {
      const normalizedPath = this.normalizePath(path);
      if (normalizedPath.startsWith('src/')) {
        prefixes.add('');
        continue;
      }

      const markerIndex = normalizedPath.indexOf('/src/');
      if (markerIndex === 0) {
        prefixes.add('');
      } else if (markerIndex > 0) {
        prefixes.add(normalizedPath.slice(0, markerIndex));
      }
    }

    if (prefixes.size === 0) {
      prefixes.add('');
    }

    return [...prefixes];
  }

  private doesImportBaseResolve(resolvedBase: string, existingPaths: Set<string>): boolean {
    if (existingPaths.has(resolvedBase)) {
      return true;
    }

    const extensions = [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.json',
      '.css',
      '.scss',
      '.sass',
      '.less',
      '.pcss',
      '.styl',
      '.svg',
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
    ];

    for (const ext of extensions) {
      if (existingPaths.has(`${resolvedBase}${ext}`) || existingPaths.has(`${resolvedBase}/index${ext}`)) {
        return true;
      }
    }

    return false;
  }

  private collectAliasConfigurationIssues(
    files: Array<{ path: string; content: string }>,
    aliasSpecifiers: Set<string>,
  ): string[] {
    const issues: string[] = [];
    const normalizedFiles = files.map(file => ({
      path: this.normalizePath(file.path),
      content: file.content,
    }));
    const viteConfigFiles = normalizedFiles.filter(file =>
      /(^|\/)vite\.config\.(ts|js|mjs|cjs)$/i.test(file.path),
    );
    const hasAliasConfig = viteConfigFiles.some(file =>
      /alias\s*:\s*(?:\{[\s\S]*?['"]@['"]\s*:|\[[\s\S]*?find\s*:\s*['"]@['"])/m.test(file.content),
    );
    const sampleSpecifiers = [...aliasSpecifiers].slice(0, 3).join(', ');
    if (!hasAliasConfig) {
      issues.push(
        `Alias imports (${sampleSpecifiers}) are used but "@" alias is not configured in vite.config.*`,
      );
      return issues;
    }

    const packageJsonFile = normalizedFiles.find(file => file.path === 'package.json');
    const packageIsModule = !!packageJsonFile && /"type"\s*:\s*"module"/.test(packageJsonFile.content);
    if (!packageIsModule) {
      return issues;
    }

    const invalidAliasConfig = viteConfigFiles.find(file =>
      /\b__dirname\b/.test(file.content) && /['"]@['"]/.test(file.content),
    );
    if (invalidAliasConfig) {
      issues.push(
        `${invalidAliasConfig.path} uses __dirname for "@" alias in an ESM project; use fileURLToPath(new URL('./src', import.meta.url)) or switch to relative imports`,
      );
    }

    return issues;
  }

  private findMissingArchitectRoutes(routeSourceText: string): string[] {
    const docs = this.blackboard.getSessionDocuments();
    const architectDoc = docs.find(doc => doc.agentId === 'frontend-architect');
    if (!architectDoc || typeof architectDoc !== 'object' || architectDoc === null) {
      return [];
    }

    const rawRouteDesign = (architectDoc as {
      content?: { routeDesign?: Array<{ path?: string }> };
    }).content?.routeDesign;

    if (!Array.isArray(rawRouteDesign) || rawRouteDesign.length === 0) {
      return [];
    }

    const expectedPaths = rawRouteDesign
      .map(route => (typeof route.path === 'string' ? this.normalizeRoutePath(route.path) : ''))
      .filter(path => path.length > 0);

    const uniqueExpectedPaths = [...new Set(expectedPaths)];
    const declaredPaths = this.extractDeclaredRoutePaths(routeSourceText);
    const missing: string[] = [];
    for (const path of uniqueExpectedPaths) {
      if (!this.isArchitectRouteCovered(path, declaredPaths)) {
        missing.push(`/${path}`);
      }
    }
    return missing;
  }

  private buildRouterRepairDirectives(sessionId: string, routerIssue?: string): string[] {
    if (!routerIssue) {
      return [];
    }

    const parsedRoutes = routerIssue.match(/\/[A-Za-z0-9/_-]+/g) ?? [];
    const missingRoutes = [...new Set(
      parsedRoutes
        .map(route => this.normalizeRoutePath(route))
        .filter(route => route.length > 0)
        .map(route => `/${route}`),
    )];
    const routeTargets = this.collectRouteRepairTargets(sessionId);

    return [
      'Route coverage issue detected. Update existing application route declarations (not docs/prompts/scripts).',
      ...(routeTargets.length > 0
        ? [`Prioritize these existing route source files: ${routeTargets.slice(0, 8).join(', ')}`]
        : []),
      ...(missingRoutes.length > 0
        ? [`Ensure these exact route paths are declared: ${missingRoutes.join(', ')}`]
        : []),
      'A successful repair round must mutate route source files that participate in runtime routing.',
    ];
  }

  private collectRouteRepairTargets(sessionId: string): string[] {
    const { workspaceFiles } = this.resolvePrimaryWorkspaceScope(sessionId);
    const candidates = workspaceFiles
      .map(file => file.path)
      .filter(path =>
        /(^|\/)src\/(App\.(tsx|jsx|ts|js)|pages\/RootApp\.(tsx|jsx|ts|js))/i.test(path)
        || /(^|\/)src\/router\/.*\.(tsx|jsx|ts|js)$/i.test(path)
        || /(^|\/)src\/routes\/.*\.(tsx|jsx|ts|js)$/i.test(path),
      );

    return [...new Set(candidates)];
  }

  private extractDeclaredRoutePaths(routeSourceText: string): Set<string> {
    const declaredPaths = new Set<string>();
    const routePatterns = [
      /path\s*=\s*['"`]([^'"`]+)['"`]/g,
      /path\s*:\s*['"`]([^'"`]+)['"`]/g,
    ];

    for (const pattern of routePatterns) {
      let match: RegExpExecArray | null = null;
      while ((match = pattern.exec(routeSourceText)) !== null) {
        const normalized = this.normalizeRoutePath(match[1] ?? '');
        if (normalized.length > 0) {
          declaredPaths.add(normalized);
        }
      }
    }

    return declaredPaths;
  }

  private isArchitectRouteCovered(expectedPath: string, declaredPaths: Set<string>): boolean {
    if (declaredPaths.has(expectedPath)) {
      return true;
    }

    const canonicalExpected = this.canonicalizeRoutePath(expectedPath);

    for (const declaredPath of declaredPaths) {
      if (declaredPath.startsWith(`${expectedPath}/`)) {
        return true;
      }
      if (expectedPath.startsWith(`${declaredPath}/`)) {
        return true;
      }

      const canonicalDeclared = this.canonicalizeRoutePath(declaredPath);
      if (canonicalDeclared === canonicalExpected) {
        return true;
      }
      if (canonicalDeclared.startsWith(`${canonicalExpected}/`)) {
        return true;
      }
      if (canonicalExpected.startsWith(`${canonicalDeclared}/`)) {
        return true;
      }
    }

    return false;
  }

  private canonicalizeRoutePath(routePath: string): string {
    const normalized = this.normalizeRoutePath(routePath);
    if (!normalized) {
      return '';
    }

    return normalized
      .split('/')
      .filter(Boolean)
      .map(segment => this.canonicalizeRouteSegment(segment))
      .join('/');
  }

  private canonicalizeRouteSegment(segment: string): string {
    const normalized = segment.trim().toLowerCase();
    if (!normalized) {
      return normalized;
    }

    if (normalized.length > 4 && normalized.endsWith('ies')) {
      return `${normalized.slice(0, -3)}y`;
    }

    if (normalized.length > 3 && normalized.endsWith('s') && !normalized.endsWith('ss')) {
      return normalized.slice(0, -1);
    }

    return normalized;
  }

  private isRoutingShellPage(content: string): boolean {
    if (!/<\s*Outlet\b/.test(content)) {
      return false;
    }

    const compact = content.replace(/\s+/g, ' ').trim();
    const outletOnlyReturn =
      /return\s*<\s*Outlet\b[^>]*\/>\s*;?/i.test(compact)
      || /return\s*\(\s*<\s*(main|section|div|article|aside)\b[\s\S]*<\s*Outlet\b[\s\S]*<\/\s*(main|section|div|article|aside)\s*>\s*\)\s*;?/i.test(content);

    if (!outletOnlyReturn) {
      return false;
    }

    const hasInteractiveSurface =
      /\bon(?:Click|Change|Submit|Input|KeyDown|KeyUp|Focus|Blur)\s*=\s*\{/i.test(content)
      || /<\s*(button|input|select|textarea|form|table|dialog)\b/i.test(content)
      || /\buse(State|Reducer|Memo|Effect|Ref)\s*\(/.test(content);
    const businessTagCount = (content.match(/<\s*(h1|h2|h3|p|table|form|button|input|select|textarea|canvas|iframe|svg)\b/gi) ?? []).length;

    return !hasInteractiveSurface && businessTagCount <= 2;
  }

  private isLowFidelityPage(content: string): boolean {
    if (this.isRoutingShellPage(content)) {
      return false;
    }

    const compact = content.replace(/\s+/g, ' ').trim();
    const tagCount = (content.match(/<\s*[A-Za-z][A-Za-z0-9]*/g) ?? []).length;
    const hasRoutingComposition =
      /\bRoutes?\b/.test(content)
      || /\bRoute\b/.test(content)
      || /\buseRoutes\b/.test(content)
      || /\bcreateBrowserRouter\b/.test(content)
      || /\bRouterProvider\b/.test(content)
      || /\bNavigate\b/.test(content);
    const hasInteractiveSurface =
      /\bon(?:Click|Change|Submit|Input|KeyDown|KeyUp|Focus|Blur)\s*=\s*\{/i.test(content)
      || /<\s*(button|input|select|textarea|form|table|dialog)\b/i.test(content)
      || /\buse(State|Reducer|Memo|Effect|Ref)\s*\(/.test(content);

    if (hasInteractiveSurface || hasRoutingComposition) {
      return false;
    }

    const singleWrapperLiteral =
      /return\s*<\s*(section|div|main|article)\b[^>]*>[\s\S]{0,160}<\/\s*(section|div|main|article)\s*>;?/i.test(compact);

    return singleWrapperLiteral || (compact.length < 260 && tagCount <= 3);
  }

  private normalizeRoutePath(path: string): string {
    return path
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  }

  private resolveRelativeImportPath(fromDir: string, specifier: string): string {
    const seed = fromDir ? `${fromDir}/${specifier}` : specifier;
    const parts = seed.split('/');
    const normalized: string[] = [];
    for (const part of parts) {
      if (!part || part === '.') {
        continue;
      }
      if (part === '..') {
        normalized.pop();
        continue;
      }
      normalized.push(part);
    }
    return normalized.join('/');
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  /**
   * Build a degraded QualityGateState after exhausting all repair rounds.
   */
  private buildDegradedState(gateName: string, summary: string): QualityGateState {
    return {
      gate: gateName,
      status: 'failed',
      summary: `Degraded completion â€?repair rounds exhausted. Unresolved issues: ${summary}`,
    };
  }
}

