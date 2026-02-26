/**
 * Section Loader - 章节加载器
 *
 * 负责加载 prompt-docs 中的 section 文档、系统提示词和资源文件。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { Log } from '../logging/log.js';
import { estimateTokenCount } from './token-estimator.js';
import {
  getAllSectionMetadata,
  getPromptDocsRoot,
  getSectionMetadata,
  getSystemPromptPath,
} from './section-index.js';
import type {
  PromptSection,
  DesignStyle,
  ColorPalette,
  TypographyPair,
} from '@ai-frontend/shared-types';

const log = Log.create({ service: 'section-loader' });

export interface SectionLoadOptions {
  sectionsDir?: string;
}

function resolveSectionsRoot(customDir?: string): string {
  if (customDir) {
    const absolute = path.isAbsolute(customDir) ? customDir : path.resolve(process.cwd(), customDir);
    if (existsSync(absolute)) {
      return absolute;
    }

    const parentRelative = path.resolve(process.cwd(), '..', customDir);
    if (existsSync(parentRelative)) {
      return parentRelative;
    }
  }

  return getPromptDocsRoot();
}

function resolveAssetDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'assets'),
    path.resolve(process.cwd(), '../assets'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export class SectionLoader {
  private sectionsDir: string;
  private cache = new Map<string, PromptSection>();

  constructor(options: SectionLoadOptions = {}) {
    this.sectionsDir = resolveSectionsRoot(options.sectionsDir);
  }

  /**
   * 加载单个章节
   */
  async loadSection(sectionId: string): Promise<PromptSection | null> {
    if (this.cache.has(sectionId)) {
      return this.cache.get(sectionId)!;
    }

    const filePath = this.resolveSectionPath(sectionId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const section = this.parseSection(sectionId, content);
      this.cache.set(sectionId, section);
      return section;
    } catch (error) {
      log.warn(`Failed to load section ${sectionId}`, { filePath, error });
      return null;
    }
  }

  /**
   * 获取章节内容
   */
  async getContent(sectionId: string): Promise<string | null> {
    const section = await this.loadSection(sectionId);
    return section?.content || null;
  }

  /**
   * 检查章节是否存在
   */
  async exists(sectionId: string): Promise<boolean> {
    const filePath = this.resolveSectionPath(sectionId);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 加载所有章节
   */
  async load(): Promise<void> {
    const sectionIds = await this.listSections();
    await Promise.all(sectionIds.map(id => this.loadSection(id)));
    log.debug(`Loaded ${sectionIds.length} sections`);
  }

  /**
   * 加载多个章节
   */
  async loadSections(sectionIds: string[]): Promise<PromptSection[]> {
    const sections = await Promise.all(sectionIds.map(id => this.loadSection(id)));
    return sections.filter((section): section is PromptSection => section !== null);
  }

  /**
   * 列出所有可用章节
   */
  async listSections(): Promise<string[]> {
    const indexedIds = getAllSectionMetadata().map(s => s.id);
    if (indexedIds.length > 0) {
      return indexedIds;
    }

    try {
      const files = await fs.readdir(this.sectionsDir);
      return files.filter(file => file.endsWith('.md')).map(file => file.replace(/\.md$/, ''));
    } catch (error) {
      log.warn('Failed to list sections', { error });
      return [];
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  private resolveSectionPath(sectionId: string): string {
    const metadata = getSectionMetadata(sectionId);
    if (metadata?.file) {
      return path.resolve(this.sectionsDir, metadata.file);
    }

    const fallbackCandidates = [
      path.resolve(this.sectionsDir, 'sections', `${sectionId}.md`),
      path.resolve(this.sectionsDir, `${sectionId}.md`),
    ];

    for (const candidate of fallbackCandidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return fallbackCandidates[0];
  }

  private parseSection(id: string, content: string): PromptSection {
    const metadata = getSectionMetadata(id);
    const title = metadata?.title || this.extractTitle(content);
    const priority = metadata?.priority || this.extractPriority(content);
    const tags = metadata?.tags && metadata.tags.length > 0 ? metadata.tags : this.extractTags(content);

    return {
      id,
      title,
      content,
      priority,
      tags,
      tokens: estimateTokenCount(content),
    };
  }

  private extractTitle(content: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1] : 'Untitled Section';
  }

  private extractPriority(content: string): 'P0' | 'P1' | 'P2' | 'P3' {
    if (/\*\*P0\*\*/.test(content)) return 'P0';
    if (/\*\*P1\*\*/.test(content)) return 'P1';
    if (/\*\*P2\*\*/.test(content)) return 'P2';
    return 'P3';
  }

  private extractTags(content: string): string[] {
    const tags: string[] = [];
    const match = content.match(/Tags?:\s*(.+)$/im);
    if (!match) {
      return tags;
    }

    const parts = match[1].split(/[,|#|]/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        tags.push(trimmed.replace(/^#/, ''));
      }
    }

    return tags;
  }
}

const ASSET_DIR = resolveAssetDir();

/**
 * 加载系统提示词
 */
export async function loadSystemPrompt(): Promise<string> {
  const systemPromptPath = getSystemPromptPath();

  try {
    return await fs.readFile(systemPromptPath, 'utf-8');
  } catch (error) {
    log.warn('Could not load system prompt file', { systemPromptPath, error });
    return '';
  }
}

/**
 * 加载资源 JSON 文件
 */
export async function loadAsset(assetName: string): Promise<any> {
  const filePath = path.join(ASSET_DIR, `${assetName}.json`);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    log.warn(`Could not load asset ${assetName}`, { filePath, error });
    return null;
  }
}

/**
 * 加载设计风格
 */
export async function loadDesignStyles(): Promise<DesignStyle[]> {
  const data = await loadAsset('design-styles');
  return data?.styles || [];
}

/**
 * 加载颜色调色板
 */
export async function loadColorPalettes(): Promise<ColorPalette[]> {
  const data = await loadAsset('color-palettes');
  return data?.palettes || [];
}

/**
 * 加载字体对
 */
export async function loadTypographyPairs(): Promise<TypographyPair[]> {
  const data = await loadAsset('typography-pairs');
  return data?.pairs || [];
}

/**
 * 加载组件列表
 */
export async function loadComponentList(): Promise<string[]> {
  const data = await loadAsset('components-list');
  return data?.components || [];
}

/**
 * 加载设计 tokens
 */
export async function loadDesignTokens(): Promise<any> {
  return await loadAsset('design-tokens');
}
