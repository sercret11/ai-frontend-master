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
import type { MergedPatchBatch, PatchIntent } from '../runtime/multi-agent/types';
import type { MultiAgentBlackboard } from '../runtime/multi-agent/blackboard';
import type { LLMClient } from '../llm/client';
import type { ProviderID, ToolDefinition, ToolExecutor } from '../llm/types';
import { getExecutionAgent } from './agents/index';
import { mergePatchIntents } from '../runtime/multi-agent/patch-crdt';
import { ToolRegistry } from '../tool/registry';
import { FileStorage } from '../storage/file-storage';

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
  model: string
): ToolExecutor {
  return async (name: string, args: Record<string, unknown>) => {
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
  constructor(
    private blackboard: MultiAgentBlackboard,
    private llmClient: LLMClient,
    private provider: ProviderID,
    private model: string,
  ) {}

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
    const context: ExecutionContext = {
      sessionId: input.sessionId,
      runId: input.runId,
      userMessage: input.userMessage,
      platform: input.platform,
      techStack: input.techStack,
      abortSignal: input.abortSignal,
      emitRuntimeEvent: input.emitRuntimeEvent,
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

    // 2. Execute each wave sequentially
    let lastCodeGenWaveIndex = -1;

    for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
      const waveTasks = waves[waveIndex];
      if (!waveTasks || waveTasks.length === 0) continue;

      // Emit wave start event
      input.emitRuntimeEvent({
        type: 'agent.task.progress',
        agentId: waveTasks[0].agentId,
        taskId: `wave-${waveIndex}`,
        waveId: `wave-${waveIndex}`,
        progressText: `Wave ${waveIndex + 1}/${waves.length} starting â€?${waveTasks.length} task(s): ${waveTasks.map(t => t.agentId).join(', ')}`,
      });

      // Run all tasks in this wave in parallel
      const results = await this.runWave(waveTasks, context, waveIndex);

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
          degradedTasks.push(result.taskId);
        }
      }

      // Detect and merge conflicts within this wave
      if (waveIntents.length > 0) {
        const merged = this.detectAndMergeConflicts(waveIntents);
        allPatchIntents.push(...merged.merged);
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
        agentId: waveTasks[0].agentId,
        taskId: `wave-${waveIndex}`,
        waveId: `wave-${waveIndex}`,
        progressText: `Wave ${waveIndex + 1}/${waves.length} complete â€?${waveIntents.length} patch intent(s)`,
      });
    }

    // 3. Run quality gate + repair loop after all code-gen waves
    const qualityWaveIndex = lastCodeGenWaveIndex + 1;
    const qualityState = await this.runQualityRepairLoop(context, qualityWaveIndex, 2);

    if (qualityState.status === 'failed') {
      const summary = qualityState.summary ?? 'Quality gate failed after repair rounds';
      unresolvedIssues.push(summary);
    }

    // 4. Build final output
    const touchedFilesArray = [...allTouchedFiles];
    const success =
      degradedTasks.length === 0 &&
      unresolvedIssues.length === 0 &&
      qualityState.status === 'passed';

    return {
      success,
      patchIntents: allPatchIntents,
      touchedFiles: touchedFilesArray,
      degradedTasks,
      unresolvedIssues,
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
    const agent = getExecutionAgent(task.agentId);
    const waveId = `wave-${waveIndex}`;

    // Emit progress event
    context.emitRuntimeEvent({
      type: 'agent.task.progress',
      agentId: task.agentId,
      taskId: task.id,
      waveId,
      progressText: `starting task: ${task.goal}`,
    });

    // Build the agent's system prompt.
    // `RuntimeAgent.buildPrompt` expects an `AgentExecutionContext`; we
    // construct a minimal compatible object from our `ExecutionContext`.
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
      emitRuntimeEvent: context.emitRuntimeEvent,
      abortSignal: context.abortSignal,
    });

    // Resolve tool definitions from the agent's allowed-tools whitelist
    const toolDefs = await buildToolDefinitions(
      task.tools.length > 0 ? task.tools : agent.allowedTools,
    );

    // Create a ToolExecutor that bridges ToolRegistry â†?LLMClient interface
    const messageId = `exec-${context.runId}-${task.id}-${Date.now()}`;
    const toolExecutor = createToolExecutor(
      context.sessionId,
      messageId,
      task.agentId,
      context.abortSignal,
      this.provider,
      this.model,
    );

    // Snapshot files before execution
    const beforeFiles = FileStorage.getAllFiles(context.sessionId);

    // Drive the LLM + tool-calling loop
    const llmResponse = await this.llmClient.completeWithTools(
      {
        provider: this.provider,
        model: this.model,
        systemPrompt,
        messages: [{ role: 'user', content: context.userMessage }],
        tools: toolDefs,
        abortSignal: context.abortSignal,
      },
      toolExecutor,
    );

    // Collect PatchIntents by diffing session files
    const patchIntents = collectPatchIntents(
      context.sessionId,
      task.id,
      task.agentId,
      waveIndex,
      beforeFiles,
    );

    // Submit PatchIntents to the Blackboard
    if (patchIntents.length > 0) {
      this.blackboard.addPatchIntents(patchIntents);
    }

    // Emit completion event
    context.emitRuntimeEvent({
      type: 'agent.task.progress',
      agentId: task.agentId,
      taskId: task.id,
      waveId,
      progressText: `completed â€?${patchIntents.length} file(s) changed`,
    });

    return {
      taskId: task.id,
      agentId: task.agentId,
      success: true,
      patchIntents,
      touchedFiles: patchIntents.map(p => p.filePath),
      responseText: llmResponse.text,
    };
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
          await this.runRepairRound(context, waveIndex, round + 1, lastQualitySummary);
          continue;
        }
        // Out of rounds â€?degraded
        return this.buildDegradedState(qualityGateName, lastQualitySummary);
      }

      // Determine pass/fail from the quality-agent's response
      const passed = this.isQualityPassed(qualityResult);

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
      lastQualitySummary = qualityResult.responseText
        || qualityResult.error
        || 'Quality check failed (no details available)';

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
      await this.runRepairRound(context, waveIndex, round + 1, lastQualitySummary);
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
    qualityIssues: string,
  ): Promise<TaskResult> {
    const repairTask: ExecutionPlanTask = {
      id: `repair-round-${roundNumber}`,
      agentId: 'repair-agent',
      goal: 'Fix the following quality issues found by quality-agent:\n\n' +
        qualityIssues + '\n\n' +
        'Apply targeted fixes. Minimize change scope while preserving architecture constraints.',
      dependsOn: [],
      tools: ['read', 'grep', 'glob', 'apply_diff', 'write', 'bash'],
    };

    context.emitRuntimeEvent({
      type: 'agent.task.progress',
      agentId: 'repair-agent',
      taskId: repairTask.id,
      waveId: `wave-${waveIndex}`,
      progressText: `repair round ${roundNumber} â€?fixing quality issues`,
    });

    try {
      return await this.executeTask(repairTask, context, waveIndex);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        taskId: repairTask.id,
        agentId: 'repair-agent',
        success: false,
        patchIntents: [],
        touchedFiles: [],
        error: `repair-agent crashed: ${errorMsg}`,
      };
    }
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

