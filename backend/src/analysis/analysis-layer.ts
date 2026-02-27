/**
 * AnalysisLayer - 分析层串行管线
 *
 * 按固定顺序（PM → Architect → UI → UX）串行执行 4 个分析智能体。
 * 每个智能体执行时，将前序所有智能体的 SessionDocument 作为上下文传入。
 * 任一智能体失败时中止后续执行，返回失败信息。
 *
 * 需求: R1.1, R1.2, R1.6, R1.7
 */

import type {
  AnalysisAgent,
  AnalysisContext,
  AnalysisLayerInput,
  AnalysisLayerOutput,
  SessionDocument,
} from './types.js';
import type { LLMClient } from '../llm/client.js';
import type { ProviderID } from '../llm/types.js';
import {
  ProductManagerAgent,
  FrontendArchitectAgent,
  UIExpertAgent,
  UXExpertAgent,
  ANALYSIS_AGENT_ORDER,
} from './agents/index.js';

export interface AnalysisLayerConfig {
  /** LLM 客户端实例 */
  llmClient: LLMClient;
  /** LLM 提供商 */
  provider: ProviderID;
  /** LLM 模型 ID */
  model: string;
  /** 温度参数（可选） */
  temperature?: number;
  /** 最大输出 token 数（可选） */
  maxOutputTokens?: number;
}

export class AnalysisLayer {
  private agents: AnalysisAgent[];
  private llmClient: LLMClient;
  private provider: ProviderID;
  private model: string;
  private temperature?: number;
  private maxOutputTokens?: number;

  constructor(config: AnalysisLayerConfig) {
    this.llmClient = config.llmClient;
    this.provider = config.provider;
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxOutputTokens = config.maxOutputTokens;

    // 固定顺序：PM → Architect → UI → UX
    this.agents = [
      new ProductManagerAgent(),
      new FrontendArchitectAgent(),
      new UIExpertAgent(),
      new UXExpertAgent(),
    ];
  }

  /**
   * 执行分析层管线
   *
   * 按固定顺序串行执行 4 个智能体：
   * 1. 产品需求经理 (PM)
   * 2. 前端架构师 (Architect)
   * 3. UI 专家 (UI)
   * 4. UX 专家 (UX)
   *
   * 每个智能体接收前序所有智能体的 SessionDocument 作为上下文。
   * 任一智能体失败时中止后续执行。
   */
  async run(input: AnalysisLayerInput): Promise<AnalysisLayerOutput> {
    const documents: SessionDocument[] = [];

    for (const agent of this.agents) {
      // 检查是否已取消
      if (input.abortSignal.aborted) {
        return {
          success: false,
          documents,
          failedAgentId: agent.id,
          error: 'Operation aborted',
        };
      }

      // 发送智能体开始事件
      // 使用 agent.task.started 事件类型，agentId 映射到 planner-agent（分析层智能体）
      input.emitRuntimeEvent({
        type: 'agent.task.started',
        agentId: 'planner-agent', // 分析层智能体使用 planner-agent 作为运行时 ID
        taskId: `analysis-${agent.id}`,
        waveId: 'analysis',
        title: agent.title,
        goal: `执行 ${agent.title} 分析`,
      });

      try {
        // 构建上下文
        const context: AnalysisContext = {
          sessionId: input.sessionId,
          userMessage: input.userMessage,
          previousDocuments: [...documents], // 前序所有智能体的输出
          platform: input.platform,
          techStack: input.techStack,
        };

        // 构建 prompt
        const prompt = agent.buildPrompt(context);

        // 调用 LLM
        const response = await this.llmClient.complete({
          provider: this.provider,
          model: this.model,
          systemPrompt: prompt,
          messages: [
            {
              role: 'user',
              content: input.userMessage,
            },
          ],
          temperature: this.temperature,
          maxOutputTokens: this.maxOutputTokens,
          abortSignal: input.abortSignal,
        });

        // 解析输出为 SessionDocument
        const document = agent.parseOutput(response.text);
        documents.push(document);

        // 发送智能体完成事件
        input.emitRuntimeEvent({
          type: 'agent.task.completed',
          agentId: 'planner-agent',
          taskId: `analysis-${agent.id}`,
          waveId: 'analysis',
          success: true,
          summary: `${agent.title} 分析完成，文档 ID: ${document.id}`,
        });
      } catch (error: unknown) {
        // 发送智能体失败事件
        const errorMessage = error instanceof Error ? error.message : String(error);
        input.emitRuntimeEvent({
          type: 'agent.task.completed',
          agentId: 'planner-agent',
          taskId: `analysis-${agent.id}`,
          waveId: 'analysis',
          success: false,
          summary: `${agent.title} 分析失败: ${errorMessage}`,
        });

        // 中止后续执行，返回失败信息
        return {
          success: false,
          documents,
          failedAgentId: agent.id,
          error: errorMessage,
        };
      }
    }

    // 验证产出恰好 4 份文档
    if (documents.length !== ANALYSIS_AGENT_ORDER.length) {
      return {
        success: false,
        documents,
        error: `Expected ${ANALYSIS_AGENT_ORDER.length} documents, got ${documents.length}`,
      };
    }

    return {
      success: true,
      documents,
    };
  }

  /**
   * 获取智能体列表（用于测试）
   */
  getAgents(): readonly AnalysisAgent[] {
    return this.agents;
  }
}
