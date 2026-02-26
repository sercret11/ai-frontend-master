/**
 * 设计系统集成 - 管理设计资源数据
 * 加载和缓存 assets/ 中的设计数据
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Log } from '../../logging/log.js';

const logger = Log.create({ service: 'DesignSystem' });

// ============ 类型定义 ============

export interface DesignStyle {
  id: string;
  name: string;
  category: string;
  characteristics: string[];
  useCases: string[];
  examples?: string[];
}

export interface ColorPalette {
  id: string;
  name: string;
  category: string;
  colors: {
    primary?: string;
    secondary?: string;
    accent?: string;
    neutral?: string;
  };
  notes?: string;
}

export interface TypographyPair {
  id: string;
  name: string;
  category: string;
  heading: string;
  body: string;
  moodStyleKeywords: string;
}

export interface DesignSystemData {
  styles: DesignStyle[];
  palettes: ColorPalette[];
  typography: TypographyPair[];
}

// ============ 设计系统管理器 ============

export class DesignSystemManager {
  private assetsDir: string;
  private cache: Map<string, any> = new Map();
  private loaded: boolean = false;

  constructor(assetsDir: string = './assets') {
    this.assetsDir = assetsDir;
  }

  /**
   * 加载所有设计数据
   */
  async load(): Promise<DesignSystemData> {
    if (this.loaded) {
      return this.getCachedData();
    }

    try {
      const [styles, palettes, typography] = await Promise.all([
        this.loadStyles(),
        this.loadPalettes(),
        this.loadTypography(),
      ]);

      this.cache.set('styles', styles);
      this.cache.set('palettes', palettes);
      this.cache.set('typography', typography);
      this.loaded = true;

      return { styles, palettes, typography };
    } catch (error) {
      logger.error('加载设计系统数据失败', { error });
      return { styles: [], palettes: [], typography: [] };
    }
  }

  /**
   * 加载设计风格
   */
  private async loadStyles(): Promise<DesignStyle[]> {
    const filePath = path.join(this.assetsDir, 'design-styles.json');

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      return data.styles || [];
    } catch (error) {
      logger.warn(`无法加载设计风格: ${filePath}`);
      return [];
    }
  }

  /**
   * 加载配色方案
   */
  private async loadPalettes(): Promise<ColorPalette[]> {
    const filePath = path.join(this.assetsDir, 'color-palettes.json');

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      return data.palettes || [];
    } catch (error) {
      logger.warn(`无法加载配色方案: ${filePath}`);
      return [];
    }
  }

  /**
   * 加载字体组合
   */
  private async loadTypography(): Promise<TypographyPair[]> {
    const filePath = path.join(this.assetsDir, 'typography-pairs.json');

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      return data.pairs || [];
    } catch (error) {
      logger.warn(`无法加载字体组合: ${filePath}`);
      return [];
    }
  }

  /**
   * 获取缓存的数据
   */
  private getCachedData(): DesignSystemData {
    return {
      styles: this.cache.get('styles') || [],
      palettes: this.cache.get('palettes') || [],
      typography: this.cache.get('typography') || [],
    };
  }

  /**
   * 根据产品类型筛选设计风格
   */
  async getStylesByCategory(category: string): Promise<DesignStyle[]> {
    const data = await this.load();
    return data.styles.filter(s => s.category.toLowerCase() === category.toLowerCase());
  }

  /**
   * 根据产品类型筛选配色方案
   */
  async getPalettesByCategory(category: string): Promise<ColorPalette[]> {
    const data = await this.load();
    return data.palettes.filter(p => p.category.toLowerCase() === category.toLowerCase());
  }

  /**
   * 根据产品类型筛选字体组合
   */
  async getTypographyByCategory(category: string): Promise<TypographyPair[]> {
    const data = await this.load();
    return data.typography.filter(t => t.category.toLowerCase() === category.toLowerCase());
  }

  /**
   * 获取所有设计风格类别
   */
  async getStyleCategories(): Promise<string[]> {
    const data = await this.load();
    const categories = new Set(data.styles.map(s => s.category));
    return Array.from(categories);
  }

  /**
   * 获取所有配色类别
   */
  async getPaletteCategories(): Promise<string[]> {
    const data = await this.load();
    const categories = new Set(data.palettes.map(p => p.category));
    return Array.from(categories);
  }

  /**
   * 获取所有字体类别
   */
  async getTypographyCategories(): Promise<string[]> {
    const data = await this.load();
    const categories = new Set(data.typography.map(t => t.category));
    return Array.from(categories);
  }

  /**
   * 根据产品类型映射到设计类别
   */
  mapProductTypeToCategory(productType: string): string {
    const categoryMap: Record<string, string> = {
      SaaS: 'saas',
      'E-commerce': 'ecommerce',
      Finance: 'finance',
      Healthcare: 'healthcare',
      Education: 'edtech',
      Social: 'social',
      Media: 'entertainment',
      Tools: 'saas',
    };
    return categoryMap[productType] || 'saas';
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    stylesCount: number;
    palettesCount: number;
    typographyCount: number;
    categories: {
      styles: string[];
      palettes: string[];
      typography: string[];
    };
  }> {
    const data = await this.load();

    return {
      stylesCount: data.styles.length,
      palettesCount: data.palettes.length,
      typographyCount: data.typography.length,
      categories: {
        styles: await this.getStyleCategories(),
        palettes: await this.getPaletteCategories(),
        typography: await this.getTypographyCategories(),
      },
    };
  }
}

// ============ 工厂函数 ============

let globalManager: DesignSystemManager | null = null;

export async function getDesignSystemManager(
  assetsDir: string = './assets'
): Promise<DesignSystemManager> {
  if (!globalManager) {
    globalManager = new DesignSystemManager(assetsDir);
    await globalManager.load();
  }
  return globalManager;
}
