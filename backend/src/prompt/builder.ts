/**
 * Prompt Builder - 统一的提示词构建器（混合策略版本）
 *
 * 核心功能：
 * 1. 加载简化的核心系统提示词 (~8K tokens)
 * 2. 使用智能检索选择相关 sections (3-5K tokens)
 * 3. 添加资源工具说明（不注入 JSON）
 * 4. 支持变量替换
 *
 * 目标：12-15K tokens（从当前的 340K 减少 96%）
 */

import { Log } from '../logging/log.js';
import { SectionRetriever } from './section-retriever.js';
import { estimateTokenCount } from './token-estimator.js';
import {
  loadColorPalettes,
  loadDesignStyles,
  loadSystemPrompt,
  loadTypographyPairs,
  SectionLoader,
} from './section-loader.js';
import { getSectionMetadata } from './section-index.js';
import type {
  PromptBuildOptions,
  PromptBuildResult,
  AgentConfig,
  PromptBuildDiagnostics,
  PromptContextSource,
  SessionMode,
  ColorPalette,
  DesignStyle,
  TypographyPair,
} from '@ai-frontend/shared-types';

const log = Log.create({ service: 'prompt-builder' });
const TEMPLATE_PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const RESERVED_TEMPLATE_VARIABLE_KEYS = new Set(['userQuery', 'techStack', 'platform']);
const ALLOWED_TEMPLATE_VARIABLE_KEYS = new Set([
  '__modeSource',
  '__platformSource',
  '__techStackSource',
  '__routingReason',
  '__routingConfidence',
  '__routingScore',
  '__routingVersion',
  '__routingLanguage',
  '__routingTechSignals',
]);

/**
 * 核心系统提示词缓存
 */
let coreSystemPrompt: string | null = null;

/**
 * 资源工具说明（不注入完整 JSON）
 */
const RESOURCE_TOOL_GUIDE = `
## Design Resources

You have access to these tools for design resources:

- **design_search**: Search style, color, typography, chart, product, and UX references
  - Use this first for broad discovery
  - Example: design_search({ query: "B2B SaaS dashboard", domain: "style" })

- **get_design_style**: Fetch curated design-style specifications
  - Example: get_design_style({ vibe: "minimalist", industry: "technology" })

- **get_color_palette**: Fetch curated color palettes
  - Example: get_color_palette({ category: "saas", mood: "professional" })

- **get_typography_pair**: Fetch curated typography pairs
  - Example: get_typography_pair({ category: "professional-business", language: "en" })

- **get_component_list**: Browse available components in the component library
  - Example: get_component_list({ category: "form" })

### When to Use These Tools

1. **Creator Mode**: Start with design_search, then call specific resource tools
2. **Implementer Mode**: Call tools if design specs are missing or ambiguous
3. **Before Decisions**: Retrieve references before finalizing style choices

### Important Rules

- **ALWAYS use tool results** - Never fabricate palette, style, or typography data
- **Be specific** - Use exact identifiers returned by tools
- **Combine tools** - Use multiple tools to build complete design specifications
`;

export interface AgentPromptBuildContext {
  userMessage?: string;
  mode?: SessionMode;
  platform?: 'web' | 'mobile' | 'desktop' | 'miniprogram';
  techStack?: string[];
  contextSources?: {
    mode?: PromptContextSource;
    platform?: PromptContextSource;
    techStack?: PromptContextSource;
  };
  routing?: {
    reason: string;
    confidence: number;
    score?: number;
    version?: string;
    language?: 'zh' | 'en' | 'mixed' | 'unknown';
    techSignals?: string[];
  };
}

/**
 * Prompt Builder namespace
 */
export namespace PromptBuilder {
  /**
   * 构建提示词
   *
   * @param options - 构建选项
   * @returns 构建结果
   */
  export async function build(options: PromptBuildOptions): Promise<PromptBuildResult> {
    const startTime = Date.now();
    const parts: string[] = [];

    const effectiveMode = options.mode || options.agent?.mode || 'creator';

    log.info('Building prompt with hybrid strategy', {
      hasAgent: !!options.agent,
      mode: effectiveMode,
      hasUserQuery: !!options.variables?.userQuery,
    });

    // Step 1: core system prompt.
    const systemPrompt = await loadCoreSystemPrompt();
    parts.push(systemPrompt);

    const coreTokens = estimateTokenCount(systemPrompt);
    log.debug('Core system prompt loaded', { coreTokens });

    const userQuery = options.variables?.userQuery as string | undefined;

    const rawPlatform = options.variables?.platform;
    const platform =
      typeof rawPlatform === 'string' &&
      ['web', 'mobile', 'desktop', 'miniprogram'].includes(rawPlatform)
        ? (rawPlatform as 'web' | 'mobile' | 'desktop' | 'miniprogram')
        : undefined;

    const techStack = options.variables?.techStack as string[] | undefined;
    const sectionBudget = 6000;
    const excludedSectionSet = new Set(options.excludeSections || []);
    const explicitSections = options.sections?.filter(Boolean) || [];

    const retrievalResult =
      explicitSections.length > 0
        ? await buildFromExplicitSections(explicitSections, excludedSectionSet, sectionBudget)
        : await buildFromRetriever({
            mode: effectiveMode,
            platform,
            techStack,
            userQuery,
            maxTokens: sectionBudget,
            excludedSectionSet,
          });

    for (const section of retrievalResult.sections) {
      parts.push(`\n\n## ${section.title}\n\n${section.content}`);
    }

    log.info('Sections retrieved', {
      selectedCount: retrievalResult.selectedIds.length,
      excludedCount: retrievalResult.excludedIds.length,
      sectionBudgetTokens: retrievalResult.budgetTotalTokens,
      sectionTokens: retrievalResult.measuredTotalTokens,
      estimatedSectionTokens: retrievalResult.estimatedTotalTokens,
      tokenDriftRatio: retrievalResult.tokenDriftRatio,
      selectionDetails: retrievalResult.selectionDetails,
    });

    // Step 3: add resource tool guide.
    parts.push(RESOURCE_TOOL_GUIDE);
    const resourceGuideTokens = estimateTokenCount(RESOURCE_TOOL_GUIDE);

    // Step 4: template variable replacement.
    let finalPrompt = parts.join('\n\n---\n\n');
    const variables = options.variables || {};
    finalPrompt = applyTemplateVariables(finalPrompt, variables);

    // Step 5: token diagnostics and result.
    const estimatedTokens = estimateTokenCount(finalPrompt);
    const buildTime = Date.now() - startTime;
    const staticEstimatedTotal =
      coreTokens + retrievalResult.estimatedTotalTokens + resourceGuideTokens;
    const runtimeDriftRatio =
      staticEstimatedTotal > 0
        ? Number((estimatedTokens / staticEstimatedTotal).toFixed(2))
        : 1;

    log.info('Prompt built successfully', {
      coreTokens,
      sectionBudgetTokens: retrievalResult.budgetTotalTokens,
      sectionTokens: retrievalResult.measuredTotalTokens,
      totalTokens: estimatedTokens,
      buildTime,
      targetMet: estimatedTokens <= 15000,
      staticEstimatedTotal,
      runtimeDriftRatio,
    });

    const diagnostics: PromptBuildDiagnostics = {
      input: {
        userQuery,
        mode: options.mode,
        platform,
        techStack,
      },
      resolved: {
        mode: effectiveMode,
        platform,
        techStack: techStack || [],
        sources: {
          mode: (options.variables?.__modeSource as PromptContextSource) || 'default',
          platform: (options.variables?.__platformSource as PromptContextSource) || 'default',
          techStack: (options.variables?.__techStackSource as PromptContextSource) || 'default',
        },
      },
      retrieval: {
        selectedIds: retrievalResult.selectedIds,
        excludedIds: retrievalResult.excludedIds,
        selectionDetails: retrievalResult.selectionDetails,
      },
      tokens: {
        core: coreTokens,
        sections: retrievalResult.measuredTotalTokens,
        total: estimatedTokens,
        measuredTotal: estimatedTokens,
        driftRatio: runtimeDriftRatio,
      },
      budget: {
        requestedMaxTokens: 15000,
        estimatedTotal: staticEstimatedTotal,
        measuredTotal: estimatedTokens,
        overflow: estimatedTokens > 15000,
        selectedSections: retrievalResult.selectedIds,
        excludedSections: retrievalResult.excludedIds,
        trims: retrievalResult.excludedIds.length
          ? [`excluded:${retrievalResult.excludedIds.length}`]
          : [],
      },
      buildTimeMs: buildTime,
    };

    const routingReason = options.variables?.__routingReason;
    const routingConfidence = options.variables?.__routingConfidence;
    const routingScore = options.variables?.__routingScore;
    const routingVersion = options.variables?.__routingVersion;
    const routingLanguage = options.variables?.__routingLanguage;
    const routingTechSignals = options.variables?.__routingTechSignals;

    if (typeof routingReason === 'string' && typeof routingConfidence === 'number') {
      diagnostics.routing = {
        reason: routingReason,
        confidence: routingConfidence,
      };

      if (typeof routingScore === 'number') {
        diagnostics.routing.score = routingScore;
      }
      if (typeof routingVersion === 'string') {
        diagnostics.routing.version = routingVersion;
      }
      if (
        routingLanguage === 'zh' ||
        routingLanguage === 'en' ||
        routingLanguage === 'mixed' ||
        routingLanguage === 'unknown'
      ) {
        diagnostics.routing.language = routingLanguage;
      }
      if (Array.isArray(routingTechSignals)) {
        diagnostics.routing.techSignals = routingTechSignals.filter(v => typeof v === 'string');
      }
    }

    const resourceIds = options.resources || options.agent?.resources || [];
    const resolvedResources = await loadRequestedResources(resourceIds);

    return {
      prompt: finalPrompt,
      sections: retrievalResult.sections,
      resources: resolvedResources,
      variables,
      estimatedTokens,
      diagnostics,
    };
  }

  /**
   * 为 agent 构建提示词（便捷方法）
   *
   * @param agent - Agent 配置
   * @returns 构建结果
   */
  export async function buildForAgent(
    agent: AgentConfig,
    context: AgentPromptBuildContext = {}
  ): Promise<PromptBuildResult> {
    const variables: Record<string, string | number | boolean | string[]> = {
      userQuery: context.userMessage || '',
      platform: context.platform || '',
      techStack: context.techStack || [],
      __modeSource: context.contextSources?.mode || 'default',
      __platformSource: context.contextSources?.platform || 'default',
      __techStackSource: context.contextSources?.techStack || 'default',
    };

    if (context.routing?.reason) {
      variables.__routingReason = context.routing.reason;
      variables.__routingConfidence = context.routing.confidence;
      if (typeof context.routing.score === 'number') {
        variables.__routingScore = context.routing.score;
      }
      if (typeof context.routing.version === 'string') {
        variables.__routingVersion = context.routing.version;
      }
      if (typeof context.routing.language === 'string') {
        variables.__routingLanguage = context.routing.language;
      }
      if (Array.isArray(context.routing.techSignals)) {
        variables.__routingTechSignals = context.routing.techSignals;
      }
    }

    return build({
      agent,
      mode: context.mode || agent.mode,
      sections: agent.sections,
      resources: agent.resources,
      variables,
    });
  }

  /**
   * 加载核心系统提示词
   *
   * 只提取核心内容，目标 ~8K tokens
   */
  async function loadCoreSystemPrompt(): Promise<string> {
    if (coreSystemPrompt) {
      return coreSystemPrompt;
    }

    try {
      const content = await loadSystemPrompt();
      if (!content.trim()) {
        throw new Error('system prompt content is empty');
      }

      // 尝试提取核心部分（前 ~200 行或 ~8K tokens）
      const lines = content.split('\n');
      const maxLines = 200;
      const maxChars = 32000; // ~8K tokens

      let coreContent = '';
      let charCount = 0;

      for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
        const line = lines[i];
        charCount += line.length + 1; // +1 for newline

        if (charCount > maxChars) {
          break;
        }

        coreContent += line + '\n';
      }

      coreSystemPrompt = coreContent.trim();
      return coreSystemPrompt;
    } catch (error) {
      log.warn('Could not load prompt-docs system prompt', { error });
      return `# FrontendMaster AI

You are an expert frontend developer specializing in commercial-grade applications.

## Core Capabilities

- Generate production-ready code for web, mobile, desktop, and mini-programs
- Use modern frameworks: React, Next.js, Vue, React Native, Electron, UniApp
- Follow design systems and accessibility best practices (WCAG AA)
- Optimize for performance by default

## Tool Usage

Use the available design tools to get specifications:
- design_search for broad style/ux discovery
- get_design_style for design systems
- get_color_palette for color schemes
- get_typography_pair for font pairings
- get_component_list for available components

Always use tool results. Never make up design values.
`;
    }
  }

  /**
   * 清除缓存
   */
  export function clearCache(): void {
    coreSystemPrompt = null;
    log.debug('Prompt builder cache cleared');
  }

  /**
   * 获取缓存统计
   */
  export function getCacheStats(): {
    builderCache: { size: number; keys: string[] };
    hasCorePrompt: boolean;
  } {
    return {
      builderCache: {
        size: 0,
        keys: [],
      },
      hasCorePrompt: coreSystemPrompt !== null,
    };
  }
}

type LoadedResource = DesignStyle | ColorPalette | TypographyPair;

async function loadRequestedResources(resourceIds: string[]): Promise<LoadedResource[]> {
  if (!resourceIds.length) {
    return [];
  }

  const uniqueIds = [...new Set(resourceIds)];
  const resources: LoadedResource[] = [];

  if (uniqueIds.includes('design-styles')) {
    resources.push(...(await loadDesignStyles()));
  }
  if (uniqueIds.includes('color-palettes')) {
    resources.push(...(await loadColorPalettes()));
  }
  if (uniqueIds.includes('typography-pairs')) {
    resources.push(...(await loadTypographyPairs()));
  }

  return resources;
}

function createEmptySelectionDetails() {
  return {
    p0Count: 0,
    p1Count: 0,
    p2Count: 0,
    p3Count: 0,
  };
}

function countKeyFromPriority(priority: 'P0' | 'P1' | 'P2' | 'P3'): 'p0Count' | 'p1Count' | 'p2Count' | 'p3Count' {
  if (priority === 'P0') return 'p0Count';
  if (priority === 'P1') return 'p1Count';
  if (priority === 'P2') return 'p2Count';
  return 'p3Count';
}

async function buildFromExplicitSections(
  sectionIds: string[],
  excludedSectionSet: Set<string>,
  maxTokens: number
) {
  const loader = new SectionLoader();
  const selectedIds: string[] = [];
  const excludedIds: string[] = [];
  const sections: Awaited<ReturnType<SectionLoader['loadSections']>> = [];
  const selectionDetails = createEmptySelectionDetails();

  let measuredTotalTokens = 0;
  let estimatedTotalTokens = 0;

  for (const id of sectionIds) {
    if (excludedSectionSet.has(id)) {
      excludedIds.push(id);
      continue;
    }

    const section = await loader.loadSection(id);
    if (!section) {
      excludedIds.push(id);
      continue;
    }

    const metadata = getSectionMetadata(id);
    const measured = estimateTokenCount(section.content);
    const estimated = metadata?.estimatedTokens ?? measured;
    const priority = metadata?.priority || section.priority || 'P3';

    if (measuredTotalTokens + measured > maxTokens) {
      excludedIds.push(id);
      continue;
    }

    selectedIds.push(id);
    sections.push(section);
    measuredTotalTokens += measured;
    estimatedTotalTokens += estimated;
    selectionDetails[countKeyFromPriority(priority)] += 1;
  }

  const tokenDriftRatio =
    estimatedTotalTokens > 0 ? Number((measuredTotalTokens / estimatedTotalTokens).toFixed(2)) : 1;

  return {
    sections,
    selectedIds,
    excludedIds,
    budgetTotalTokens: measuredTotalTokens,
    totalTokens: measuredTotalTokens,
    estimatedTotalTokens,
    measuredTotalTokens,
    tokenDriftRatio,
    selectionDetails,
  };
}

function isSafeTemplateVariableKey(key: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(key);
}

function sanitizeTemplateVariableValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.replace(/\0/g, '').replace(/\r\n/g, '\n');
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeTemplateVariableValue(item)).join(', ');
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value).replace(/\0/g, '');
    } catch {
      return String(value).replace(/\0/g, '');
    }
  }

  return String(value).replace(/\0/g, '');
}

function applyTemplateVariables(
  template: string,
  variables: Record<string, unknown>
): string {
  const replacementMap = new Map<string, string>();

  for (const [key, value] of Object.entries(variables)) {
    if (RESERVED_TEMPLATE_VARIABLE_KEYS.has(key)) {
      continue;
    }
    if (!ALLOWED_TEMPLATE_VARIABLE_KEYS.has(key)) {
      continue;
    }
    if (!isSafeTemplateVariableKey(key)) {
      log.warn('Skipping unsafe template variable key', { key });
      continue;
    }
    replacementMap.set(key, sanitizeTemplateVariableValue(value));
  }

  return template.replace(TEMPLATE_PLACEHOLDER_PATTERN, (match, key: string) => {
    if (!replacementMap.has(key)) {
      return match;
    }
    return replacementMap.get(key) || '';
  });
}

async function buildFromRetriever(options: {
  mode: 'creator' | 'implementer';
  platform?: 'web' | 'mobile' | 'desktop' | 'miniprogram';
  techStack?: string[];
  userQuery?: string;
  maxTokens: number;
  excludedSectionSet: Set<string>;
}) {
  const retriever = new SectionRetriever();
  const base = await retriever.retrieve({
    mode: options.mode,
    platform: options.platform,
    techStack: options.techStack,
    userQuery: options.userQuery,
    maxTokens: options.maxTokens,
  });

  if (!options.excludedSectionSet.size) {
    return base;
  }

  const sections = base.sections.filter(section => !options.excludedSectionSet.has(section.id));
  const selectedIds = base.selectedIds.filter(id => !options.excludedSectionSet.has(id));
  const manuallyExcluded = base.selectedIds.filter(id => options.excludedSectionSet.has(id));
  const excludedIds = [...new Set([...base.excludedIds, ...manuallyExcluded])];
  const selectionDetails = createEmptySelectionDetails();

  let measuredTotalTokens = 0;
  let estimatedTotalTokens = 0;
  for (const section of sections) {
    const metadata = getSectionMetadata(section.id);
    const measured = estimateTokenCount(section.content);
    const estimated = metadata?.estimatedTokens ?? measured;
    const priority = metadata?.priority || section.priority || 'P3';
    measuredTotalTokens += measured;
    estimatedTotalTokens += estimated;
    selectionDetails[countKeyFromPriority(priority)] += 1;
  }

  const tokenDriftRatio =
    estimatedTotalTokens > 0 ? Number((measuredTotalTokens / estimatedTotalTokens).toFixed(2)) : 1;

  return {
    sections,
    selectedIds,
    excludedIds,
    budgetTotalTokens: measuredTotalTokens,
    totalTokens: measuredTotalTokens,
    estimatedTotalTokens,
    measuredTotalTokens,
    tokenDriftRatio,
    selectionDetails,
  };
}
