/**
 * ThreeLayerOrchestrator — 三层架构编排器
 *
 * Orchestrates the three-layer pipeline:
 *   Analysis_Layer → Planning_Layer → Execution_Layer
 *
 * Each layer's output is stored to the Blackboard before the next layer runs.
 * Progress events are emitted via RuntimeEvent at each stage transition.
 * Errors at any layer are caught, reported via events, and re-thrown.
 *
 * 需求: R10.1, R10.2, R10.3
 */

import type { AnalysisLayer } from '../analysis/analysis-layer.js';
import type { PlanningLayer } from '../planning/planning-layer.js';
import type { ExecutionLayer } from '../execution/execution-layer.js';
import type { MultiAgentBlackboard } from '../runtime/multi-agent/blackboard.js';
import type { MultiAgentEventBus } from '../runtime/multi-agent/event-bus.js';
import type { MultiAgentKernelInput } from '../runtime/multi-agent/types.js';

export class ThreeLayerOrchestrator {
  constructor(
    private readonly analysisLayer: AnalysisLayer,
    private readonly planningLayer: PlanningLayer,
    private readonly executionLayer: ExecutionLayer,
    private readonly blackboard: MultiAgentBlackboard,
    private readonly eventBus: MultiAgentEventBus,
  ) {}

  /**
   * Run the full three-layer pipeline.
   *
   * 1. Analysis_Layer.run → store SessionDocuments to Blackboard
   * 2. Planning_Layer.run → store ExecutionPlan to Blackboard
   * 3. Execution_Layer.run → execute the plan
   *
   * Progress events are published to the EventBus at each stage boundary.
   * If any layer fails, an error event is published and the error is re-thrown.
   */
  async run(input: MultiAgentKernelInput): Promise<void> {
    const { emitRuntimeEvent } = input;

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
      analysisOutput = await this.analysisLayer.run({
        sessionId: input.sessionId,
        userMessage: input.userMessage,
        platform: input.platform,
        techStack: input.techStack,
        abortSignal: input.abortSignal,
        emitRuntimeEvent,
      });
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

    // Store analysis documents to Blackboard
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
      executionPlan = await this.planningLayer.run({
        sessionId: input.sessionId,
        documents: analysisOutput.documents,
        abortSignal: input.abortSignal,
        emitRuntimeEvent,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.publishErrorEvent(input, 'planning', message);
      throw error;
    }

    // Store execution plan to Blackboard
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
      executionOutput = await this.executionLayer.run({
        sessionId: input.sessionId,
        runId: input.runId,
        plan: executionPlan,
        userMessage: input.userMessage,
        platform: input.platform,
        techStack: input.techStack,
        abortSignal: input.abortSignal,
        emitRuntimeEvent,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.publishErrorEvent(input, 'execution', message);
      throw error;
    }

    // Emit completion event
    emitRuntimeEvent({
      type: 'agent.task.completed',
      agentId: 'scaffold-agent',
      taskId: 'orchestrator-execution',
      waveId: 'orchestration',
      success: executionOutput.success,
      summary: executionOutput.success
        ? `执行层完成，修改 ${executionOutput.touchedFiles.length} 个文件`
        : `执行层降级完成，${executionOutput.unresolvedIssues.length} 个未解决问题`,
    });

    // If execution had unresolved issues but didn't throw, we still report
    // completion — the degraded state is captured in the output events above.
    if (!executionOutput.success) {
      emitRuntimeEvent({
        type: 'run.error',
        error: `Execution completed with issues: ${executionOutput.unresolvedIssues.join('; ')}`,
      });
    }
  }

  /**
   * Publish an error event for a failed layer and record it on the EventBus.
   */
  private publishErrorEvent(
    input: MultiAgentKernelInput,
    layer: 'analysis' | 'planning' | 'execution',
    message: string,
  ): void {
    const event = input.emitRuntimeEvent({
      type: 'run.error',
      error: `${layer} layer failed: ${message}`,
    });
    this.eventBus.publish(event);
  }
}
