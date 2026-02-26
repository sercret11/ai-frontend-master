// 智能 Section 选择器
import type { SelectedSection, SelectionRequest, SelectionResult } from '../types/index.js';
import type { PromptSection } from '@ai-frontend/shared-types';
import { SectionLoader } from '../prompt/section-loader.js';
import { Log } from '../logging/log.js';

const log = Log.create({ service: 'section-selector' });

export class SectionSelector {
  private coreSections = [
    'core-identity-and-scope',
    'core-platform-capabilities',
    'core-mode-routing',
    'core-tool-calling-policy',
  ];

  private techStackMapping: Record<string, string> = {
    react: 'platform-web-react',
    nextjs: 'platform-web-nextjs',
    shadcn: 'platform-web-shadcn-ui',
    vue: 'web-vue',
    angular: 'web-angular',
    'react-native': 'platform-mobile-react-native',
    uniapp: 'platform-miniprogram-uniapp',
    electron: 'platform-desktop-electron',
  };

  private platformMapping: Record<string, string[]> = {
    web: ['platform-web-react', 'platform-web-nextjs', 'platform-web-shadcn-ui'],
    mobile: ['platform-mobile-react-native'],
    miniprogram: ['platform-miniprogram-uniapp'],
    desktop: ['platform-desktop-electron'],
  };

  constructor(private sectionLoader: SectionLoader) {}

  /**
   * 根据请求选择 sections
   */
  async selectForRequest(request: SelectionRequest): Promise<SelectionResult> {
    const selected: SelectedSection[] = [];
    let totalTokens = 0;
    const maxTokens = (request.maxTokens || 10000) * 0.4; // 40% 用于 sections
    const excluded: string[] = [];

    log.info('Selecting sections for request', {
      mode: request.mode,
      platform: request.platform,
      techStack: request.techStack,
      maxTokens,
    });

    // 1. 核心 sections (最高优先级)
    for (const name of this.coreSections) {
      if (totalTokens >= maxTokens) break;

      const section = await this.sectionLoader.loadSection(name);
      if (!section) {
        excluded.push(name);
        continue;
      }

      selected.push({
        section,
        relevance: 1.0,
        reason: 'Core section',
      });

      totalTokens += section.tokens || 0;
    }

    // 2. 技术栈相关 sections
    if (request.techStack) {
      for (const tech of request.techStack) {
        if (totalTokens >= maxTokens) break;

        const sectionName = this.techStackMapping[tech];
        if (!sectionName) continue;

        const section = await this.sectionLoader.loadSection(sectionName);
        if (!section) {
          excluded.push(sectionName);
          continue;
        }

        // 避免重复
        if (selected.some(s => s.section.id === section.id)) continue;

        selected.push({
          section,
          relevance: 0.9,
          reason: `Tech stack: ${tech}`,
        });

        totalTokens += section.tokens || 0;
      }
    }

    // 3. 平台相关 sections
    const platformSections = this.platformMapping[request.platform || 'web'] || [];
    for (const name of platformSections) {
      if (totalTokens >= maxTokens) break;

      const section = await this.sectionLoader.loadSection(name);
      if (!section) {
        excluded.push(name);
        continue;
      }

      // 避免重复
      if (selected.some(s => s.section.id === section.id)) continue;

      selected.push({
        section,
        relevance: 0.8,
        reason: `Platform: ${request.platform}`,
      });

      totalTokens += section.tokens || 0;
    }

    // 4. 用户自定义 sections
    if (request.customSections) {
      for (const section of request.customSections) {
        if (totalTokens >= maxTokens) break;

        const loaded = await this.sectionLoader.loadSection(section.id);
        if (!loaded) {
          excluded.push(section.id);
          continue;
        }

        // 避免重复
        if (selected.some(s => s.section.id === loaded.id)) continue;

        selected.push({
          section: loaded,
          relevance: 0.7,
          reason: 'Custom section',
        });

        totalTokens += loaded.tokens || 0;
      }
    }

    // 计算总相关性
    const totalRelevance = selected.reduce((sum, s) => sum + s.relevance, 0);

    log.info('Section selection complete', {
      selectedCount: selected.length,
      totalTokens,
      excludedCount: excluded.length,
      excluded: excluded.join(', '),
    });

    return {
      selected,
      totalRelevance,
      count: selected.length,
      totalTokens,
    };
  }

  /**
   * 加载 section
   */
  private async loadSection(name: string): Promise<PromptSection | null> {
    try {
      const section = await this.sectionLoader.loadSection(name);
      return section;
    } catch (error: any) {
      log.warn('Failed to load section: ' + name, { error: error.message });
      return null;
    }
  }

  /**
   * 获取可用的 sections
   */
  async getAvailableSections(): Promise<string[]> {
    const allSections = [
      ...this.coreSections,
      ...Object.values(this.techStackMapping),
      ...Object.values(this.platformMapping).flat(),
    ];

    const available: string[] = [];

    for (const name of allSections) {
      if (await this.sectionLoader.exists(name)) {
        available.push(name);
      }
    }

    return Array.from(new Set(available));
  }
}
