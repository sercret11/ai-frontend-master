// 上下文缓存层 - 优化重复操作
import { LRUCache } from './lru.js';
import type { Section, Skill } from '../types/index.js';
import { Log } from '../logging/log.js';

const log = Log.create({ service: 'context-cache' });

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
  size: number;
  ttl?: number; // Individual TTL to prevent cache stampede
}

export class ContextCache {
  private sectionCache: LRUCache<string, CacheEntry<Section>>;
  private contentCache: LRUCache<string, CacheEntry<string>>;
  private skillCache: LRUCache<string, CacheEntry<Skill>>;
  private parseCache: LRUCache<string, CacheEntry<any>>;

  private stats = {
    sectionHits: 0,
    sectionMisses: 0,
    contentHits: 0,
    contentMisses: 0,
    skillHits: 0,
    skillMisses: 0,
    parseHits: 0,
    parseMisses: 0,
  };

  constructor(
    private config = {
      maxSections: 50,
      maxContents: 100,
      maxSkills: 50,
      maxParseResults: 20,
      ttl: 1000 * 60 * 5, // 5分钟过期
    }
  ) {
    this.sectionCache = new LRUCache(config.maxSections);
    this.contentCache = new LRUCache(config.maxContents);
    this.skillCache = new LRUCache(config.maxSkills);
    this.parseCache = new LRUCache(config.maxParseResults);
  }

  /**
   * 缓存 Section（带随机TTL防止雪崩）
   */
  cacheSection(name: string, section: Section): void {
    const entry: CacheEntry<Section> = {
      data: section,
      timestamp: Date.now(),
      hits: 0,
      size: section.tokens || 0,
      ttl: this.getRandomizedTTL(this.config.ttl),
    };

    this.sectionCache.set(name, entry);
    log.debug('Section cached', { name, size: section.tokens, ttl: entry.ttl });
  }

  /**
   * 获取缓存的 Section
   */
  getSection(name: string): Section | undefined {
    const entry = this.sectionCache.get(name);

    if (entry && this.isValid(entry)) {
      entry.hits++;
      this.stats.sectionHits++;
      log.debug('Section cache hit', { name, hits: entry.hits });
      return entry.data;
    }

    this.stats.sectionMisses++;
    if (entry) {
      this.sectionCache.delete(name);
    }
    return undefined;
  }

  /**
   * 缓存内容
   */
  cacheContent(path: string, content: string): void {
    const entry: CacheEntry<string> = {
      data: content,
      timestamp: Date.now(),
      hits: 0,
      size: content.length,
    };

    this.contentCache.set(path, entry);
  }

  /**
   * 获取缓存的内容
   */
  getContent(path: string): string | undefined {
    const entry = this.contentCache.get(path);

    if (entry && this.isValid(entry)) {
      entry.hits++;
      this.stats.contentHits++;
      return entry.data;
    }

    this.stats.contentMisses++;
    if (entry) {
      this.contentCache.delete(path);
    }
    return undefined;
  }

  /**
   * 缓存技能
   */
  cacheSkill(name: string, skill: Skill): void {
    const entry: CacheEntry<Skill> = {
      data: skill,
      timestamp: Date.now(),
      hits: 0,
      size: skill.tokens || 0,
    };

    this.skillCache.set(name, entry);
  }

  /**
   * 获取缓存的技能
   */
  getSkill(name: string): Skill | undefined {
    const entry = this.skillCache.get(name);

    if (entry && this.isValid(entry)) {
      entry.hits++;
      this.stats.skillHits++;
      return entry.data;
    }

    this.stats.skillMisses++;
    if (entry) {
      this.skillCache.delete(name);
    }
    return undefined;
  }

  /**
   * 缓存解析结果
   */
  cacheParseResult(key: string, result: any): void {
    const entry: CacheEntry<any> = {
      data: result,
      timestamp: Date.now(),
      hits: 0,
      size: JSON.stringify(result).length,
    };

    this.parseCache.set(key, entry);
  }

  /**
   * 获取缓存的解析结果
   */
  getParseResult(key: string): any | undefined {
    const entry = this.parseCache.get(key);

    if (entry && this.isValid(entry)) {
      entry.hits++;
      this.stats.parseHits++;
      return entry.data;
    }

    this.stats.parseMisses++;
    if (entry) {
      this.parseCache.delete(key);
    }
    return undefined;
  }

  /**
   * 检查缓存条目是否有效（使用随机TTL防止雪崩）
   */
  private isValid(entry: CacheEntry<any>): boolean {
    const age = Date.now() - entry.timestamp;

    // Use entry-specific TTL if available, otherwise use default
    // This randomizes expiration times to prevent cache stampede
    const ttl = entry.ttl ?? this.config.ttl;

    return age < ttl;
  }

  /**
   * 生成带随机抖动的TTL
   */
  private getRandomizedTTL(baseTTL: number, jitterPercent = 0.1): number {
    const jitter = baseTTL * jitterPercent;
    const randomJitter = Math.random() * jitter * 2 - jitter;
    return baseTTL + randomJitter;
  }

  /**
   * 清除过期缓存
   */
  clearExpired(): void {
    const now = Date.now();
    let cleared = 0;
    const isExpired = (entry: CacheEntry<unknown>): boolean =>
      now - entry.timestamp > (entry.ttl ?? this.config.ttl);

    for (const [key, entry] of this.sectionCache.entries) {
      if (isExpired(entry)) {
        this.sectionCache.delete(key);
        cleared++;
      }
    }

    for (const [key, entry] of this.contentCache.entries) {
      if (isExpired(entry)) {
        this.contentCache.delete(key);
        cleared++;
      }
    }

    for (const [key, entry] of this.skillCache.entries) {
      if (isExpired(entry)) {
        this.skillCache.delete(key);
        cleared++;
      }
    }

    for (const [key, entry] of this.parseCache.entries) {
      if (isExpired(entry)) {
        this.parseCache.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      log.info('Cleared expired cache entries', { count: cleared });
    }
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.sectionCache.clear();
    this.contentCache.clear();
    this.skillCache.clear();
    this.parseCache.clear();
    log.info('All caches cleared');
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    hitRate: number;
    sectionHits: number;
    sectionMisses: number;
    contentHits: number;
    contentMisses: number;
    skillHits: number;
    skillMisses: number;
    parseHits: number;
    parseMisses: number;
  } {
    const totalRequests =
      this.stats.sectionHits +
      this.stats.sectionMisses +
      this.stats.contentHits +
      this.stats.contentMisses +
      this.stats.skillHits +
      this.stats.skillMisses +
      this.stats.parseHits +
      this.stats.parseMisses;

    const totalHits =
      this.stats.sectionHits + this.stats.contentHits + this.stats.skillHits + this.stats.parseHits;

    return {
      hitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
      sectionHits: this.stats.sectionHits,
      sectionMisses: this.stats.sectionMisses,
      contentHits: this.stats.contentHits,
      contentMisses: this.stats.contentMisses,
      skillHits: this.stats.skillHits,
      skillMisses: this.stats.skillMisses,
      parseHits: this.stats.parseHits,
      parseMisses: this.stats.parseMisses,
    };
  }

  /**
   * 获取缓存大小
   */
  getSize(): {
    sections: number;
    contents: number;
    skills: number;
    parseResults: number;
    total: number;
  } {
    return {
      sections: this.sectionCache.size,
      contents: this.contentCache.size,
      skills: this.skillCache.size,
      parseResults: this.parseCache.size,
      total:
        this.sectionCache.size +
        this.contentCache.size +
        this.skillCache.size +
        this.parseCache.size,
    };
  }
}
