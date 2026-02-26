import type {
  ApiSignature,
  ExternalDependencyChecklist,
  MinimalSnippet,
  ResearchDigest,
  SourceRef,
  VersionHint,
} from './types';
import {
  fetchResearchDigestFromContext7Mcp,
  type Context7McpOptions,
} from './context7-mcp-client';

export interface RunResearchAgentOptions {
  mcpUrl?: string;
  mcpApiKey?: string;
  timeoutMs?: number;
}

interface LibraryResearchPreset {
  framework: string;
  official: SourceRef[];
  community: SourceRef[];
  fallbackMajorVersion: string;
  signatures: Array<{
    symbol: string;
    signature: string;
  }>;
  snippet: {
    title: string;
    code: string;
  };
}

const PRESETS: Record<string, LibraryResearchPreset> = {
  'next.js': {
    framework: 'next.js',
    official: [
      {
        url: 'https://nextjs.org/docs',
        title: 'Next.js Documentation',
        sourceType: 'official',
        confidence: 'high',
      },
    ],
    community: [
      {
        url: 'https://github.com/vercel/next.js/discussions',
        title: 'Next.js Discussions',
        sourceType: 'community',
        confidence: 'medium',
      },
      {
        url: 'https://stackoverflow.com/questions/tagged/next.js',
        title: 'StackOverflow Next.js',
        sourceType: 'community',
        confidence: 'medium',
      },
    ],
    fallbackMajorVersion: '15',
    signatures: [
      { symbol: 'generateMetadata', signature: 'generateMetadata(props): Promise<Metadata>' },
      { symbol: 'revalidatePath', signature: 'revalidatePath(path: string, type?: "page" | "layout"): void' },
    ],
    snippet: {
      title: 'Server Component data loading',
      code: `export default async function Page() {
  const data = await fetch("https://example.com/api", { cache: "no-store" }).then(r => r.json());
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}`,
    },
  },
  react: {
    framework: 'react',
    official: [
      {
        url: 'https://react.dev/reference/react',
        title: 'React Reference',
        sourceType: 'official',
        confidence: 'high',
      },
    ],
    community: [
      {
        url: 'https://github.com/reactjs/rfcs',
        title: 'React RFCs',
        sourceType: 'community',
        confidence: 'medium',
      },
      {
        url: 'https://stackoverflow.com/questions/tagged/reactjs',
        title: 'StackOverflow React',
        sourceType: 'community',
        confidence: 'medium',
      },
    ],
    fallbackMajorVersion: '18',
    signatures: [
      { symbol: 'useEffect', signature: 'useEffect(effect: EffectCallback, deps?: DependencyList): void' },
      { symbol: 'useMemo', signature: 'useMemo<T>(factory: () => T, deps: DependencyList): T' },
    ],
    snippet: {
      title: 'Memoized derived state',
      code: `const visibleItems = useMemo(() => {
  return items.filter(item => item.visible);
}, [items]);`,
    },
  },
  zustand: {
    framework: 'zustand',
    official: [
      {
        url: 'https://zustand.docs.pmnd.rs/apis/create',
        title: 'Zustand create API',
        sourceType: 'official',
        confidence: 'high',
      },
    ],
    community: [
      {
        url: 'https://github.com/pmndrs/zustand/discussions',
        title: 'Zustand Discussions',
        sourceType: 'community',
        confidence: 'medium',
      },
      {
        url: 'https://stackoverflow.com/questions/tagged/zustand',
        title: 'StackOverflow Zustand',
        sourceType: 'community',
        confidence: 'medium',
      },
    ],
    fallbackMajorVersion: '4',
    signatures: [
      { symbol: 'create', signature: 'create<State>(creator: StateCreator<State>): UseBoundStore<StoreApi<State>>' },
    ],
    snippet: {
      title: 'Store skeleton',
      code: `import { create } from "zustand";

type CounterStore = { count: number; inc: () => void };
export const useCounterStore = create<CounterStore>((set) => ({
  count: 0,
  inc: () => set((state) => ({ count: state.count + 1 })),
}));`,
    },
  },
  tailwindcss: {
    framework: 'tailwindcss',
    official: [
      {
        url: 'https://tailwindcss.com/docs',
        title: 'Tailwind CSS Docs',
        sourceType: 'official',
        confidence: 'high',
      },
    ],
    community: [
      {
        url: 'https://github.com/tailwindlabs/tailwindcss/discussions',
        title: 'Tailwind Discussions',
        sourceType: 'community',
        confidence: 'medium',
      },
      {
        url: 'https://stackoverflow.com/questions/tagged/tailwind-css',
        title: 'StackOverflow Tailwind CSS',
        sourceType: 'community',
        confidence: 'medium',
      },
    ],
    fallbackMajorVersion: '3',
    signatures: [
      { symbol: 'className', signature: 'className: string (utility-first composition)' },
    ],
    snippet: {
      title: 'Responsive utility composition',
      code: `<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
  <section className="rounded-lg border p-4 shadow-sm">Card</section>
</div>`,
    },
  },
};

function detectMajorVersion(content: string, framework: string): string | undefined {
  const escaped = framework.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`${escaped}\\s*(?:v|version)?\\s*(\\d+)`, 'i'));
  return match?.[1];
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AI-Frontend-Master ResearchAgent/1.0',
      },
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text.slice(0, 50_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function dedupeSourceRefs(items: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const result: SourceRef[] = [];
  for (const item of items) {
    const key = `${item.sourceType}:${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function ensureSourceRefs(signature: ApiSignature, fallbackRefs: SourceRef[]): ApiSignature {
  if (signature.sourceRefs.length > 0) {
    return signature;
  }
  return {
    ...signature,
    sourceRefs: fallbackRefs.slice(0, 1),
  };
}

async function fetchContext7DigestFromMcp(
  dependencies: ExternalDependencyChecklist[],
  options: RunResearchAgentOptions
): Promise<ResearchDigest | null> {
  const mcpOptions: Context7McpOptions = {
    mcpUrl: options.mcpUrl,
    mcpApiKey: options.mcpApiKey,
    timeoutMs: options.timeoutMs,
  };
  return fetchResearchDigestFromContext7Mcp(dependencies, mcpOptions);
}

export async function runResearchAgent(
  dependencies: ExternalDependencyChecklist[],
  options: RunResearchAgentOptions = {}
): Promise<ResearchDigest> {
  const context7Digest = await fetchContext7DigestFromMcp(dependencies, options);
  if (context7Digest) {
    return {
      ...context7Digest,
      summary: context7Digest.summary.includes('source=context7')
        ? context7Digest.summary
        : `source=context7; ${context7Digest.summary}`,
    };
  }

  const apiSignatures: ApiSignature[] = [];
  const snippets: MinimalSnippet[] = [];
  const versionHints: VersionHint[] = [];
  const sourceRefs: SourceRef[] = [];

  for (const dependency of dependencies) {
    const key = dependency.framework.toLowerCase();
    const preset = PRESETS[key];
    if (!preset) {
      continue;
    }

    const refs = dedupeSourceRefs([...preset.official, ...preset.community]);
    sourceRefs.push(...refs);

    let majorVersion = preset.fallbackMajorVersion;
    const officialText = await fetchText(preset.official[0].url);
    if (officialText) {
      majorVersion = detectMajorVersion(officialText, preset.framework) || majorVersion;
    }

    const scopedRefs = refs.slice(0, 2);
    for (const item of preset.signatures) {
      const signature: ApiSignature = {
        library: preset.framework,
        symbol: item.symbol,
        signature: item.signature,
        sourceRefs: scopedRefs.slice(0, 1),
      };
      apiSignatures.push(ensureSourceRefs(signature, scopedRefs));
    }

    snippets.push({
      library: preset.framework,
      title: preset.snippet.title,
      code: preset.snippet.code,
      sourceRefs: scopedRefs,
    });

    versionHints.push({
      framework: preset.framework,
      majorVersion,
      confidence: officialText ? 'high' : 'medium',
      sourceRefs: scopedRefs.slice(0, 1),
    });
  }

  const dedupedRefs = dedupeSourceRefs(sourceRefs);
  const summary = [
    'source=preset',
    `deps=${dependencies.length}`,
    `apiSignatures=${apiSignatures.length}`,
    `snippets=${snippets.length}`,
    `versionHints=${versionHints.map(item => `${item.framework}@${item.majorVersion}`).join(',')}`,
  ].join('; ');

  return {
    generatedAt: Date.now(),
    dependencies,
    apiSignatures: apiSignatures.map(item => ensureSourceRefs(item, dedupedRefs)),
    snippets,
    versionHints,
    sourceRefs: dedupedRefs,
    summary,
  };
}

export function formatResearchDigest(digest: ResearchDigest): string {
  const lines: string[] = [];
  lines.push(`[ResearchDigest] generatedAt=${digest.generatedAt}; ${digest.summary}`);
  lines.push('VersionAnchors:');
  for (const item of digest.versionHints) {
    lines.push(`- ${item.framework} ${item.majorVersion} (confidence=${item.confidence})`);
  }
  lines.push('ApiSignatures:');
  for (const item of digest.apiSignatures.slice(0, 15)) {
    const firstRef = item.sourceRefs[0];
    lines.push(`- [${item.library}] ${item.symbol}: ${item.signature}`);
    if (firstRef) {
      lines.push(`  source=${firstRef.url}`);
    }
  }
  lines.push('Snippets:');
  for (const item of digest.snippets.slice(0, 6)) {
    lines.push(`- [${item.library}] ${item.title}`);
    lines.push('```ts');
    lines.push(item.code);
    lines.push('```');
  }
  return lines.join('\n');
}
