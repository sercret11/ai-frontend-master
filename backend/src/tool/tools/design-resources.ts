/**
 * Design Resources Tools - 设计资源工具集
 *
 * 提供按需查询设计资源的工具，替代在 prompt 中注入大量 JSON 数据
 * 将 42K tokens 的资源注入改为按需工具调用
 */

import { Tool } from '../tool';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { Log } from '../../logging/log.js';

const log = Log.create({ service: 'design-resources-tools' });

/**
 * 资源缓存
 */
const resourceCache = new Map<string, any>();

/**
 * 资源文件路径
 */
const ASSETS_DIR = path.resolve(process.cwd(), 'assets');

/**
 * 加载资源文件（带缓存）
 */
async function loadResource(filename: string): Promise<any> {
  if (resourceCache.has(filename)) {
    log.debug(`Resource cache hit: ${filename}`);
    return resourceCache.get(filename);
  }

  const filePath = path.join(ASSETS_DIR, filename);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    resourceCache.set(filename, data);
    log.debug(`Resource loaded: ${filename}`);
    return data;
  } catch (error) {
    log.warn(`Failed to load resource ${filename}`, { error });
    return null;
  }
}

/**
 * 颜色调色板工具
 */
export const GetColorPaletteTool = Tool.define('get_color_palette', {
  description: '获取颜色调色板推荐。按产品类别、情绪氛围查询调色板。返回完整的颜色定义（hex、HSL、Tailwind 类名）。使用此工具当你需要为项目选择配色方案时。',
  parameters: z.object({
    category: z.string().optional().describe('产品类别：saas(软件服务)、ecommerce(电商)、finance(金融)、healthcare(医疗)、edtech(教育)、social(社交)、entertainment(娱乐)、travel(旅行)、food(餐饮)、other(其他)'),
    mood: z.string().optional().describe('颜色情绪：warm(暖色)、cool(冷色)、neutral(中性)、vibrant(鲜艳)、professional(专业)、playful(活泼)'),
    maxResults: z.number().int().min(1).max(10).optional().default(3).describe('返回的最大结果数，默认 3 个'),
  }),
  async execute(params) {
    const data = await loadResource('color-palettes.json');
    if (!data) {
      return {
        title: '颜色调色板',
        metadata: { count: 0, category: params.category, mood: params.mood },
        output: '错误：调色板数据文件未找到',
      };
    }

    let palettes = data.palettes || [];

    // 按类别过滤
    if (params.category) {
      const categoryLower = params.category.toLowerCase();
      palettes = palettes.filter((p: any) =>
        p.category?.toLowerCase() === categoryLower ||
        p.id?.toLowerCase().includes(categoryLower)
      );
    }

    // 按情绪过滤（简化实现，可通过添加 mood 元数据增强）
    if (params.mood) {
      // 当前数据中没有 mood 字段，这里可以扩展
      // 暂时不过滤，返回所有结果
    }

    // 限制结果数量
    const results = palettes.slice(0, params.maxResults || 3);

    log.info('Color palette query', {
      category: params.category,
      mood: params.mood,
      results: results.length,
    });

    return {
      title: `颜色调色板 (${results.length} 个结果)`,
      metadata: {
        count: results.length,
        category: params.category || '',
        mood: params.mood || '',
      },
      output: JSON.stringify(results, null, 2),
    };
  },
});

/**
 * 设计风格工具
 */
export const GetDesignStyleTool = Tool.define('get_design_style', {
  description: '获取设计风格推荐。按氛围、行业、类别查询设计风格规范。返回详细的风格定义、设计原则和组件规范。使用此工具当你需要确定项目的设计风格时。',
  parameters: z.object({
    category: z.string().optional().describe('风格类别：universal(通用)、landing-page(落地页)、bi-dashboard(数据看板)'),
    vibe: z.string().optional().describe('设计氛围：minimalist(极简)、neumorphism(新拟态)、glassmorphism(玻璃拟态)、dark-mode(暗色)、brutalist(野兽派)、skeuomorphic(拟物化)、flat-design(扁平化)'),
    industry: z.string().optional().describe('目标行业：technology、finance、healthcare、education、retail 等'),
    maxResults: z.number().int().min(1).max(10).optional().default(3).describe('返回的最大结果数'),
  }),
  async execute(params) {
    const data = await loadResource('design-styles.json');
    if (!data) {
      return {
        title: '设计风格',
        metadata: { count: 0, category: params.category || '', vibe: params.vibe || '', industry: params.industry || '' },
        output: '错误：设计风格数据文件未找到',
      };
    }

    let styles = data.styles || [];

    // 按类别过滤
    if (params.category) {
      styles = styles.filter((s: any) => s.category === params.category);
    }

    // 按氛围过滤
    if (params.vibe) {
      const vibeLower = params.vibe.toLowerCase();
      styles = styles.filter((s: any) =>
        s.vibe?.toLowerCase().includes(vibeLower) ||
        s.style?.toLowerCase().includes(vibeLower)
      );
    }

    // 按行业过滤
    if (params.industry) {
      const industryLower = params.industry.toLowerCase();
      styles = styles.filter((s: any) =>
        s.industry?.toLowerCase().includes(industryLower) ||
        s.applicableFor?.toLowerCase().includes(industryLower)
      );
    }

    // 限制结果数量
    const results = styles.slice(0, params.maxResults || 3);

    log.info('Design style query', {
      category: params.category,
      vibe: params.vibe,
      industry: params.industry,
      results: results.length,
    });

    return {
      title: `设计风格 (${results.length} 个结果)`,
      metadata: {
        count: results.length,
        category: params.category || '',
        vibe: params.vibe || '',
        industry: params.industry || '',
      },
      output: JSON.stringify(results, null, 2),
    };
  },
});

/**
 * 字体对工具
 */
export const GetTypographyPairTool = Tool.define('get_typography_pair', {
  description: '获取字体对推荐。按用例、语言、类别查询字体配对。返回字体名称、权重、行高、字间距等详细规范。使用此工具当你需要为项目选择字体搭配时。',
  parameters: z.object({
    category: z.string().optional().describe('类别：professional-business(商务)、creative-arts(创意)、multilingual(多语言)、minimal-clean(极简)、modern-tech(现代科技)'),
    useCase: z.string().optional().describe('用例：headings(标题)、body(正文)、ui-components(UI组件)、dashboards(看板)、editorial(编辑)'),
    language: z.string().optional().describe('语言支持：en(英语)、zh(中文)、ja(日语)、ko(韩语)、ar(阿拉伯语)'),
    maxResults: z.number().int().min(1).max(10).optional().default(3).describe('返回的最大结果数'),
  }),
  async execute(params) {
    const data = await loadResource('typography-pairs.json');
    if (!data) {
      return {
        title: '字体对',
        metadata: { count: 0, category: params.category || '', useCase: params.useCase || '', language: params.language || '' },
        output: '错误：字体对数据文件未找到',
      };
    }

    let pairs = data.pairs || [];

    // 按类别过滤
    if (params.category) {
      const categoryLower = params.category.toLowerCase();
      pairs = pairs.filter((p: any) =>
        p.category?.toLowerCase() === categoryLower ||
        p.type?.toLowerCase().includes(categoryLower)
      );
    }

    // 按用例过滤
    if (params.useCase) {
      const useCaseLower = params.useCase.toLowerCase();
      pairs = pairs.filter((p: any) => {
        const bestFor = p.bestFor;
        const recommendedFor = p.recommendedFor;

        // Handle string or array
        const checkBestFor = typeof bestFor === 'string'
          ? bestFor.toLowerCase().includes(useCaseLower)
          : Array.isArray(bestFor)
          ? bestFor.some((b: string) => b.toLowerCase().includes(useCaseLower))
          : false;

        const checkRecommendedFor = typeof recommendedFor === 'string'
          ? recommendedFor.toLowerCase().includes(useCaseLower)
          : Array.isArray(recommendedFor)
          ? recommendedFor.some((r: string) => r.toLowerCase().includes(useCaseLower))
          : false;

        return checkBestFor || checkRecommendedFor;
      });
    }

    // 按语言过滤
    if (params.language) {
      const langLower = params.language.toLowerCase();
      pairs = pairs.filter((p: any) => {
        const languageSupport = p.languageSupport;
        const languages = p.languages;

        // Handle string or array
        const checkLanguageSupport = typeof languageSupport === 'string'
          ? languageSupport.toLowerCase().includes(langLower)
          : Array.isArray(languageSupport)
          ? languageSupport.some((l: string) => l.toLowerCase().includes(langLower))
          : false;

        const checkLanguages = Array.isArray(languages)
          ? languages.some((l: string) => l.toLowerCase() === langLower)
          : false;

        return checkLanguageSupport || checkLanguages;
      });
    }

    // 限制结果数量
    const results = pairs.slice(0, params.maxResults || 3);

    log.info('Typography pair query', {
      category: params.category,
      useCase: params.useCase,
      language: params.language,
      results: results.length,
    });

    return {
      title: `字体对 (${results.length} 个结果)`,
      metadata: {
        count: results.length,
        category: params.category || '',
        useCase: params.useCase || '',
        language: params.language || '',
      },
      output: JSON.stringify(results, null, 2),
    };
  },
});

/**
 * 组件列表工具
 */
export const GetComponentListTool = Tool.define('get_component_list', {
  description: '获取可用组件列表。浏览组件库中的所有可用组件，按类别筛选。返回组件名称、描述、用途等信息。使用此工具当你需要了解可用的 UI 组件时。',
  parameters: z.object({
    category: z.string().optional().describe('组件类别：form(表单)、navigation(导航)、data-display(数据展示)、feedback(反馈)、layout(布局)、overlay(覆盖层)、typography(排版)'),
  }),
  async execute(params) {
    const data = await loadResource('components-list.json');
    if (!data) {
      return {
        title: '组件列表',
        metadata: { count: 0, category: params.category || '' },
        output: '错误：组件列表数据文件未找到',
      };
    }

    let components = data.components || [];

    // 按类别过滤
    if (params.category) {
      const categoryLower = params.category.toLowerCase();
      components = components.filter((c: any) =>
        c.category?.toLowerCase() === categoryLower
      );
    }

    log.info('Component list query', {
      category: params.category,
      results: components.length,
    });

    return {
      title: `组件库 (${components.length} 个组件)`,
      metadata: {
        count: components.length,
        category: params.category || '',
      },
      output: JSON.stringify(components, null, 2),
    };
  },
});

/**
 * 清除资源缓存
 */
export function clearResourceCache(): void {
  resourceCache.clear();
  log.debug('Design resources cache cleared');
}

/**
 * 获取缓存统计
 */
export function getResourceCacheStats(): { size: number; keys: string[] } {
  return {
    size: resourceCache.size,
    keys: Array.from(resourceCache.keys()),
  };
}
