// Context manager with cache and concurrency optimizations.
import type { ContextBuildRequest, BuiltContext, Session, Section } from '../types/index.js';
import type { PromptSection } from '@ai-frontend/shared-types';
import { SectionLoader } from '../prompt/section-loader.js';
import { ContextCompactor } from './compaction.js';
import { ContextPruner } from './pruning.js';
import { SectionSelector } from './section-selector.js';
import { ContextCache } from '../cache/context-cache.js';
import { ParallelExecutor } from '../performance/parallel.js';
import { loadSystemPrompt as loadPromptSystemPrompt } from '../prompt/section-loader.js';
import { SessionStorage } from '../session/storage.js';
import { Token } from '../utils/text/token.js';
import { Log } from '../logging/log.js';

const log = Log.create({ service: 'context-manager' });

// Session cleanup configuration
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

export class ContextManager {
  private sectionLoader: SectionLoader;
  private compactor: ContextCompactor;
  private pruner: ContextPruner;
  private selector: SectionSelector;
  private cache: ContextCache;
  private parallel: ParallelExecutor;
  private sessions = new Map<string, Session>();
  private cacheCleanupTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private stats = {
    buildCount: 0,
    totalBuildTime: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(config: any) {
    this.sectionLoader = new SectionLoader({ sectionsDir: config.sectionsDir });
    this.compactor = new ContextCompactor();
    this.pruner = new ContextPruner();
    this.selector = new SectionSelector(this.sectionLoader);
    this.cache = new ContextCache(config.cacheConfig);
    this.parallel = new ParallelExecutor();
    this.startCacheCleanup();
    log.info('ContextManager initialized', config);
  }

  async buildContext(request: ContextBuildRequest): Promise<BuiltContext> {
    const startTime = Date.now();
    const maxTokens = request.maxTokens || 180000;
    const userMessage = this.resolveUserMessage(request);
    log.info('Building optimized context', { sessionID: request.sessionID });

    let session = this.sessions.get(request.sessionID);
    if (!session) {
      session = await this.createSession(request.sessionID);
      if (!session) {
        throw new Error(`Failed to create session: ${request.sessionID}`);
      }
    }

    // Request-level maxTokens must drive compaction/pruning thresholds.
    session.config = {
      ...(session.config || {}),
      maxTokens,
    };
    const normalizedRequest = { ...(request as any), userMessage, maxTokens };

    const cacheKey = this.getCacheKey(normalizedRequest);
    const cachedResult = this.cache.getParseResult(cacheKey);

    if (cachedResult && !this.needsRefresh(session)) {
      this.stats.cacheHits++;
      return cachedResult.data;
    }

    this.stats.cacheMisses++;

    let compressed = false;
    if (await this.compactor.shouldCompact(session, maxTokens)) {
      const result = await this.compactor.compact(session);
      if (result.messages) {
        session.messages = result.messages;
      }
      compressed = true;
    }
    // Execute independent loading steps in parallel for better performance.
    const [selected, skills, systemPrompt] = await this.parallel.execute([
      () => this.selectSectionsWithCache(normalizedRequest, maxTokens),
      () => this.loadSkillsWithCache(normalizedRequest, session),
      () => this.loadSystemPrompt(normalizedRequest),
    ]);

    const tokens = this.calculateTokens(systemPrompt, selected, skills, session);

    let pruned = false;
    if (tokens.total > maxTokens) {
      const result = await this.pruner.prune(session);
      if (result.messages) {
        session.messages = result.messages;
      }
      const messageCount = this.countMessagesTokens(result.messages || session.messages);
      tokens.messages = messageCount;
      tokens.total = tokens.system + tokens.sections + tokens.skills + tokens.messages;
      pruned = true;
    }

    const buildTime = Date.now() - startTime;

    const result: BuiltContext = {
      systemPrompt,
      sections: selected.selected.map((s: any) => s.section),
      skills,
      messages: session.messages,
      tokens,
      metadata: { compressed, pruned, buildTime },
    };

    this.cache.cacheParseResult(cacheKey, {
      data: result,
      timestamp: Date.now(),
      hits: 0,
      size: 1,
    });
    this.stats.buildCount++;
    this.stats.totalBuildTime += buildTime;

    return result;
  }

  private async selectSectionsWithCache(request: any, maxTokens: number): Promise<any> {
    const userMessage = this.resolveUserMessage(request);
    const customSections = this.resolveCustomSections(request);
    const sectionSelectionSignature = JSON.stringify({
      mode: request.mode,
      platform: request.platform,
      userMessage,
      techStack: Array.isArray(request.techStack) ? [...request.techStack].sort() : [],
      customSections: customSections.map(section => section.id).sort(),
      argsKey: this.stableSerialize(request.args || {}),
      maxTokens,
    });
    const cacheKey = `sections:${sectionSelectionSignature}`;
    const cached = this.cache.getParseResult(cacheKey);
    if (cached) return cached.data;
    // Load available prompt sections.
    const sections = await this.sectionLoader.listSections();
    const sectionData = await Promise.all(sections.map(id => this.sectionLoader.loadSection(id)));

    const result = await this.selector.selectForRequest({
      userInput: userMessage,
      mode: request.mode,
      techStack: request.techStack,
      platform: request.platform,
      maxTokens,
      customSections,
      availableSections: sectionData.filter((s): s is PromptSection => s !== null),
    });
    this.cache.cacheParseResult(cacheKey, {
      data: result,
      timestamp: Date.now(),
      hits: 0,
      size: 1,
    });
    return result;
  }

  private async loadSkillsWithCache(request: any, session: any): Promise<string[]> {
    const cacheKey = 'skills:' + (request.techStack?.join(',') || 'default');
    const cached = this.cache.getParseResult(cacheKey);
    if (cached) return cached.data;
    // Build context string.
    const context = JSON.stringify({
      techStack: request.techStack,
      platform: request.platform,
      projectType: session.metadata?.projectType || 'unknown',
      config: session.config,
    });

    const skillsContent = context; // Direct context, no injection needed
    const skills = [skillsContent];
    this.cache.cacheParseResult(cacheKey, {
      data: skills,
      timestamp: Date.now(),
      hits: 0,
      size: 1,
    });
    return skills;
  }

  private async loadSystemPrompt(request: any): Promise<string> {
    const cacheKey =
      'system-prompt:' +
      this.stableSerialize({
        args: request.args || {},
      });
    const cached = this.cache.getParseResult(cacheKey);
    if (cached) return cached.data;

    const systemPrompt = await loadPromptSystemPrompt();

    this.cache.cacheParseResult(cacheKey, {
      data: systemPrompt,
      timestamp: Date.now(),
      hits: 0,
      size: 1,
    });
    return systemPrompt;
  }

  private calculateTokens(
    systemPrompt: string,
    selected: any,
    skills: string[],
    session: any
  ): any {
    const system = Token.estimate(systemPrompt);
    const sections = selected?.totalTokens || 0;
    const skillTokens = skills.reduce((sum: number, s: string) => sum + Token.estimate(s), 0);
    const messages = this.countMessagesTokens(session.messages);

    return {
      system,
      sections,
      skills: skillTokens,
      messages,
      total: system + sections + skillTokens + messages,
    };
  }

  private countMessagesTokens(messages: any[]): number {
    return messages.reduce(
      (sum: number, msg: any) => sum + (msg.tokens || Token.estimate(msg.content)),
      0
    );
  }

  private getCacheKey(request: any): string {
    const stableTechStack = Array.isArray(request.techStack) ? [...request.techStack].sort() : [];
    const userMessage = this.resolveUserMessage(request);
    const customSections = this.resolveCustomSections(request);
    const maxTokens = request.maxTokens || 180000;

    return JSON.stringify({
      mode: request.mode,
      platform: request.platform,
      techStack: stableTechStack,
      userMessage,
      maxTokens,
      customSections: customSections.map(section => section.id).sort(),
      argsKey: this.stableSerialize(request.args || {}),
    });
  }

  private resolveUserMessage(request: { userMessage?: string; userInput?: string }): string {
    if (typeof request.userMessage === 'string') {
      return request.userMessage;
    }
    if (typeof request.userInput === 'string') {
      return request.userInput;
    }
    return '';
  }

  private resolveCustomSections(request: any): Section[] {
    const fromRequest = Array.isArray(request.customSections) ? request.customSections : [];
    const fromArgs = Array.isArray(request.args?.customSections) ? request.args.customSections : [];
    const merged = [...fromRequest, ...fromArgs];
    const ids = new Set<string>();
    const normalized: Section[] = [];

    for (const section of merged) {
      const id =
        typeof section === 'string'
          ? section
          : section && typeof section.id === 'string'
            ? section.id
            : undefined;
      if (!id) {
        continue;
      }
      if (ids.has(id)) {
        continue;
      }
      ids.add(id);

      const priority =
        section &&
        typeof section === 'object' &&
        section.priority &&
        ['P0', 'P1', 'P2', 'P3'].includes(section.priority)
          ? section.priority
          : 'P3';
      const title =
        section && typeof section === 'object' && typeof section.title === 'string'
          ? section.title
          : id;
      const content =
        section && typeof section === 'object' && typeof section.content === 'string'
          ? section.content
          : '';
      const tags =
        section && typeof section === 'object' && Array.isArray(section.tags)
          ? section.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
          : undefined;
      const tokens =
        section && typeof section === 'object' && typeof section.tokens === 'number'
          ? section.tokens
          : undefined;

      normalized.push({
        id,
        title,
        content,
        priority: priority as Section['priority'],
        tags,
        tokens,
      });
    }

    return normalized;
  }

  private stableSerialize(value: unknown): string {
    const seen = new WeakSet<object>();
    const normalize = (input: unknown): unknown => {
      if (input === undefined || input === null) {
        return null;
      }

      if (Array.isArray(input)) {
        return input.map(item => normalize(item));
      }

      if (typeof input === 'object') {
        const obj = input as Record<string, unknown>;
        if (seen.has(obj)) {
          return '[Circular]';
        }
        seen.add(obj);
        const sorted = Object.keys(obj)
          .sort()
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = normalize(obj[key]);
            return acc;
          }, {});
        seen.delete(obj);
        return sorted;
      }

      if (typeof input === 'function') {
        return '[Function]';
      }

      return input;
    };

    try {
      return JSON.stringify(normalize(value)) || '';
    } catch {
      return '';
    }
  }

  private needsRefresh(session: any): boolean {
    return Date.now() - session.metadata.updatedAt > 60000;
  }

  private async createSession(sessionID: string): Promise<Session> {
    const now = Date.now();
    const persistedSession = SessionStorage.getSession(sessionID);
    const persistedMessages = SessionStorage.getMessages(sessionID);
    const initialCreatedAt = persistedSession?.createdAt ?? persistedMessages[0]?.createdAt ?? now;
    const initialUpdatedAt =
      persistedSession?.updatedAt ??
      persistedMessages[persistedMessages.length - 1]?.createdAt ??
      initialCreatedAt;

    const session: Session = {
      id: sessionID,
      messages: persistedMessages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        parts: message.parts,
        timestamp: message.createdAt,
      })),
      config: {
        maxTokens: 180000,
        compressionThreshold: 0.8,
        mode: persistedSession?.mode === 'implementer' ? 'implementer' : 'creator',
        techStack: [],
        platform: 'web',
      },
      metadata: {
        createdAt: initialCreatedAt,
        updatedAt: initialUpdatedAt,
      },
      createdAt: initialCreatedAt,
      updatedAt: initialUpdatedAt,
    };
    this.sessions.set(sessionID, session);
    return session;
  }

  private startCacheCleanup(): void {
    // Cache cleanup every 5 minutes
    this.cacheCleanupTimer = setInterval(
      () => {
        this.cache.clearExpired();
      },
      5 * 60 * 1000
    );

    // Session cleanup every hour
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, CLEANUP_INTERVAL);

    log.info('Cleanup tasks started', {
      cacheCleanupInterval: '5 minutes',
      sessionCleanupInterval: '1 hour',
      sessionTTL: `${SESSION_TTL / 1000 / 60 / 60} hours`,
    });
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const initialSize = this.sessions.size;
    let cleanedCount = 0;

    for (const [id, session] of this.sessions.entries()) {
      const lastActiveAt =
        session.updatedAt ??
        session.metadata?.updatedAt ??
        session.createdAt ??
        session.metadata?.createdAt ??
        now;
      const sessionAge = now - lastActiveAt;
      if (sessionAge > SESSION_TTL) {
        this.sessions.delete(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log.info('Cleaned expired sessions', {
        cleaned: cleanedCount,
        remaining: this.sessions.size,
        initial: initialSize,
      });
    }
  }

  getSession(sessionID: string): any {
    return this.sessions.get(sessionID);
  }

  updateSession(sessionID: string, updates: any): void {
    const session = this.sessions.get(sessionID);
    if (session) {
      const now = Date.now();
      Object.assign(session, updates);
      session.updatedAt = now;
      session.metadata || (session.metadata = {});
      session.metadata.updatedAt = now;
      if (session.metadata.createdAt === undefined) {
        session.metadata.createdAt = session.createdAt;
      }
    }
  }

  deleteSession(sessionID: string): void {
    this.sessions.delete(sessionID);
  }

  getPerformanceStats(): any {
    return {
      buildCount: this.stats.buildCount,
      avgBuildTime:
        this.stats.buildCount > 0 ? this.stats.totalBuildTime / this.stats.buildCount : 0,
      cacheHitRate: this.cache.getStats().hitRate,
      sessions: this.sessions.size,
      sessionTTL: SESSION_TTL,
      cleanupInterval: CLEANUP_INTERVAL,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Destroy the context manager and cleanup resources
   */
  destroy(): void {
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = undefined;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.sessions.clear();
    this.cache.clear();
    log.info('EnhancedContextManager destroyed');
  }
}
