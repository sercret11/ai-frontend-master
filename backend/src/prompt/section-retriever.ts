/**
 * Intelligent Section Retriever - 智能 Section 检索器
 *
 * 基于上下文智能选择相关的 sections，遵守 token 预算
 * 从 60K tokens 的 sections 减少到 3-5K tokens
 */

import { SectionLoader } from './section-loader.js';
import { SECTION_INDEX, getSectionsByPriority, getSectionsByMode, getSectionsByTechStack } from './section-index.js';
import { estimateTokenCount } from './token-estimator.js';
import { Log } from '../logging/log.js';
import type { PromptSection } from '@ai-frontend/shared-types';

const log = Log.create({ service: 'section-retriever' });

/**
 * 检索选项
 */
export interface RetrievalOptions {
  /** Creator 或 Implementer 模式 */
  mode: 'creator' | 'implementer';
  /** 目标平台 */
  platform?: 'web' | 'mobile' | 'desktop' | 'miniprogram';
  /** 技术栈（如 ['react', 'nextjs', 'shadcn']） */
  techStack?: string[];
  /** 用户查询（用于相关性匹配） */
  userQuery?: string;
  /** 最大 token 预算 */
  maxTokens?: number;
}

/**
 * 检索结果
 */
export interface RetrievalResult {
  /** 选中的 sections */
  sections: PromptSection[];
  /** 选中的 section IDs */
  selectedIds: string[];
  /** 被排除的 section IDs（在预算内无法包含） */
  excludedIds: string[];
  /** 预算口径 token 总数（用于预算判断） */
  budgetTotalTokens: number;
  /** 选中 section 的真实测量 token 总数 */
  totalTokens: number;
  /** 静态索引估算 token 总数 */
  estimatedTotalTokens: number;
  /** 运行时测量 token 总数 */
  measuredTotalTokens: number;
  /** 运行时漂移比 measured/estimated */
  tokenDriftRatio: number;
  /** 选择详情（用于日志） */
  selectionDetails: {
    p0Count: number;
    p1Count: number;
    p2Count: number;
    p3Count: number;
  };
}

/**
 * Section 检索器类
 */
export class SectionRetriever {
  private sectionLoader: SectionLoader;

  constructor(sectionLoader?: SectionLoader) {
    this.sectionLoader = sectionLoader || new SectionLoader();
  }

  /**
   * 智能检索 sections
   */
  async retrieve(options: RetrievalOptions): Promise<RetrievalResult> {
    const maxTokens = options.maxTokens || 6000;
    const selectedIds: string[] = [];
    const excludedIds: string[] = [];
    const loadedSections = new Map<string, PromptSection>();

    let estimatedTotalTokens = 0;
    let measuredTotalTokens = 0;
    let budgetTotalTokens = 0;

    const selectionDetails = {
      p0Count: 0,
      p1Count: 0,
      p2Count: 0,
      p3Count: 0,
    };

    log.info('Starting section retrieval', {
      mode: options.mode,
      platform: options.platform,
      techStack: options.techStack,
      userQuery: options.userQuery,
      maxTokens,
    });

    const priorityToCountKey = (
      priority: 'P0' | 'P1' | 'P2' | 'P3'
    ): 'p0Count' | 'p1Count' | 'p2Count' | 'p3Count' => {
      if (priority === 'P0') return 'p0Count';
      if (priority === 'P1') return 'p1Count';
      if (priority === 'P2') return 'p2Count';
      return 'p3Count';
    };

    const trySelect = async (metadata: typeof SECTION_INDEX[keyof typeof SECTION_INDEX]): Promise<void> => {
      if (selectedIds.includes(metadata.id) || excludedIds.includes(metadata.id)) {
        return;
      }

      let dependencyIds: string[];
      try {
        dependencyIds = this.resolveDependencies(metadata.id);
      } catch (error) {
        log.warn('Failed to resolve section dependencies', { sectionId: metadata.id, error });
        excludedIds.push(metadata.id);
        return;
      }
      const candidateIds = [...dependencyIds, metadata.id].filter(
        id => !selectedIds.includes(id) && !excludedIds.includes(id)
      );

      const candidates: Array<{
        id: string;
        metadata: typeof SECTION_INDEX[keyof typeof SECTION_INDEX];
        section: PromptSection;
        measured: number;
      }> = [];

      for (const id of candidateIds) {
        const candidateMetadata = SECTION_INDEX[id];
        if (!candidateMetadata) {
          excludedIds.push(metadata.id);
          return;
        }

        const section = await this.sectionLoader.loadSection(id);
        if (!section) {
          excludedIds.push(metadata.id);
          return;
        }

        const measured = estimateTokenCount(section.content);
        candidates.push({ id, metadata: candidateMetadata, section, measured });
      }

      const requiredBudget = candidates.reduce((sum, item) => sum + item.measured, 0);
      if (budgetTotalTokens + requiredBudget > maxTokens) {
        excludedIds.push(metadata.id);
        return;
      }

      for (const item of candidates) {
        selectedIds.push(item.id);
        loadedSections.set(item.id, item.section);
        estimatedTotalTokens += item.metadata.estimatedTokens;
        measuredTotalTokens += item.measured;
        budgetTotalTokens += item.measured;
        selectionDetails[priorityToCountKey(item.metadata.priority)] += 1;
      }
    };

    // Step 1: always attempt P0 core sections first.
    const p0Sections = getSectionsByPriority('P0').filter(s => this.isApplicable(s, options));
    for (const metadata of p0Sections) {
      await trySelect(metadata);
    }

    log.debug('P0 sections loaded', {
      count: selectionDetails.p0Count,
      measuredTotalTokens,
      estimatedTotalTokens,
      budgetTotalTokens,
    });

    // Step 2: mode-specific P1 sections.
    const modeSections = getSectionsByMode(options.mode)
      .filter(s => s.priority === 'P1')
      .filter(s => !selectedIds.includes(s.id))
      .filter(s => this.isApplicable(s, options));

    for (const metadata of modeSections) {
      await trySelect(metadata);
    }

    log.debug('Mode-specific P1 sections loaded', {
      count: selectionDetails.p1Count,
      measuredTotalTokens,
      estimatedTotalTokens,
      budgetTotalTokens,
    });

    // Step 3: tech-stack specific sections.
    if (options.techStack && options.techStack.length > 0) {
      for (const tech of options.techStack) {
        const techSections = getSectionsByTechStack(tech)
          .filter(s => !selectedIds.includes(s.id))
          .filter(s => this.isApplicable(s, options));

        for (const metadata of techSections) {
          await trySelect(metadata);
        }
      }

      log.debug('Tech-stack sections loaded', {
        measuredTotalTokens,
        estimatedTotalTokens,
        budgetTotalTokens,
      });
    }

    // Step 4: query relevance sections.
    if (options.userQuery) {
      const relevantSections = this.getSectionsByQuery(options.userQuery)
        .filter(s => !selectedIds.includes(s.id))
        .filter(s => this.isApplicable(s, options));

      for (const metadata of relevantSections) {
        await trySelect(metadata);
      }

      log.debug('Query-relevant sections loaded', {
        measuredTotalTokens,
        estimatedTotalTokens,
        budgetTotalTokens,
      });
    }

    // Step 5: mark all remaining applicable sections as excluded.
    for (const [id, metadata] of Object.entries(SECTION_INDEX)) {
      if (!selectedIds.includes(id) && !excludedIds.includes(id) && this.isApplicable(metadata, options)) {
        excludedIds.push(id);
      }
    }

    const sections = selectedIds
      .map(id => loadedSections.get(id))
      .filter((section): section is PromptSection => Boolean(section));

    const tokenDriftRatio =
      estimatedTotalTokens > 0 ? Number((measuredTotalTokens / estimatedTotalTokens).toFixed(2)) : 1;

    log.info('Section retrieval complete', {
      selectedCount: selectedIds.length,
      excludedCount: excludedIds.length,
      estimatedTotalTokens,
      measuredTotalTokens,
      budgetTotalTokens,
      tokenDriftRatio,
      selectionDetails,
    });

    return {
      sections,
      selectedIds,
      excludedIds,
      budgetTotalTokens,
      totalTokens: measuredTotalTokens,
      estimatedTotalTokens,
      measuredTotalTokens,
      tokenDriftRatio,
      selectionDetails,
    };
  }

  /**
   * 根据用户查询获取相关 sections
   */
  private getSectionsByQuery(query: string): typeof SECTION_INDEX[keyof typeof SECTION_INDEX][] {
    const keywords = this.extractKeywords(query);

    const scored = Object.values(SECTION_INDEX)
      .map(section => ({
        section,
        score: this.calculateRelevance(section, keywords),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map(({ section }) => section);
  }

  private extractKeywords(query: string): string[] {
    const normalized = query.toLowerCase();
    const latinWords = normalized.split(/\s+/).filter(w => w.length > 2);
    const cjkBlocks = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
    const cjkTokens: string[] = [];

    for (const block of cjkBlocks) {
      cjkTokens.push(block);
      if (block.length > 2) {
        for (let i = 0; i < block.length - 1; i++) {
          cjkTokens.push(block.slice(i, i + 2));
        }
      }
    }

    return [...new Set([...latinWords, ...cjkTokens])];
  }

  /**
   * 计算 section 与查询的相关性得分
   */
  private calculateRelevance(
    section: typeof SECTION_INDEX[keyof typeof SECTION_INDEX],
    keywords: string[]
  ): number {
    let score = 0;
    const searchText = `${section.title} ${section.description || ''} ${section.tags.join(' ')}`.toLowerCase();

    for (const keyword of keywords) {
      // 标题匹配：+3 分
      if (section.title.toLowerCase().includes(keyword)) {
        score += 3;
      }
      // 标签匹配：+2 分
      if (section.tags.some(t => t.toLowerCase().includes(keyword))) {
        score += 2;
      }
      // 描述匹配：+1 分
      if (searchText.includes(keyword)) {
        score += 1;
      }
    }

    return score;
  }

  /**
   * 检查 section 是否适用于当前选项
   */
  private isApplicable(
    section: typeof SECTION_INDEX[keyof typeof SECTION_INDEX],
    options: RetrievalOptions
  ): boolean {
    // 检查模式兼容性
    if (!section.applicableModes.includes(options.mode)) {
      return false;
    }

    // 检查平台兼容性
    if (options.platform && section.applicablePlatforms.includes('all')) {
      return true;
    }
    if (options.platform && !section.applicablePlatforms.includes(options.platform)) {
      return false;
    }

    return true;
  }

  private resolveDependencies(sectionId: string): string[] {
    const resolved: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const walk = (id: string) => {
      if (visited.has(id)) {
        return;
      }
      if (visiting.has(id)) {
        throw new Error(`Circular section dependency detected: ${id}`);
      }

      const metadata = SECTION_INDEX[id];
      if (!metadata) {
        return;
      }

      visiting.add(id);
      for (const dep of metadata.dependencies || []) {
        walk(dep);
        if (!resolved.includes(dep)) {
          resolved.push(dep);
        }
      }
      visiting.delete(id);
      visited.add(id);
    };

    walk(sectionId);
    return resolved;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.sectionLoader.clearCache();
    log.debug('Section retriever cache cleared');
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return this.sectionLoader.getCacheStats();
  }
}

/**
 * 单例实例
 */
let globalRetriever: SectionRetriever | null = null;

export function getSectionRetriever(): SectionRetriever {
  if (!globalRetriever) {
    globalRetriever = new SectionRetriever();
  }
  return globalRetriever;
}

export function resetSectionRetriever(): void {
  globalRetriever = null;
}
