/**
 * 智能上下文构建器 - 完整集成版本
 * 整合所有功能：模式路由、BM25 推荐、设计系统、上下文管理
 */

import { ContextManager } from '../manager.js';
import { ModeRouter, ModeRouteResult, AnalysisResult } from './mode-router.js';
import { BM25RecommendationEngine } from './recommendation-engine.js';
import { DesignSystemManager } from './design-system.js';
import type {
  ContextBuildRequest as ContextRequest,
  BuiltContext as ContextResult,
} from '../../types/index.js';
import { Log } from '../../logging/log.js';

const logger = Log.create({ service: 'SmartBuilder' });

// ============ 类型定义 ============

export interface SmartBuildRequest extends Partial<ContextRequest> {
  userInput: string;
  sessionID?: string;
  // 以下为可选，系统会自动检测
  mode?: 'creator' | 'implementer';
  techStack?: string[];
  platform?: string;
  maxTokens?: number;
}

// 重新定义 RecommendationResult 以避免导入问题
export interface RecommendationResult {
  recommendations: any;
  confidence: {
    style: number;
    color: number;
    typography: number;
    overall: number;
  };
  query: string;
  productType: string;
}

export interface SmartBuildResult extends ContextResult {
  // 模式路由信息
  routing?: {
    mode: 'creator' | 'implementer';
    confidence: number;
    reason: string;
    score?: number;
    version?: string;
    language?: 'zh' | 'en' | 'mixed' | 'unknown';
    techSignals?: string[];
    analysis: AnalysisResult;
  };
  // 设计推荐信息
  recommendations?: RecommendationResult;
  // 产品类型信息
  productType?: string;
  // 扩展metadata以包含额外属性
  metadata: ContextResult['metadata'] & {
    smartBuild?: boolean;
  };
}

export interface SmartBuilderConfig {
  sectionsDir?: string;
  assetsDir?: string;
  modeThreshold?: number;
  enableCache?: boolean;
  autoRecommend?: boolean; // 是否自动推荐设计
}

export interface PromptContextResolutionRequest {
  userInput: string;
  mode?: 'creator' | 'implementer';
  techStack?: string[];
  platform?: string;
}

export interface PromptContextResolution {
  mode: 'creator' | 'implementer';
  platform: string;
  techStack: string[];
  sources: {
    mode: 'request' | 'smart-context';
    platform: 'request' | 'smart-context' | 'default';
    techStack: 'request' | 'smart-context' | 'default';
  };
  routing: {
    confidence: number;
    reason: string;
    score?: number;
    version?: string;
    language?: 'zh' | 'en' | 'mixed' | 'unknown';
    techSignals?: string[];
    analysis: AnalysisResult;
  };
}

// ============ 智能上下文构建器 ============

export class SmartContextBuilder {
  private contextManager: ContextManager;
  private modeRouter: ModeRouter;
  private recommendationEngine: BM25RecommendationEngine;
  private designSystem: DesignSystemManager;
  private config: Required<SmartBuilderConfig>;

  constructor(config: SmartBuilderConfig = {}) {
    this.config = {
      sectionsDir: config.sectionsDir || './prompt-docs',
      assetsDir: config.assetsDir || './assets',
      modeThreshold: config.modeThreshold || 40,
      enableCache: config.enableCache ?? true,
      autoRecommend: config.autoRecommend ?? true,
    };

    // 初始化各组件
    this.contextManager = new ContextManager({
      sectionsDir: this.config.sectionsDir,
      mode: 'lazy',
      enableCache: this.config.enableCache,
    });

    this.modeRouter = new ModeRouter({
      threshold: this.config.modeThreshold,
    });

    this.recommendationEngine = new BM25RecommendationEngine(this.config.assetsDir);

    this.designSystem = new DesignSystemManager(this.config.assetsDir);
  }

  /**
   * 智能构建上下文 - 完整集成版
   */
  async build(request: SmartBuildRequest): Promise<SmartBuildResult> {
    const startTime = Date.now();

    // 1. 模式路由（自动检测或使用用户指定的）
    const routing = this.detectOrUseMode(request);

    // 2. 提取产品类型
    const productType = this.extractProductType(routing);

    // 3. 获取设计推荐（如果启用）
    let recommendations: RecommendationResult | undefined;
    if (this.config.autoRecommend && productType) {
      try {
        recommendations = await this.recommendationEngine.getRecommendations(
          productType,
          request.userInput
        );
      } catch (error) {
        logger.warn('设计推荐失败，继续使用默认配置', { error });
      }
    }

    // 4. 构建上下文
    const contextResult = await this.contextManager.buildContext({
      sessionID: request.sessionID || 'smart-session-' + Date.now(),
      userInput: request.userInput,
      mode: routing.mode,
      techStack: request.techStack || this.extractTechStack(routing),
      platform: request.platform || this.extractPlatform(routing),
      maxTokens: request.maxTokens || 180000,
    });

    // 5. 组装结果
    const buildTime = Date.now() - startTime;

    return {
      ...contextResult,
      routing: {
        mode: routing.mode,
        confidence: routing.confidence,
        reason: routing.reason,
        score: routing.score,
        version: routing.version,
        language: routing.language,
        techSignals: routing.techSignals,
        analysis: routing.analysis,
      },
      recommendations,
      productType,
      metadata: {
        ...contextResult.metadata,
        buildTime,
        smartBuild: true,
      },
    };
  }

  /**
   * 轻量解析 prompt 上下文（不触发完整上下文构建）
   */
  resolvePromptContext(request: PromptContextResolutionRequest): PromptContextResolution {
    const routing = this.detectOrUseMode(request);
    const detectedTech = routing.analysis.extractedTechStack;
    const resolvedTechStack = request.techStack?.length
      ? request.techStack
      : this.extractTechStack(routing);
    const resolvedPlatform = request.platform || this.extractPlatform(routing);

    return {
      mode: request.mode || routing.mode,
      platform: resolvedPlatform,
      techStack: resolvedTechStack,
      sources: {
        mode: request.mode ? 'request' : 'smart-context',
        platform: request.platform
          ? 'request'
          : detectedTech?.platform
            ? 'smart-context'
            : 'default',
        techStack: request.techStack?.length
          ? 'request'
          : detectedTech?.framework ||
              detectedTech?.uiLibrary ||
              detectedTech?.styling ||
              (routing.techSignals?.length || 0) > 0
            ? 'smart-context'
            : 'default',
      },
      routing: {
        confidence: routing.confidence,
        reason: routing.reason,
        score: routing.score,
        version: routing.version,
        language: routing.language,
        techSignals: routing.techSignals,
        analysis: routing.analysis,
      },
    };
  }

  /**
   * 检测模式或使用用户指定的
   */
  private detectOrUseMode(request: SmartBuildRequest): ModeRouteResult {
    if (request.mode) {
      // 用户指定模式，但仍做评分分析用于诊断。
      const detected = this.modeRouter.detect(request.userInput);

      return {
        mode: request.mode,
        analysis: detected.analysis,
        confidence: 1.0,
        score: detected.score,
        version: detected.version,
        language: detected.language,
        techSignals: detected.techSignals,
        reason: `用户明确指定使用 ${request.mode} 模式 (检测评分: ${detected.analysis.modeDetection.score.toFixed(1)})`,
      };
    }

    // 自动检测
    return this.modeRouter.detect(request.userInput);
  }

  /**
   * 提取产品类型
   */
  private extractProductType(routing: ModeRouteResult): string | undefined {
    const productType = routing.analysis.productType;

    if (!productType) {
      return undefined;
    }

    return productType.type;
  }

  /**
   * 提取技术栈
   */
  private extractTechStack(routing: ModeRouteResult): string[] {
    const fromRoutingSignals = routing.techSignals || [];
    if (fromRoutingSignals.length > 0) {
      const aliasMap: Record<string, string> = {
        nextjs: 'nextjs',
        react: 'react',
        vue: 'vue',
        angular: 'angular',
        svelte: 'svelte',
        nuxt: 'nuxt',
        shadcn: 'shadcn/ui',
        tailwind: 'tailwind css',
        'react-native': 'react-native',
        uniapp: 'uniapp',
        electron: 'electron',
      };

      const normalized = fromRoutingSignals
        .map(signal => aliasMap[signal.toLowerCase()] || signal.toLowerCase())
        .filter(Boolean);

      if (normalized.length > 0) {
        return [...new Set(normalized)];
      }
    }

    const techStack = routing.analysis.extractedTechStack;

    if (!techStack) {
      return ['react'];
    }

    const result: string[] = [];
    if (techStack.framework) result.push(techStack.framework);
    if (techStack.uiLibrary) result.push(techStack.uiLibrary);
    if (techStack.styling) result.push(techStack.styling);

    return result.length > 0 ? result : ['react'];
  }

  /**
   * 提取平台
   */
  private extractPlatform(routing: ModeRouteResult): string {
    const techStack = routing.analysis.extractedTechStack;

    if (techStack?.platform) {
      return techStack.platform;
    }

    const signalText = (routing.techSignals || []).join(' ').toLowerCase();
    if (signalText.includes('react-native') || signalText.includes('mobile')) {
      return 'mobile';
    }
    if (signalText.includes('uniapp') || signalText.includes('miniprogram')) {
      return 'miniprogram';
    }
    if (signalText.includes('electron') || signalText.includes('desktop')) {
      return 'desktop';
    }

    // 基于技术栈推断平台
    const techStackList = this.extractTechStack(routing);
    if (
      techStackList.some(
        t => t.toLowerCase().includes('react-native') || t.toLowerCase().includes('flutter')
      )
    ) {
      return 'mobile';
    }

    if (
      techStackList.some(
        t => t.toLowerCase().includes('uniapp') || t.toLowerCase().includes('miniprogram')
      )
    ) {
      return 'miniprogram';
    }

    if (
      techStackList.some(
        t => t.toLowerCase().includes('electron') || t.toLowerCase().includes('tauri')
      )
    ) {
      return 'desktop';
    }

    return 'web';
  }

  /**
   * 批量构建
   */
  async buildBatch(requests: SmartBuildRequest[]): Promise<SmartBuildResult[]> {
    return Promise.all(requests.map(req => this.build(req)));
  }

  /**
   * 获取性能统计
   */
  getStats() {
    return {
      context: this.contextManager.getPerformanceStats(),
      design: this.designSystem.getStats(),
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.contextManager.clearCache();
  }
}

// ============ 工厂函数 ============

let globalBuilder: SmartContextBuilder | null = null;

export function createSmartBuilder(config?: SmartBuilderConfig): SmartContextBuilder {
  return new SmartContextBuilder(config);
}

export async function getSmartBuilder(config?: SmartBuilderConfig): Promise<SmartContextBuilder> {
  if (!globalBuilder) {
    globalBuilder = new SmartContextBuilder(config);
    // 预加载设计数据
    try {
      await globalBuilder['designSystem'].load();
    } catch (error) {
      logger.warn('预加载设计数据失败', { error });
    }
  }
  return globalBuilder;
}
