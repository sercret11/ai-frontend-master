/**
 * Unified prompt router for creator/implementer mode detection.
 *
 * This module is the single routing source-of-truth used by runtime routing
 * and prompt-context routing.
 */

import type {
  AgentDetectionParams,
  AgentDetectionResult,
  ClarificationTask,
  InputLanguage,
  ModeRouterAnalysis,
  RouteDecisionTrace,
  SessionMode,
  UiLibrarySelection,
  UserInputAnalysis,
} from '@ai-frontend/shared-types';

const ROUTER_VERSION = 'router-v3';
const MODE_THRESHOLD = 40;

const CJK_CHAR_REGEX =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const LATIN_WORD_REGEX = /[A-Za-z0-9][A-Za-z0-9+.#/_-]*/g;

interface NamedPattern {
  name: string;
  patterns: RegExp[];
}

const PLATFORM_PATTERNS: NamedPattern[] = [
  { name: 'web', patterns: [/\bweb\b/i, /\bwebsite\b/i, /\bh5\b/i, /网页|网站|前端/i] },
  {
    name: 'mobile',
    patterns: [/\bmobile\b/i, /\bios\b/i, /\bandroid\b/i, /\bapp\b/i, /移动端|手机端/i],
  },
  {
    name: 'desktop',
    patterns: [/\bdesktop\b/i, /\belectron\b/i, /\btauri\b/i, /桌面端|客户端/i],
  },
  {
    name: 'miniprogram',
    patterns: [/\bmini-?program\b/i, /\bwechat\b/i, /\buni-?app\b/i, /小程序|微信/i],
  },
];

const FRAMEWORK_PATTERNS: NamedPattern[] = [
  { name: 'nextjs', patterns: [/\bnext\.?js\b/i, /\bnextjs\b/i] },
  { name: 'react', patterns: [/\breact\b/i] },
  { name: 'vue', patterns: [/\bvue(?:\s*3)?\b/i] },
  { name: 'angular', patterns: [/\bangular\b/i] },
  { name: 'svelte', patterns: [/\bsvelte\b/i] },
  { name: 'nuxt', patterns: [/\bnuxt\b/i] },
  { name: 'react-native', patterns: [/\breact\s*native\b/i, /\brn\b/i] },
  { name: 'uniapp', patterns: [/\buni-?app\b/i, /小程序/i] },
  { name: 'electron', patterns: [/\belectron\b/i] },
];

const UI_LIBRARY_PATTERNS: NamedPattern[] = [
  { name: 'shadcn', patterns: [/\bshadcn\/ui\b/i, /\bshadcn\b/i] },
  { name: 'antd', patterns: [/\bant\s*design\b/i, /\bantd\b/i] },
  { name: 'mui', patterns: [/\bmaterial\s*ui\b/i, /\bmui\b/i, /@mui\//i] },
  { name: 'chakra-ui', patterns: [/\bchakra\s*ui\b/i, /@chakra-ui\//i] },
  { name: 'mantine', patterns: [/\bmantine\b/i] },
  { name: 'bootstrap', patterns: [/\bbootstrap\b/i] },
  { name: 'tailwind', patterns: [/\btailwind(?:css)?\b/i] },
  { name: 'element-plus', patterns: [/\belement\s*plus\b/i, /element-plus/i] },
  { name: 'vuetify', patterns: [/\bvuetify\b/i] },
  { name: 'naive-ui', patterns: [/\bnaive\s*ui\b/i, /\bnaive-ui\b/i] },
  { name: 'quasar', patterns: [/\bquasar\b/i] },
  { name: 'uview', patterns: [/\buview\b/i, /\buview-?plus\b/i] },
  { name: 'ng-zorro', patterns: [/\bng-zorro\b/i, /\bnz-zorro\b/i] },
  { name: 'angular-material', patterns: [/\bangular\s*material\b/i] },
  { name: 'react-native-paper', patterns: [/\breact-native-paper\b/i] },
  { name: 'native-base', patterns: [/\bnative-base\b/i, /\bnativebase\b/i] },
];

const STYLE_PATTERNS: NamedPattern[] = [
  { name: 'tailwind', patterns: [/\btailwind\b/i, /\btailwindcss\b/i, /\btailwind css\b/i] },
  { name: 'shadcn', patterns: [/\bshadcn\/ui\b/i, /\bshadcn\b/i] },
  { name: 'scss', patterns: [/\bscss\b/i, /\bsass\b/i] },
  { name: 'bootstrap', patterns: [/\bbootstrap\b/i] },
  { name: 'css-in-js', patterns: [/\bstyled-?components\b/i, /\bemotion\b/i] },
];

const FRAMEWORK_ALIASES: Record<string, string> = {
  'next.js': 'nextjs',
  next: 'nextjs',
  nextjs: 'nextjs',
  react: 'react',
  vue: 'vue',
  nuxt: 'nuxt',
  angular: 'angular',
  svelte: 'svelte',
  'react-native': 'react-native',
  rn: 'react-native',
  uniapp: 'uniapp',
  'uni-app': 'uniapp',
  electron: 'electron',
};

const UI_LIBRARY_ALIASES: Record<string, string> = {
  shadcn: 'shadcn',
  'shadcn/ui': 'shadcn',
  'shadcn-ui': 'shadcn',
  antd: 'antd',
  'ant-design': 'antd',
  mui: 'mui',
  materialui: 'mui',
  'material-ui': 'mui',
  'chakra-ui': 'chakra-ui',
  chakrui: 'chakra-ui',
  mantine: 'mantine',
  bootstrap: 'bootstrap',
  tailwind: 'tailwind',
  tailwindcss: 'tailwind',
  'element-plus': 'element-plus',
  elementplus: 'element-plus',
  vuetify: 'vuetify',
  'naive-ui': 'naive-ui',
  naiveui: 'naive-ui',
  quasar: 'quasar',
  uview: 'uview',
  'uview-plus': 'uview',
  'ng-zorro': 'ng-zorro',
  'angular-material': 'angular-material',
  'react-native-paper': 'react-native-paper',
  'native-base': 'native-base',
};

const FRAMEWORK_UI_COMPATIBILITY: Record<string, string[]> = {
  nextjs: ['shadcn', 'antd', 'mui', 'chakra-ui', 'mantine', 'bootstrap', 'tailwind'],
  react: ['shadcn', 'antd', 'mui', 'chakra-ui', 'mantine', 'bootstrap', 'tailwind'],
  vue: ['element-plus', 'vuetify', 'naive-ui', 'quasar', 'bootstrap', 'tailwind'],
  nuxt: ['element-plus', 'vuetify', 'naive-ui', 'quasar', 'bootstrap', 'tailwind'],
  angular: ['angular-material', 'ng-zorro', 'bootstrap', 'tailwind'],
  svelte: ['tailwind', 'bootstrap'],
  'react-native': ['react-native-paper', 'native-base'],
  uniapp: ['uview'],
};

const FRAMEWORK_DEFAULT_UI_LIBRARY: Record<string, string> = {
  nextjs: 'shadcn',
  react: 'shadcn',
  vue: 'element-plus',
  nuxt: 'element-plus',
  angular: 'angular-material',
  'react-native': 'react-native-paper',
  uniapp: 'uview',
};

const IMPLEMENTATION_INTENT_REGEX =
  /\b(implement|implementation|refactor|debug|fix|bug|test|testing|unit test|integration test|e2e|code changes?|coding)\b|开发|实现|重构|调试|修复|测试|改代码|改动代码|排错|报错/i;

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeMessage(message: string): string {
  return message.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function canonicalizeFramework(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim().replace(/\s+/g, '-');
  return FRAMEWORK_ALIASES[normalized] || FRAMEWORK_ALIASES[normalized.replace(/\./g, '')];
}

function canonicalizeUiLibrary(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/\//g, '-');
  return UI_LIBRARY_ALIASES[normalized] || UI_LIBRARY_ALIASES[normalized.replace(/-+/g, '')];
}

function collectSignals(message: string, list: NamedPattern[]): string[] {
  const signals: string[] = [];
  for (const item of list) {
    if (item.patterns.some(pattern => pattern.test(message))) {
      signals.push(item.name);
    }
  }
  return signals;
}

function estimateWordUnits(message: string): number {
  if (!message.trim()) return 0;

  const cjkCount = message.match(CJK_CHAR_REGEX)?.length || 0;
  const latinWordCount = message.match(LATIN_WORD_REGEX)?.length || 0;
  return cjkCount + latinWordCount;
}

function detectLanguage(message: string): InputLanguage {
  const hasCjk = (message.match(CJK_CHAR_REGEX)?.length || 0) > 0;
  const hasLatin = (message.match(/[A-Za-z]/g)?.length || 0) > 0;

  if (hasCjk && hasLatin) return 'mixed';
  if (hasCjk) return 'zh';
  if (hasLatin) return 'en';
  return 'unknown';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mergeDetectionSignals(
  params: AgentDetectionParams,
  analysis: UserInputAnalysis
): {
  merged: UserInputAnalysis;
  explicitSignals: string[];
  preferredFramework?: string;
  preferredUiLibrary?: string;
} {
  const explicitSignals: string[] = [];

  const hasPRD = analysis.hasPRD || params.hasPRD;
  const hasTechStack = analysis.hasTechStack || params.hasTechStack;
  const hasFigma = analysis.hasFigma || params.hasFigma;
  const hasDetailedRequirements = analysis.hasDetailedRequirements || params.hasDetailedRequirements;
  const hasBusinessContext = analysis.hasBusinessContext || params.hasBusinessContext;

  if (params.hasPRD) explicitSignals.push('hasPRD');
  if (params.hasTechStack) explicitSignals.push('hasTechStack');
  if (params.hasFigma) explicitSignals.push('hasFigma');
  if (params.hasDetailedRequirements) explicitSignals.push('hasDetailedRequirements');
  if (params.hasBusinessContext) explicitSignals.push('hasBusinessContext');

  const preferredFramework = canonicalizeFramework(params.preferredFramework);
  const preferredUiLibrary = canonicalizeUiLibrary(params.preferredUiLibrary);
  if (preferredFramework) explicitSignals.push(`framework:${preferredFramework}`);
  if (preferredUiLibrary) explicitSignals.push(`ui-library:${preferredUiLibrary}`);

  return {
    merged: {
      ...analysis,
      hasPRD,
      hasTechStack,
      hasFigma,
      hasDetailedRequirements,
      hasBusinessContext,
    },
    explicitSignals,
    preferredFramework,
    preferredUiLibrary,
  };
}

function resolvePrimaryFramework(
  preferredFramework: string | undefined,
  detectedFrameworks: string[]
): string | undefined {
  if (preferredFramework) {
    return preferredFramework;
  }
  for (const framework of detectedFrameworks) {
    const normalized = canonicalizeFramework(framework);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function buildUiLibrarySelection(input: {
  preferredUiLibrary?: string;
  detectedUiLibraries: string[];
  detectedStyles: string[];
  framework?: string;
}): UiLibrarySelection {
  if (input.preferredUiLibrary) {
    return {
      library: input.preferredUiLibrary,
      source: 'explicit',
      framework: input.framework,
      compatible: true,
      reason: `explicit ui library provided: ${input.preferredUiLibrary}`,
    };
  }

  if (input.detectedUiLibraries.length > 0) {
    return {
      library: canonicalizeUiLibrary(input.detectedUiLibraries[0]) || input.detectedUiLibraries[0],
      source: 'explicit',
      framework: input.framework,
      compatible: true,
      reason: `ui library keyword detected: ${input.detectedUiLibraries.join(',')}`,
    };
  }

  const inferredFromStyle = input.detectedStyles.find(style =>
    ['tailwind', 'bootstrap'].includes(style)
  );
  if (inferredFromStyle) {
    return {
      library: inferredFromStyle,
      source: 'inferred',
      framework: input.framework,
      compatible: true,
      reason: `inferred from style tokens: ${inferredFromStyle}`,
    };
  }

  if (input.framework && FRAMEWORK_DEFAULT_UI_LIBRARY[input.framework]) {
    const fallback = FRAMEWORK_DEFAULT_UI_LIBRARY[input.framework];
    return {
      library: fallback,
      source: 'default',
      framework: input.framework,
      compatible: true,
      reason: `use framework default library for ${input.framework}`,
    };
  }

  return {
    library: null,
    source: 'none',
    framework: input.framework,
    compatible: true,
    reason: 'no ui library selected',
  };
}

function evaluateCompatibility(
  framework: string | undefined,
  uiLibrary: string | null
): { compatible: boolean; reason: string; suggestions: string[] } {
  if (!framework || !uiLibrary) {
    return {
      compatible: true,
      reason: 'missing framework or ui library, skip compatibility guard',
      suggestions: [],
    };
  }

  const allowed = FRAMEWORK_UI_COMPATIBILITY[framework];
  if (!allowed || allowed.includes(uiLibrary)) {
    return {
      compatible: true,
      reason: `framework=${framework} supports ui-library=${uiLibrary}`,
      suggestions: [],
    };
  }

  const suggestions = allowed.slice(0, 4);
  return {
    compatible: false,
    reason: `framework=${framework} is incompatible with ui-library=${uiLibrary}`,
    suggestions,
  };
}

export namespace ModeRouter {
  export const version = ROUTER_VERSION;

  export function extractAnalysis(userMessage: string): UserInputAnalysis {
    const normalized = normalizeMessage(userMessage);
    const platforms = collectSignals(normalized, PLATFORM_PATTERNS);
    const frameworks = collectSignals(normalized, FRAMEWORK_PATTERNS);
    const uiLibraries = collectSignals(normalized, UI_LIBRARY_PATTERNS);
    const styles = collectSignals(normalized, STYLE_PATTERNS);

    const hasTechStack =
      frameworks.length > 0 ||
      styles.length > 0 ||
      uiLibraries.length > 0 ||
      /\btypescript\b|\bjavascript\b|\bnode\.?js\b|\bts\b|\bjs\b/i.test(normalized);

    return {
      wordCount: estimateWordUnits(normalized),
      hasPRD: /\bprd\b|\brequirements?\b|specification|functional spec|需求文档|需求说明|规格说明/i.test(
        normalized
      ),
      hasFigma: /\bfigma\b|design file|sketch|adobe xd|设计稿|原型图/i.test(normalized),
      hasTechStack,
      hasStyleReference:
        /\bdesign system\b|\bmaterial\b|\bant design\b|style:|风格|样式|视觉规范/i.test(
          normalized
        ) || styles.length > 0,
      hasDetailedRequirements:
        /must have|should include|features?:|functionality:|requirements?:|user stories|必须|需要|功能列表|页面清单/i.test(
          normalized
        ) || estimateWordUnits(normalized) >= 80,
      hasBusinessContext:
        /\bsaas\b|\becommerce\b|\bstartup\b|\bproduct\b|\bbusiness\b|\bcompany\b|业务|公司|产品|电商|医院|教育/i.test(
          normalized
        ),
      hasImplementationIntent: IMPLEMENTATION_INTENT_REGEX.test(normalized),
      platforms: uniq(platforms),
      frameworks: uniq(frameworks),
      uiLibraries: uniq(uiLibraries.map(item => canonicalizeUiLibrary(item) || item)),
      styles: uniq(styles),
    };
  }

  export function analyze(input: UserInputAnalysis): ModeRouterAnalysis {
    let score = 0;
    const details = {
      wordCountScore: 0,
      prdScore: 0,
      figmaScore: 0,
      techStackScore: 0,
      styleReferenceScore: 0,
      detailedRequirementsScore: 0,
      businessContextScore: 0,
      implementationIntentScore: 0,
    };

    if (input.wordCount < 8) {
      details.wordCountScore = 0;
    } else if (input.wordCount < 30) {
      details.wordCountScore = 5;
    } else if (input.wordCount < 120) {
      details.wordCountScore = 10;
    } else {
      details.wordCountScore = 20;
    }
    score += details.wordCountScore;

    if (input.hasPRD) {
      details.prdScore = 25;
      score += details.prdScore;
    }

    if (input.hasFigma) {
      details.figmaScore = 15;
      score += details.figmaScore;
    }

    if (input.hasTechStack) {
      details.techStackScore = 15;
      score += details.techStackScore;
    }

    if (input.hasStyleReference) {
      details.styleReferenceScore = 10;
      score += details.styleReferenceScore;
    }

    if (input.hasDetailedRequirements) {
      details.detailedRequirementsScore = 10;
      score += details.detailedRequirementsScore;
    }

    if (input.hasBusinessContext) {
      details.businessContextScore = 5;
      score += details.businessContextScore;
    }

    if (input.hasImplementationIntent) {
      details.implementationIntentScore = 35;
      score += details.implementationIntentScore;
    }

    const normalizedScore = clamp(score, 0, 100);
    const mode: SessionMode = normalizedScore >= MODE_THRESHOLD ? 'implementer' : 'creator';
    const confidence = clamp(55 + Math.abs(normalizedScore - MODE_THRESHOLD), 55, 95);

    return {
      score: normalizedScore,
      mode,
      confidence,
      details,
    };
  }

  export function detectAgent(params: AgentDetectionParams): AgentDetectionResult {
    const extractedAnalysis = extractAnalysis(params.userQuery);
    const {
      merged: analysis,
      explicitSignals,
      preferredFramework,
      preferredUiLibrary,
    } = mergeDetectionSignals(params, extractedAnalysis);
    const result = analyze(analysis);
    const mode = result.mode;
    const agentId = mode === 'creator' ? 'frontend-creator' : 'frontend-implementer';
    const language = detectLanguage(params.userQuery);
    const framework = resolvePrimaryFramework(preferredFramework, analysis.frameworks || []);
    const uiLibrarySelection = buildUiLibrarySelection({
      preferredUiLibrary,
      detectedUiLibraries: analysis.uiLibraries || [],
      detectedStyles: analysis.styles || [],
      framework,
    });
    const compatibility = evaluateCompatibility(framework, uiLibrarySelection.library);
    const enrichedUiLibrarySelection: UiLibrarySelection = {
      ...uiLibrarySelection,
      compatible: compatibility.compatible,
      reason: compatibility.reason,
    };

    const decisionTrace: RouteDecisionTrace[] = [
      {
        step: 'analysis.extract',
        detail: `wordUnits=${analysis.wordCount}, frameworks=${(analysis.frameworks || []).join(',') || 'none'}, uiLibraries=${(analysis.uiLibraries || []).join(',') || 'none'}`,
        evidence: [
          `hasPRD=${analysis.hasPRD}`,
          `hasTechStack=${analysis.hasTechStack}`,
          `hasImplementationIntent=${analysis.hasImplementationIntent}`,
        ],
      },
      {
        step: 'mode.detect',
        detail: `mode=${mode}, score=${result.score}, threshold=${MODE_THRESHOLD}`,
      },
      {
        step: 'ui.select',
        detail: `framework=${framework || 'unknown'}, ui=${enrichedUiLibrarySelection.library || 'none'}, source=${enrichedUiLibrarySelection.source}`,
      },
      {
        step: 'ui.compatibility',
        detail: compatibility.reason,
        evidence: compatibility.suggestions.length > 0 ? compatibility.suggestions : undefined,
      },
      {
        step: 'route.final',
        detail: `agent=${agentId}, blocked=${!compatibility.compatible}`,
      },
    ];

    let clarificationTask: ClarificationTask | undefined;
    if (!compatibility.compatible && framework && enrichedUiLibrarySelection.library) {
      clarificationTask = {
        required: true,
        message: `UI library "${enrichedUiLibrarySelection.library}" is not compatible with framework "${framework}". Please confirm library or framework.`,
        conflict: {
          framework,
          uiLibrary: enrichedUiLibrarySelection.library,
        },
        suggestions: compatibility.suggestions,
      };
    }

    const techSignals = uniq([
      ...(analysis.platforms || []),
      ...(analysis.frameworks || []),
      ...(analysis.uiLibraries || []),
      ...(analysis.styles || []),
    ]);

    const reasons: string[] = [
      `router=${ROUTER_VERSION}`,
      `score=${result.score}/${MODE_THRESHOLD}`,
      `language=${language}`,
      mode === 'creator'
        ? 'information density is lower, choose creator mode'
        : 'information density is higher, choose implementer mode',
    ];

    if (framework) {
      reasons.push(`framework=${framework}`);
    }
    if (enrichedUiLibrarySelection.library) {
      reasons.push(
        `ui-library=${enrichedUiLibrarySelection.library} source=${enrichedUiLibrarySelection.source} compatible=${enrichedUiLibrarySelection.compatible}`
      );
    }
    if (techSignals.length > 0) {
      reasons.push(`tech-signals=${techSignals.join(',')}`);
    }
    if (explicitSignals.length > 0) {
      reasons.push(`explicit-signals=${explicitSignals.join(',')}`);
    }
    if (clarificationTask?.required) {
      reasons.push('clarification-required=true');
    }

    return {
      agentId,
      confidence: result.confidence,
      score: result.score,
      reasons,
      mode,
      version: ROUTER_VERSION,
      language,
      techSignals,
      framework,
      uiLibrarySelection: enrichedUiLibrarySelection,
      decisionTrace,
      clarificationTask,
      blocked: Boolean(clarificationTask?.required),
    };
  }

  export function explainRouting(analysis: ModeRouterAnalysis): string {
    const lines: string[] = [];
    lines.push(`**Router Version:** ${ROUTER_VERSION}`);
    lines.push(`**Total Score:** ${analysis.score}/100`);
    lines.push(`**Threshold:** ${MODE_THRESHOLD}`);
    lines.push(`**Recommended Mode:** ${analysis.mode.toUpperCase()}`);
    lines.push(`**Confidence:** ${analysis.confidence}%`);
    lines.push('');
    lines.push('**Score Breakdown:**');
    lines.push(`- Word Count: ${analysis.details.wordCountScore}`);
    lines.push(`- PRD Present: ${analysis.details.prdScore}`);
    lines.push(`- Figma Present: ${analysis.details.figmaScore}`);
    lines.push(`- Tech Stack: ${analysis.details.techStackScore}`);
    lines.push(`- Style Reference: ${analysis.details.styleReferenceScore}`);
    lines.push(`- Detailed Requirements: ${analysis.details.detailedRequirementsScore}`);
    lines.push(`- Business Context: ${analysis.details.businessContextScore}`);
    lines.push(`- Implementation Intent: ${analysis.details.implementationIntentScore}`);
    return lines.join('\n');
  }
}
