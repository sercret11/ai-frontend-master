/**
 * Section Metadata Index - Section 元数据索引
 *
 * 从 prompt-docs/index.yaml（JSON 子集）加载元数据。
 */

import * as fs from 'fs';
import * as path from 'path';
import { Log } from '../logging/log.js';

const log = Log.create({ service: 'section-index' });

type SessionMode = 'creator' | 'implementer';
type ApplicablePlatform = 'web' | 'mobile' | 'desktop' | 'miniprogram' | 'all';

/**
 * Section 元数据接口
 */
export interface SectionMetadata {
  /** Section ID（唯一） */
  id: string;
  /** Section 标题 */
  title: string;
  /** 优先级 */
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  /** 估算 token 数量 */
  estimatedTokens: number;
  /** 标签 */
  tags: string[];
  /** 适用模式 */
  applicableModes: SessionMode[];
  /** 适用平台 */
  applicablePlatforms: ApplicablePlatform[];
  /** 依赖的 section */
  dependencies: string[];
  /** 描述 */
  description?: string;
  /** 文件相对路径（相对于 prompt-docs 根目录） */
  file?: string;
}

interface PromptIndexDocument {
  version: number;
  systemPrompt?: string;
  sectionsDir?: string;
  sections: SectionMetadata[];
  techStackMap?: Record<string, string[]>;
}

const PRIORITY_ORDER: Record<SectionMetadata['priority'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

const FALLBACK_INDEX: PromptIndexDocument = {
  version: 1,
  systemPrompt: 'system/core-system.md',
  sectionsDir: '.',
  sections: [
    {
      id: 'core-identity-and-scope',
      title: 'Identity and Delivery Scope',
      priority: 'P0',
      estimatedTokens: 500,
      tags: ['core', 'identity'],
      applicableModes: ['creator', 'implementer'],
      applicablePlatforms: ['all'],
      dependencies: [],
      description: 'Fallback core identity section.',
      file: 'core/identity-and-scope.md',
    },
    {
      id: 'core-platform-capabilities',
      title: 'Platform Capabilities',
      priority: 'P0',
      estimatedTokens: 500,
      tags: ['core', 'platform'],
      applicableModes: ['creator', 'implementer'],
      applicablePlatforms: ['all'],
      dependencies: [],
      description: 'Fallback platform capability section.',
      file: 'core/platform-capabilities.md',
    },
    {
      id: 'core-mode-routing',
      title: 'Creator vs Implementer Routing',
      priority: 'P0',
      estimatedTokens: 500,
      tags: ['core', 'routing'],
      applicableModes: ['creator', 'implementer'],
      applicablePlatforms: ['all'],
      dependencies: [],
      description: 'Fallback mode routing section.',
      file: 'core/mode-routing.md',
    },
    {
      id: 'core-tool-calling-policy',
      title: 'Tool Calling Policy',
      priority: 'P0',
      estimatedTokens: 500,
      tags: ['core', 'tools'],
      applicableModes: ['creator', 'implementer'],
      applicablePlatforms: ['all'],
      dependencies: [],
      description: 'Fallback tool-calling policy section.',
      file: 'core/tool-calling-policy.md',
    },
  ],
  techStackMap: {
    react: ['platform-web-react', 'platform-web-nextjs', 'platform-web-shadcn-ui'],
    nextjs: ['platform-web-nextjs'],
    'next.js': ['platform-web-nextjs'],
    shadcn: ['platform-web-shadcn-ui'],
    'shadcn/ui': ['platform-web-shadcn-ui'],
    tailwind: ['platform-web-shadcn-ui'],
    'tailwind css': ['platform-web-shadcn-ui'],
    'react-native': ['platform-mobile-react-native'],
    uniapp: ['platform-miniprogram-uniapp'],
    'uni-app': ['platform-miniprogram-uniapp'],
    miniprogram: ['platform-miniprogram-uniapp'],
    electron: ['platform-desktop-electron'],
  },
};

const TECH_ALIASES: Record<string, string> = {
  'next js': 'next.js',
  'nextjs': 'nextjs',
  'shadcn-ui': 'shadcn/ui',
  'tailwindcss': 'tailwind css',
  'react native': 'react-native',
  'uni-app': 'uniapp',
};

function resolvePromptDocsRoot(customDir?: string): string {
  if (customDir) {
    const absolute = path.isAbsolute(customDir) ? customDir : path.resolve(process.cwd(), customDir);
    if (fs.existsSync(absolute)) {
      return absolute;
    }

    const parentRelative = path.resolve(process.cwd(), '..', customDir);
    if (fs.existsSync(parentRelative)) {
      return parentRelative;
    }
  }

  const candidates = [
    path.resolve(process.cwd(), 'prompt-docs'),
    path.resolve(process.cwd(), '../prompt-docs'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function sanitizeMetadata(input: any): SectionMetadata | null {
  if (!input || typeof input !== 'object' || typeof input.id !== 'string') {
    return null;
  }

  const priority = ['P0', 'P1', 'P2', 'P3'].includes(input.priority) ? input.priority : 'P3';
  const tags = Array.isArray(input.tags)
    ? input.tags.filter((t: unknown): t is string => typeof t === 'string')
    : [];
  const applicableModes = Array.isArray(input.applicableModes)
    ? input.applicableModes.filter((m: unknown): m is SessionMode => m === 'creator' || m === 'implementer')
    : ['creator', 'implementer'];
  const applicablePlatforms = Array.isArray(input.applicablePlatforms)
    ? input.applicablePlatforms.filter(
        (p: unknown): p is ApplicablePlatform =>
          p === 'web' || p === 'mobile' || p === 'desktop' || p === 'miniprogram' || p === 'all'
      )
    : ['all'];
  const dependencies = Array.isArray(input.dependencies)
    ? input.dependencies.filter((d: unknown): d is string => typeof d === 'string')
    : [];

  return {
    id: input.id,
    title: typeof input.title === 'string' && input.title.length > 0 ? input.title : input.id,
    priority,
    estimatedTokens:
      typeof input.estimatedTokens === 'number' && Number.isFinite(input.estimatedTokens)
        ? input.estimatedTokens
        : 500,
    tags,
    applicableModes: applicableModes.length > 0 ? applicableModes : ['creator', 'implementer'],
    applicablePlatforms: applicablePlatforms.length > 0 ? applicablePlatforms : ['all'],
    dependencies,
    description: typeof input.description === 'string' ? input.description : undefined,
    file: typeof input.file === 'string' && input.file.length > 0 ? input.file : undefined,
  };
}

function loadIndexDocument(indexPath: string): PromptIndexDocument {
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Prompt index not found: ${indexPath}`);
  }

  const raw = fs.readFileSync(indexPath, 'utf-8').replace(/^\uFEFF/, '');
  let parsed: PromptIndexDocument;

  try {
    parsed = JSON.parse(raw) as PromptIndexDocument;
  } catch (error) {
    log.error('Failed to parse prompt-docs index', { indexPath, error });
    throw new Error(`Prompt index is not valid JSON: ${indexPath}`);
  }

  const sections = Array.isArray(parsed.sections)
    ? parsed.sections.map(sanitizeMetadata).filter((s): s is SectionMetadata => s !== null)
    : [];

  if (sections.length === 0) {
    throw new Error(`Prompt index contains no valid sections: ${indexPath}`);
  }

  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    systemPrompt:
      typeof parsed.systemPrompt === 'string' && parsed.systemPrompt.length > 0
        ? parsed.systemPrompt
        : FALLBACK_INDEX.systemPrompt,
    sectionsDir:
      typeof parsed.sectionsDir === 'string' && parsed.sectionsDir.length > 0
        ? parsed.sectionsDir
        : FALLBACK_INDEX.sectionsDir,
    sections,
    techStackMap: parsed.techStackMap || FALLBACK_INDEX.techStackMap,
  };
}

export const PROMPT_DOCS_ROOT = resolvePromptDocsRoot();
export const PROMPT_INDEX_PATH = path.join(PROMPT_DOCS_ROOT, 'index.yaml');

const INDEX_DOCUMENT = loadIndexDocument(PROMPT_INDEX_PATH);

export const SECTION_INDEX: Record<string, SectionMetadata> = Object.fromEntries(
  INDEX_DOCUMENT.sections.map(section => [section.id, section])
);

const TECH_STACK_MAP: Record<string, string[]> = INDEX_DOCUMENT.techStackMap || {};

export function getPromptDocsRoot(): string {
  return PROMPT_DOCS_ROOT;
}

export function getPromptIndexPath(): string {
  return PROMPT_INDEX_PATH;
}

export function getSystemPromptPath(): string {
  const relativeSystemPath = INDEX_DOCUMENT.systemPrompt || 'system/core-system.md';
  const preferred = path.resolve(PROMPT_DOCS_ROOT, relativeSystemPath);

  if (fs.existsSync(preferred)) {
    return preferred;
  }

  throw new Error(`System prompt file not found in prompt-docs: ${preferred}`);
}

export function getSectionMetadata(sectionId: string): SectionMetadata | undefined {
  return SECTION_INDEX[sectionId];
}

export function getAllSectionMetadata(): SectionMetadata[] {
  return Object.values(SECTION_INDEX);
}

export function getSectionsByPriority(priority: 'P0' | 'P1' | 'P2' | 'P3'): SectionMetadata[] {
  return Object.values(SECTION_INDEX)
    .filter(s => s.priority === priority)
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens);
}

export function getSectionsByMode(mode: SessionMode): SectionMetadata[] {
  return Object.values(SECTION_INDEX)
    .filter(s => s.applicableModes.includes(mode))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

export function getSectionsByPlatform(
  platform: 'web' | 'mobile' | 'desktop' | 'miniprogram'
): SectionMetadata[] {
  return Object.values(SECTION_INDEX)
    .filter(s => s.applicablePlatforms.includes(platform) || s.applicablePlatforms.includes('all'))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

export function getSectionsByTechStack(tech: string): SectionMetadata[] {
  const normalized = tech.toLowerCase().trim();
  const key = TECH_ALIASES[normalized] || normalized;
  const sectionIds = TECH_STACK_MAP[key] || TECH_STACK_MAP[normalized] || [];

  if (sectionIds.length > 0) {
    return sectionIds
      .map(id => SECTION_INDEX[id])
      .filter((section): section is SectionMetadata => section !== undefined);
  }

  return Object.values(SECTION_INDEX).filter(section =>
    section.tags.some(tag => tag.toLowerCase() === key || tag.toLowerCase().includes(key))
  );
}

export function searchSectionsByTags(tags: string[]): SectionMetadata[] {
  const lowerTags = tags.map(t => t.toLowerCase());

  return Object.values(SECTION_INDEX)
    .filter(section => lowerTags.some(tag => section.tags.some(s => s.toLowerCase().includes(tag))))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

export function estimateTokensForSections(sectionIds: string[]): number {
  return sectionIds.reduce((total, id) => total + (SECTION_INDEX[id]?.estimatedTokens || 0), 0);
}
