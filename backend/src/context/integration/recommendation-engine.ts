/**
 * BM25 推荐引擎 - 集成 bm25-search.ts
 * 提供设计风格、配色方案、字体推荐的智能搜索
 */

import { RecommendationEngine } from '../../utils/bm25-search.js';
import { Log } from '../../logging/log.js';

const logger = Log.create({ service: 'BM25RecommendationEngine' });

// ============ 类型定义 ============

export interface DesignRecommendations {
  style?: {
    id: string;
    name: string;
    category: string;
    characteristics: string[];
    useCases: string[];
  };
  color?: {
    id: string;
    name: string;
    category: string;
    colors: {
      primary?: string;
      secondary?: string;
      accent?: string;
      neutral?: string;
    };
  };
  typography?: {
    id: string;
    name: string;
    category: string;
    heading: string;
    body: string;
  };
}

export interface RecommendationResult {
  recommendations: DesignRecommendations;
  confidence: {
    style: number;
    color: number;
    typography: number;
    overall: number;
  };
  query: string;
  productType: string;
}

// ============ BM25 推荐引擎包装器 ============

export class BM25RecommendationEngine {
  private engine: RecommendationEngine;
  private initialized: boolean = false;

  constructor(_assetsDir: string = './assets') {
    this.engine = new RecommendationEngine(_assetsDir);
  }

  /**
   * 初始化推荐引擎
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.engine.initialize();
      this.initialized = true;
    } catch (error) {
      logger.error('BM25 推荐引擎初始化失败', { error });
      throw error;
    }
  }

  /**
   * 获取完整设计推荐
   * @param productType 产品类型 (SaaS, E-commerce, Finance, Healthcare, Education, Social, Media, Tools)
   * @param query 搜索查询 (可选)
   * @returns 设计推荐结果
   */
  async getRecommendations(productType: string, query: string = ''): Promise<RecommendationResult> {
    await this.initialize();

    // 使用产品类型作为默认查询
    const searchQuery = query || productType;

    // 获取推荐
    const recommendations = this.engine.getRecommendations(productType, searchQuery);

    // 计算置信度
    const confidence = {
      style: recommendations.style ? 0.85 : 0,
      color: recommendations.color ? 0.8 : 0,
      typography: recommendations.typography ? 0.75 : 0,
      overall: 0,
    };

    const overall = (confidence.style + confidence.color + confidence.typography) / 3;

    confidence.overall = overall;

    return {
      recommendations: {
        style: recommendations.style
          ? {
              id: recommendations.style.id,
              name: recommendations.style.name,
              category: recommendations.style.category,
              characteristics: recommendations.style.characteristics || [],
              useCases: recommendations.style.useCases || [],
            }
          : undefined,
        color: recommendations.color
          ? {
              id: recommendations.color.id,
              name: recommendations.color.name,
              category: recommendations.color.category,
              colors: recommendations.color.colors || {},
            }
          : undefined,
        typography: recommendations.typography
          ? {
              id: recommendations.typography.id,
              name: recommendations.typography.name,
              category: recommendations.typography.category,
              heading: recommendations.typography.heading,
              body: recommendations.typography.body,
            }
          : undefined,
      },
      confidence,
      query: searchQuery,
      productType,
    };
  }

  /**
   * 搜索设计风格
   */
  async searchStyles(
    query: string,
    maxResults: number = 3
  ): Promise<
    Array<{
      style: any;
      score: number;
      confidence: number;
    }>
  > {
    await this.initialize();
    return this.engine['styleSearcher'].searchStyles(query, maxResults);
  }

  /**
   * 搜索配色方案
   */
  async searchPalettes(
    query: string,
    productType?: string,
    maxResults: number = 3
  ): Promise<
    Array<{
      palette: any;
      score: number;
      confidence: number;
    }>
  > {
    await this.initialize();
    return this.engine['colorSearcher'].searchPalettes(query, productType, maxResults);
  }

  /**
   * 搜索字体组合
   */
  async searchTypography(
    query: string,
    productType?: string,
    maxResults: number = 3
  ): Promise<
    Array<{
      pair: any;
      score: number;
      confidence: number;
    }>
  > {
    await this.initialize();
    return this.engine['typographySearcher'].searchTypography(query, productType, maxResults);
  }
}

// ============ 工厂函数 ============

let globalEngine: BM25RecommendationEngine | null = null;

export async function getRecommendationEngine(
  assetsDir: string = './assets'
): Promise<BM25RecommendationEngine> {
  if (!globalEngine) {
    globalEngine = new BM25RecommendationEngine(assetsDir);
    await globalEngine.initialize();
  }
  return globalEngine;
}
