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
  FrontendArchitectDocument,
  ProductManagerDocument,
  SessionDocument,
  UIExpertDocument,
  UXExpertDocument,
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

const DEFAULT_ANALYSIS_AGENT_TIMEOUT_MS = 240_000;
const MIN_ANALYSIS_AGENT_TIMEOUT_MS = 30_000;
const MAX_ANALYSIS_AGENT_TIMEOUT_MS = 600_000;

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
  /** 单个分析智能体调用超时（毫秒，可选） */
  agentTimeoutMs?: number;
}

export class AnalysisLayer {
  private agents: AnalysisAgent[];
  private llmClient: LLMClient;
  private provider: ProviderID;
  private model: string;
  private temperature?: number;
  private maxOutputTokens?: number;
  private agentTimeoutMs: number;

  constructor(config: AnalysisLayerConfig) {
    this.llmClient = config.llmClient;
    this.provider = config.provider;
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxOutputTokens = config.maxOutputTokens ?? this.resolveMaxOutputTokens();
    this.agentTimeoutMs =
      config.agentTimeoutMs ?? this.resolveAgentTimeoutMs();

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
      const agentStartedAt = Date.now();
      let latestResponseText = '';
      const context: AnalysisContext = {
        sessionId: input.sessionId,
        userMessage: input.userMessage,
        previousDocuments: [...documents],
        platform: input.platform,
        techStack: input.techStack,
      };
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
        // 构建 prompt
        const prompt = agent.buildPrompt(context);
        console.log(
          `[AnalysisLayer] session=${input.sessionId} agent=${agent.id} title=${agent.title} start provider=${this.provider} model=${this.model} promptChars=${prompt.length} docs=${documents.length}`,
        );

        // 调用 LLM
        const response = await this.completeAgentWithRetry(
          input,
          agent,
          prompt,
        );
        latestResponseText = response.text;
        console.log(
          `[AnalysisLayer] session=${input.sessionId} agent=${agent.id} title=${agent.title} completed durationMs=${Date.now() - agentStartedAt} responseChars=${response.text.length}`,
        );

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
        const errorMessage = this.buildErrorDetails(error);
        console.error(
          `[AnalysisLayer] session=${input.sessionId} agent=${agent.id} title=${agent.title} failed durationMs=${Date.now() - agentStartedAt} error=${errorMessage}`,
        );
        if (latestResponseText) {
          console.error(
            `[AnalysisLayer] session=${input.sessionId} agent=${agent.id} rawPreview=${this.buildResponsePreview(latestResponseText)}`,
          );
        }

        const canRecoverWithFallback =
          !input.abortSignal.aborted &&
          this.isTransientAgentFailure(error);
        if (canRecoverWithFallback) {
          const fallbackDocument = this.buildFallbackDocument(agent, context, documents);
          documents.push(fallbackDocument);
          console.warn(
            `[AnalysisLayer] session=${input.sessionId} agent=${agent.id} fallback-document id=${fallbackDocument.id}`,
          );
          input.emitRuntimeEvent({
            type: 'agent.task.completed',
            agentId: 'planner-agent',
            taskId: `analysis-${agent.id}`,
            waveId: 'analysis',
            success: true,
            summary: `${agent.title} 分析超时，已生成降级文档 ID: ${fallbackDocument.id}`,
          });
          continue;
        }
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

  private buildResponsePreview(text: string): string {
    const compact = text
      .slice(0, 2000)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return JSON.stringify(compact);
  }

  private buildErrorDetails(error: unknown): string {
    if (!(error instanceof Error)) {
      return String(error);
    }
    const details = error as Error & {
      code?: string | number;
      status?: number;
      statusCode?: number;
      cause?: unknown;
    };
    const parts = [`${details.name}: ${details.message}`];
    if (details.code !== undefined) {
      parts.push(`code=${String(details.code)}`);
    }
    if (details.statusCode !== undefined) {
      parts.push(`statusCode=${details.statusCode}`);
    }
    if (details.status !== undefined) {
      parts.push(`status=${details.status}`);
    }
    if (details.cause && typeof details.cause === 'object') {
      const causeRecord = details.cause as { code?: string; message?: string };
      if (causeRecord.code) {
        parts.push(`causeCode=${causeRecord.code}`);
      }
      if (causeRecord.message) {
        parts.push(`causeMessage=${causeRecord.message}`);
      }
    }
    return parts.join(' | ');
  }

  private async completeAgentWithRetry(
    input: AnalysisLayerInput,
    agent: AnalysisAgent,
    prompt: string,
  ) {
    const maxAttempts = 2;
    const retryStartedAt = Date.now();
    let previousAttemptTimedOut = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const elapsedMs = Date.now() - retryStartedAt;
        const remainingBudgetMs = this.agentTimeoutMs - elapsedMs;
        if (remainingBudgetMs <= 0) {
          const timeoutError = new Error(
            `Analysis agent request timed out after ${this.agentTimeoutMs}ms`,
          ) as Error & { name: string };
          timeoutError.name = 'TimeoutError';
          throw timeoutError;
        }
        const remainingAttempts = maxAttempts - attempt + 1;
        const plannedAttemptBudgetMs = Math.max(
          Math.floor(remainingBudgetMs / remainingAttempts),
          MIN_ANALYSIS_AGENT_TIMEOUT_MS,
        );
        const timeoutBudgetMs = Math.min(remainingBudgetMs, plannedAttemptBudgetMs);
        const attemptTimeoutMs =
          previousAttemptTimedOut && attempt > 1
            ? Math.min(timeoutBudgetMs, 30_000)
            : timeoutBudgetMs;
        const hardTimeoutMs = attemptTimeoutMs + 5_000;
        return await this.withHardTimeout(
          this.llmClient.completeStreaming({
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
            abortSignal: this.createAgentAbortSignal(
              input.abortSignal,
              attemptTimeoutMs,
            ),
          }),
          hardTimeoutMs,
          `Analysis agent request hard timed out after ${hardTimeoutMs}ms`,
        );
      } catch (error: unknown) {
        const shouldRetry =
          attempt < maxAttempts &&
          !input.abortSignal.aborted &&
          this.isTransientAgentFailure(error);
        if (shouldRetry) {
          previousAttemptTimedOut = error instanceof Error && error.name === 'TimeoutError';
          console.warn(
            `[AnalysisLayer] session=${input.sessionId} agent=${agent.id} transient-error retry=${attempt + 1}/${maxAttempts} error=${this.buildErrorDetails(error)}`,
          );
          continue;
        }
        throw error;
      }
    }
    throw new Error('Analysis agent completion exhausted attempts');
  }

  private isTransientAgentFailure(error: unknown): boolean {
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

  private resolveMaxOutputTokens(): number {
    const tokens = Number(process.env.ANALYSIS_MAX_OUTPUT_TOKENS ?? 3072);
    if (!Number.isFinite(tokens) || tokens <= 0) {
      return 3072;
    }
    return Math.min(Math.max(Math.floor(tokens), 512), 4096);
  }

  private resolveAgentTimeoutMs(): number {
    const timeoutMs = Number(
      process.env.ANALYSIS_AGENT_TIMEOUT_MS ?? DEFAULT_ANALYSIS_AGENT_TIMEOUT_MS,
    );
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return DEFAULT_ANALYSIS_AGENT_TIMEOUT_MS;
    }
    return Math.min(
      Math.max(Math.floor(timeoutMs), MIN_ANALYSIS_AGENT_TIMEOUT_MS),
      MAX_ANALYSIS_AGENT_TIMEOUT_MS,
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

  private buildFallbackDocument(
    agent: AnalysisAgent,
    context: AnalysisContext,
    existingDocuments: SessionDocument[],
  ): SessionDocument {
    const now = Date.now();
    const id = `fallback-${agent.id}-${now}-${Math.random().toString(36).slice(2, 8)}`;

    if (agent.id === 'product-manager') {
      const objective = context.userMessage.trim() || '核心业务流程';
      const document: ProductManagerDocument = {
        id,
        agentId: 'product-manager',
        createdAt: now,
        version: 1,
        content: {
          functionalRequirements: [
            {
              id: 'FR-001',
              title: '主流程看板',
              description: `围绕“${objective}”建立可操作的主流程总览与状态追踪能力`,
              priority: 'high',
            },
            {
              id: 'FR-002',
              title: '实体详情与编辑',
              description: '提供实体详情查看、编辑提交、字段校验与回滚反馈',
              priority: 'high',
            },
            {
              id: 'FR-003',
              title: '检索筛选与批量操作',
              description: '支持多条件筛选、关键字检索、批量动作与结果反馈',
              priority: 'medium',
            },
            {
              id: 'FR-004',
              title: '异常与空态处理',
              description: '覆盖加载、空数据、错误和恢复路径，保障端到端可用性',
              priority: 'medium',
            },
          ],
          userStories: [
            {
              id: 'US-001',
              persona: '运营人员',
              goal: '快速定位关键任务并执行处理',
              benefit: '缩短任务处理时长并降低漏处理风险',
            },
            {
              id: 'US-002',
              persona: '管理者',
              goal: '查看过程指标并跟踪异常处理状态',
              benefit: '提高决策效率与协作透明度',
            },
          ],
          priorityOrder: ['FR-001', 'FR-002', 'FR-003', 'FR-004'],
        },
      };
      return document;
    }

    if (agent.id === 'frontend-architect') {
      const pmDoc = existingDocuments.find(
        (doc): doc is ProductManagerDocument => doc.agentId === 'product-manager',
      );
      const requirements = pmDoc?.content.functionalRequirements ?? [];
      const routeSeeds = (requirements.length > 0 ? requirements : [
        { id: 'FR-001', title: 'Primary Flow', description: '', priority: 'high' as const },
        { id: 'FR-002', title: 'Secondary Flow', description: '', priority: 'medium' as const },
      ]).slice(0, 4);
      const routeDesign = routeSeeds.map((req, index) => {
        const slug = this.toRouteSlug(req.title, index);
        return {
          path: index === 0 ? '/' : `/${slug}`,
          componentId: `page-${index + 1}`,
        };
      });
      const componentTree = [
        {
          id: 'layout-app-shell',
          name: 'AppShell',
          type: 'layout' as const,
          children: routeDesign.map(route => route.componentId),
        },
        ...routeDesign.map((route, index) => ({
          id: route.componentId,
          name: `${routeSeeds[index]?.title?.trim() || `Page${index + 1}`}Page`,
          type: 'page' as const,
          children: [`panel-${index + 1}`],
        })),
        ...routeDesign.map((_, index) => ({
          id: `panel-${index + 1}`,
          name: `${routeSeeds[index]?.title?.trim() || `Panel${index + 1}`}Panel`,
          type: 'component' as const,
          children: [],
        })),
      ];
      const document: FrontendArchitectDocument = {
        id,
        agentId: 'frontend-architect',
        createdAt: now,
        version: 1,
        content: {
          componentTree,
          routeDesign,
          stateManagement: {
            approach: 'zustand',
            stores: routeDesign.map((route, index) => ({
              name: `${(routeSeeds[index]?.id || `page-${index + 1}`)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '')}Store`,
              description: `Manage state for ${routeSeeds[index]?.title || route.path}`,
              fields: {
                records: 'Array<Record<string, unknown>>',
                loading: 'boolean',
                error: 'string | null',
              },
            })),
          },
        },
      };
      return document;
    }

    if (agent.id === 'ui-expert') {
      const architectDoc = existingDocuments.find(
        (doc): doc is FrontendArchitectDocument => doc.agentId === 'frontend-architect',
      );
      const componentIds =
        architectDoc?.content.componentTree
          .filter(component => component.type === 'page' || component.type === 'component')
          .slice(0, 6)
          .map(component => component.id) ?? [];
      const document: UIExpertDocument = {
        id,
        agentId: 'ui-expert',
        createdAt: now,
        version: 1,
        content: {
          visualSpec: {
            colorScheme: 'light',
            typography: { heading: 'Manrope', body: 'IBM Plex Sans' },
            spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
            borderRadius: '12px',
          },
          componentStyles: (componentIds.length > 0 ? componentIds : ['fallback-panel']).map(componentId => ({
            componentId,
            styles: {
              backgroundColor: '#ffffff',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid #E5E7EB',
            },
          })),
          responsiveLayout: {
            breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280 },
            strategy: 'mobile-first',
          },
        },
      };
      return document;
    }

    const pmDoc = existingDocuments.find(
      (doc): doc is ProductManagerDocument => doc.agentId === 'product-manager',
    );
    const requirementTitles = (pmDoc?.content.functionalRequirements ?? [])
      .slice(0, 3)
      .map(req => req.title);
    const titles = requirementTitles.length > 0
      ? requirementTitles
      : ['Primary Flow', 'Validation Flow', 'Recovery Flow'];
    const document: UXExpertDocument = {
      id,
      agentId: 'ux-expert',
      createdAt: now,
      version: 1,
      content: {
        interactionFlows: titles.map((title, index) => ({
          id: `flow-${String(index + 1).padStart(3, '0')}`,
          name: `${title} Flow`,
          steps: [
            {
              action: `进入 ${title} 页面并输入筛选条件`,
              expectedResult: '页面展示实时筛选结果并保留输入上下文',
              errorHandling: '输入非法时展示字段级错误提示并阻止提交',
            },
            {
              action: `提交 ${title} 关键操作`,
              expectedResult: '展示加载、成功、失败三态反馈并刷新数据',
              errorHandling: '提交失败时提供重试并保留用户已填内容',
            },
          ],
        })),
        userJourneys: [
          {
            id: 'journey-001',
            persona: '一线操作员',
            touchpoints: ['流程总览', '详情处理', '结果确认'],
            painPoints: ['批量处理反馈不清晰', '异常恢复路径不统一'],
          },
        ],
        usabilityRecommendations: [
          {
            area: '反馈机制',
            recommendation: '关键操作统一提供可见的加载、完成与错误态组件',
            priority: 'high',
          },
          {
            area: '空态与异常态',
            recommendation: '为空列表和异常失败提供下一步可执行指引',
            priority: 'medium',
          },
        ],
      },
    };
    return document;
  }

  private toRouteSlug(title: string, index: number): string {
    const normalized = title
      .trim()
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
    if (normalized.length === 0) {
      return `step-${index + 1}`;
    }
    return normalized;
  }

  private createAgentAbortSignal(parentSignal: AbortSignal, timeoutMs = this.agentTimeoutMs): AbortSignal {
    if (timeoutMs <= 0) {
      return parentSignal;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      const timeoutError = new Error(
        `Analysis agent request timed out after ${timeoutMs}ms`,
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
}
