/**
 * ThreeLayerOrchestrator - 三层架构编排器
 *
 * 执行顺序：
 * 1. AnalysisLayer
 * 2. PlanningLayer
 * 3. ExecutionLayer
 *
 * 当出现瞬时网络错误时，编排器会在同一 provider/model 下进行阶段级重试，
 * 不做模型或供应商降级。
 */

import type { AnalysisLayer } from '../analysis/analysis-layer.js';
import type { PlanningLayer } from '../planning/planning-layer.js';
import type { ExecutionLayer } from '../execution/execution-layer.js';
import type { MultiAgentBlackboard } from '../runtime/multi-agent/blackboard.js';
import type { MultiAgentEventBus } from '../runtime/multi-agent/event-bus.js';
import type { MultiAgentKernelInput } from '../runtime/multi-agent/types.js';

type StageName = 'analysis' | 'planning' | 'execution';

export class ThreeLayerOrchestrator {
  constructor(
    private readonly analysisLayer: AnalysisLayer,
    private readonly planningLayer: PlanningLayer,
    private readonly executionLayer: ExecutionLayer,
    private readonly blackboard: MultiAgentBlackboard,
    private readonly eventBus: MultiAgentEventBus,
  ) {}

  /**
   * 运行完整三层流水线。
   */
  async run(input: MultiAgentKernelInput): Promise<void> {
    const { emitRuntimeEvent } = input;
    this.emitBudgetConfiguration(input);

    // =========================================================================
    // Stage 1: Analysis Layer
    // =========================================================================
    emitRuntimeEvent({
      type: 'agent.task.started',
      agentId: 'planner-agent',
      taskId: 'orchestrator-analysis',
      waveId: 'orchestration',
      title: '分析层启动',
      goal: '执行 4 个分析智能体串行管线',
    });

    let analysisOutput;
    try {
      analysisOutput = await this.runWithTransientRetry(
        'analysis',
        input,
        () =>
          this.analysisLayer.run({
            sessionId: input.sessionId,
            userMessage: input.userMessage,
            platform: input.platform,
            techStack: input.techStack,
            abortSignal: input.abortSignal,
            emitRuntimeEvent,
          }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.publishErrorEvent(input, 'analysis', message);
      throw error;
    }

    if (!analysisOutput.success) {
      const message = analysisOutput.error ?? `Analysis failed at agent: ${analysisOutput.failedAgentId}`;
      this.publishErrorEvent(input, 'analysis', message);
      throw new Error(message);
    }

    // 保存分析文档
    this.blackboard.setSessionDocuments(analysisOutput.documents);

    emitRuntimeEvent({
      type: 'agent.task.completed',
      agentId: 'planner-agent',
      taskId: 'orchestrator-analysis',
      waveId: 'orchestration',
      success: true,
      summary: `分析层完成，产出 ${analysisOutput.documents.length} 份文档`,
    });

    // =========================================================================
    // Stage 2: Planning Layer
    // =========================================================================
    emitRuntimeEvent({
      type: 'agent.task.started',
      agentId: 'planner-agent',
      taskId: 'orchestrator-planning',
      waveId: 'orchestration',
      title: '规划层启动',
      goal: '根据分析文档生成执行计划',
    });

    let executionPlan;
    try {
      executionPlan = await this.runWithTransientRetry(
        'planning',
        input,
        () =>
          this.planningLayer.run({
            sessionId: input.sessionId,
            documents: analysisOutput.documents,
            abortSignal: input.abortSignal,
            emitRuntimeEvent,
          }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.publishErrorEvent(input, 'planning', message);
      throw error;
    }

    // 保存执行计划
    this.blackboard.setExecutionPlan(executionPlan);

    emitRuntimeEvent({
      type: 'agent.task.completed',
      agentId: 'planner-agent',
      taskId: 'orchestrator-planning',
      waveId: 'orchestration',
      success: true,
      summary: `规划层完成，生成 ${executionPlan.tasks.length} 个执行任务`,
    });

    // =========================================================================
    // Stage 3: Execution Layer
    // =========================================================================
    emitRuntimeEvent({
      type: 'agent.task.started',
      agentId: 'scaffold-agent',
      taskId: 'orchestrator-execution',
      waveId: 'orchestration',
      title: '执行层启动',
      goal: '按执行计划调度智能体生成代码',
    });

    let executionOutput;
    try {
      executionOutput = await this.runWithTransientRetry(
        'execution',
        input,
        () =>
          this.executionLayer.run({
            sessionId: input.sessionId,
            runId: input.runId,
            plan: executionPlan,
            userMessage: input.userMessage,
            platform: input.platform,
            techStack: input.techStack,
            runtimeBudget: input.runtimeBudget,
            abortSignal: input.abortSignal,
            emitRuntimeEvent,
          }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.publishErrorEvent(input, 'execution', message);
      throw error;
    }

    emitRuntimeEvent({
      type: 'agent.task.completed',
      agentId: 'scaffold-agent',
      taskId: 'orchestrator-execution',
      waveId: 'orchestration',
      success: executionOutput.success,
      summary: executionOutput.success
        ? `执行层完成，修改 ${executionOutput.touchedFiles.length} 个文件`
        : executionOutput.budgetStopReason
          ? `执行层因预算限制提前停止: ${executionOutput.budgetStopReason}`
        : `执行层降级完成，${executionOutput.unresolvedIssues.length} 个未解决问题`,
    });

    if (executionOutput.budgetStopReason) {
      emitRuntimeEvent({
        type: 'agent.task.blocked',
        agentId: 'scaffold-agent',
        taskId: 'orchestrator-execution',
        waveId: 'orchestration',
        reason: `execution stopped by runtime budget: ${executionOutput.budgetStopReason}`,
      });
    }

    // 执行层虽然完成但仍有未解决问题时，保留 run.error 便于前端可视化
    if (!executionOutput.success) {
      const issueParts: string[] = [];
      if (executionOutput.unresolvedIssues.length > 0) {
        issueParts.push(...executionOutput.unresolvedIssues);
      }
      if (executionOutput.budgetStopReason) {
        issueParts.push(`budget stop: ${executionOutput.budgetStopReason}`);
      }
      if (executionOutput.degradedTasks.length > 0) {
        issueParts.push(`degraded tasks: ${executionOutput.degradedTasks.join(', ')}`);
      }
      emitRuntimeEvent({
        type: 'run.error',
        error: `Execution completed with issues: ${issueParts.join('; ') || 'unknown issue'}`,
      });
    }
  }

  private emitBudgetConfiguration(input: MultiAgentKernelInput): void {
    const budget = input.runtimeBudget;
    if (!budget) {
      return;
    }

    const emitBudget = (unit: 'steps' | 'ms' | 'calls', limit: number, message: string): void => {
      input.emitRuntimeEvent({
        type: 'autonomy.budget',
        scope: 'run',
        used: 0,
        limit,
        remaining: limit,
        unit,
        status: this.calculateBudgetStatus(0, limit),
        message,
      });
    };

    if (typeof budget.maxIterations === 'number') {
      emitBudget('steps', budget.maxIterations, `runtime budget maxIterations=${budget.maxIterations}`);
    }
    if (typeof budget.maxDurationMs === 'number') {
      emitBudget('ms', budget.maxDurationMs, `runtime budget maxDurationMs=${budget.maxDurationMs}`);
    }
    if (typeof budget.maxToolCalls === 'number') {
      emitBudget('calls', budget.maxToolCalls, `runtime budget maxToolCalls=${budget.maxToolCalls}`);
    }
    if (typeof budget.targetScore === 'number') {
      input.emitRuntimeEvent({
        type: 'agent.task.progress',
        agentId: 'planner-agent',
        taskId: 'orchestrator-budget',
        waveId: 'orchestration',
        progressText: `runtime budget targetScore=${budget.targetScore}`,
      });
    }
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

  /**
   * 针对瞬时错误进行阶段级重试。
   * 保持同 provider/model，不做任何降级。
   */
  private async runWithTransientRetry<T>(
    stage: StageName,
    input: Pick<MultiAgentKernelInput, 'sessionId' | 'abortSignal'>,
    operation: () => Promise<T>,
  ): Promise<T> {
    const maxAttempts = this.resolveTransientRetryAttempts();
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (input.abortSignal.aborted) {
        throw input.abortSignal.reason ?? new DOMException('Aborted', 'AbortError');
      }

      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        const retryable =
          attempt < maxAttempts &&
          !input.abortSignal.aborted &&
          this.isTransientFailure(error);
        if (!retryable) {
          throw error;
        }

        const delayMs = this.calculateRetryDelayMs(attempt);
        console.warn(
          `[ThreeLayerOrchestrator] session=${input.sessionId} stage=${stage} transient-error retry=${attempt + 1}/${maxAttempts} delayMs=${delayMs} error=${this.formatError(error)}`,
        );
        await this.sleep(delayMs, input.abortSignal);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Unknown ${stage} stage failure after retries`);
  }

  private resolveTransientRetryAttempts(): number {
    const parsed = Number(process.env.RUNTIME_STAGE_RETRY_ATTEMPTS ?? 3);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 3;
    }
    return Math.floor(parsed);
  }

  private calculateRetryDelayMs(attempt: number): number {
    const baseDelayMs = Number(process.env.RUNTIME_STAGE_RETRY_BASE_DELAY_MS ?? 1500);
    const safeBase = Number.isFinite(baseDelayMs) && baseDelayMs > 0 ? baseDelayMs : 1500;
    return safeBase * Math.pow(2, attempt - 1);
  }

  private isTransientFailure(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const details = error as Error & {
      code?: string | number;
      status?: number;
      statusCode?: number;
      cause?: unknown;
      retryable?: boolean;
    };

    if (details.retryable === true) {
      return true;
    }

    const statusCode = this.extractStatusCode(details);
    if (statusCode != null && [0, 408, 409, 425, 429, 500, 502, 503, 504].includes(statusCode)) {
      return true;
    }

    const code = this.extractErrorCode(details);
    if (
      code &&
      [
        'ECONNRESET',
        'ETIMEDOUT',
        'ECONNREFUSED',
        'ENOTFOUND',
        'EAI_AGAIN',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_SOCKET',
      ].includes(code)
    ) {
      return true;
    }

    const message = this.formatError(error).toLowerCase();
    return (
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('socket hang up') ||
      message.includes('timed out') ||
      message.includes('timeout') ||
      message.includes('connection reset') ||
      message.includes('temporarily unavailable')
    );
  }

  private extractStatusCode(
    error: Error & { statusCode?: number; status?: number; cause?: unknown },
  ): number | null {
    if (typeof error.statusCode === 'number') {
      return error.statusCode;
    }
    if (typeof error.status === 'number') {
      return error.status;
    }
    if (error.cause && typeof error.cause === 'object') {
      const cause = error.cause as { statusCode?: number; status?: number };
      if (typeof cause.statusCode === 'number') {
        return cause.statusCode;
      }
      if (typeof cause.status === 'number') {
        return cause.status;
      }
    }
    return null;
  }

  private extractErrorCode(
    error: Error & { code?: string | number; cause?: unknown },
  ): string {
    const rawCode =
      error.code ??
      (error.cause && typeof error.cause === 'object'
        ? (error.cause as { code?: string | number }).code
        : undefined);

    if (rawCode == null) {
      return '';
    }
    return typeof rawCode === 'string'
      ? rawCode.toUpperCase()
      : String(rawCode).toUpperCase();
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      const cause = error.cause instanceof Error ? ` cause=${error.cause.message}` : '';
      return `${error.message}${cause}`;
    }
    return String(error);
  }

  private async sleep(ms: number, abortSignal: AbortSignal): Promise<void> {
    if (abortSignal.aborted) {
      throw abortSignal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortSignal.reason ?? new DOMException('Aborted', 'AbortError'));
      };

      abortSignal.addEventListener('abort', onAbort, { once: true });
      timer.unref?.();
    });
  }

  /**
   * 发布错误事件并写入 EventBus。
   */
  private publishErrorEvent(
    input: MultiAgentKernelInput,
    layer: StageName,
    message: string,
  ): void {
    const event = input.emitRuntimeEvent({
      type: 'run.error',
      error: `${layer} layer failed: ${message}`,
    });
    this.eventBus.publish(event);
  }
}
