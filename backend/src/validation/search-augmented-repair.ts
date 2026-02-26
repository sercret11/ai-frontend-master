import type { ParsedError } from '@ai-frontend/shared-types';

export interface SearchHint {
  title: string;
  url: string;
  sourceType: 'official' | 'community';
  confidence: 'high' | 'medium' | 'low';
  excerpt?: string;
  score: number;
  hostname: string;
}

export interface SearchCandidate {
  title: string;
  url: string;
  sourceType: 'official' | 'community';
}

export interface VisualDiffBundleRef {
  baselineImage?: string;
  currentImage?: string;
  diffImage?: string;
  hotspotHint?: string;
  domContext?: string;
}

export interface SearchAugmentedRepairOptions {
  allowedDomains?: string[];
  fetchExcerptFn?: (url: string) => Promise<string | undefined>;
  candidates?: SearchCandidate[];
  visualDiffBundleRef?: VisualDiffBundleRef;
  maxVisualPayloadChars?: number;
}

interface RankedCandidate {
  candidate: SearchCandidate;
  hostname: string;
  domainPriority: number;
}

function buildQuery(errors: ParsedError[], visualSummary?: string): string {
  const tail = errors
    .slice(0, 3)
    .map(error => (error.raw || error.message || '').split('\n').slice(-2).join(' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const visualToken = visualSummary ? ` ${visualSummary}` : '';
  return `${tail}${visualToken}`.trim().slice(0, 260);
}

async function fetchExcerpt(url: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AI-Frontend-Master SearchRepair/1.0',
      },
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    return text.replace(/\s+/g, ' ').slice(0, 400);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDomain(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.endsWith('.') ? normalized.slice(0, -1) : normalized;
}

function normalizeAllowedDomains(allowedDomains: string[]): string[] {
  const normalized = allowedDomains.map(domain => normalizeDomain(domain)).filter(Boolean);
  return Array.from(new Set(normalized));
}

function buildDefaultCandidates(query: string): SearchCandidate[] {
  const encoded = encodeURIComponent(query);
  return [
    {
      title: 'GitHub Issues Search',
      url: `https://github.com/search?q=${encoded}&type=issues`,
      sourceType: 'community',
    },
    {
      title: 'StackOverflow Search',
      url: `https://stackoverflow.com/search?q=${encoded}`,
      sourceType: 'community',
    },
    {
      title: 'npm Package Search',
      url: `https://www.npmjs.com/search?q=${encoded}`,
      sourceType: 'community',
    },
  ];
}

function getMatchedDomainPriority(hostname: string, allowedDomains: string[]): number | null {
  for (let index = 0; index < allowedDomains.length; index += 1) {
    const pattern = allowedDomains[index];
    if (pattern.startsWith('*.')) {
      const baseDomain = pattern.slice(2);
      if (!baseDomain) {
        continue;
      }
      if (hostname !== baseDomain && hostname.endsWith(`.${baseDomain}`)) {
        return index;
      }
      continue;
    }

    if (hostname === pattern) {
      return index;
    }
  }

  return null;
}

function extractKeywords(query: string): string[] {
  const stopwords = new Set([
    'the',
    'and',
    'for',
    'with',
    'this',
    'that',
    'from',
    'have',
    'were',
    'when',
    'what',
    'where',
    'which',
    'cannot',
    'error',
    'failed',
  ]);

  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !stopwords.has(token));

  return Array.from(new Set(keywords)).slice(0, 12);
}

function computeScore(params: {
  sourceType: 'official' | 'community';
  domainPriority: number;
  haystack: string;
  queryKeywords: string[];
}): number {
  const sourceScore = params.sourceType === 'official' ? 46 : 28;
  const domainScore = Math.max(0, 24 - params.domainPriority * 3);
  const overlapCount = params.queryKeywords.reduce((count, token) => {
    return params.haystack.includes(token) ? count + 1 : count;
  }, 0);
  const overlapScore = Math.min(overlapCount * 6, 24);
  const versionScore = /\b(v?\d{1,2}(?:\.\d+){0,2})\b/.test(params.haystack) ? 8 : 0;
  return sourceScore + domainScore + overlapScore + versionScore;
}

function mapConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 78) return 'high';
  if (score >= 52) return 'medium';
  return 'low';
}

function rankCandidates(candidates: SearchCandidate[], allowedDomains: string[]): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];

  for (const candidate of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(candidate.url);
    } catch {
      continue;
    }

    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      continue;
    }

    const hostname = normalizeDomain(parsed.hostname);
    const matchedPriority = getMatchedDomainPriority(hostname, allowedDomains);
    if (matchedPriority === null) {
      continue;
    }

    ranked.push({
      candidate,
      hostname,
      domainPriority: matchedPriority,
    });
  }

  return ranked;
}

function truncateLargeValue(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const head = value.slice(0, Math.floor(maxChars * 0.72));
  const tail = value.slice(-Math.floor(maxChars * 0.18));
  return `${head}...<truncated:${value.length}>...${tail}`;
}

function compressImageRef(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, '');
  if (!compact) {
    return '';
  }
  return truncateLargeValue(compact, maxChars);
}

function trimDomContext(domContext: string, maxChars: number): string {
  const lines = domContext
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return '';
  }

  const prioritized = lines.filter(line =>
    /(diff|offset|overflow|position|transform|top:|left:|z-index|translate|scale|rotate)/i.test(
      line
    )
  );
  const selected = (prioritized.length > 0 ? prioritized : lines).slice(0, 12);
  return truncateLargeValue(selected.join(' | '), maxChars);
}

function buildVisualSummary(
  visual: VisualDiffBundleRef | undefined,
  maxPayloadChars: number
): string | undefined {
  if (!visual) {
    return undefined;
  }

  const imageBudget = Math.max(120, Math.floor(maxPayloadChars * 0.24));
  const textBudget = Math.max(160, Math.floor(maxPayloadChars * 0.52));
  const parts: string[] = [];

  if (visual.hotspotHint) {
    parts.push(`hotspot=${truncateLargeValue(visual.hotspotHint, Math.max(80, textBudget / 2))}`);
  }
  if (visual.diffImage) {
    parts.push(`diffImage=${compressImageRef(visual.diffImage, imageBudget)}`);
  }
  if (visual.currentImage) {
    parts.push(`currentImage=${compressImageRef(visual.currentImage, imageBudget)}`);
  }
  if (visual.baselineImage) {
    parts.push(`baselineImage=${compressImageRef(visual.baselineImage, imageBudget)}`);
  }
  if (visual.domContext) {
    parts.push(`domPath=${trimDomContext(visual.domContext, textBudget)}`);
  }

  if (parts.length === 0) {
    return undefined;
  }
  return truncateLargeValue(parts.join('; '), maxPayloadChars);
}

export async function searchAugmentedRepair(errors: ParsedError[]): Promise<{
  query: string;
  hints: SearchHint[];
  summary: string;
}>;
export async function searchAugmentedRepair(
  errors: ParsedError[],
  options: SearchAugmentedRepairOptions
): Promise<{
  query: string;
  hints: SearchHint[];
  summary: string;
}>;
export async function searchAugmentedRepair(
  errors: ParsedError[],
  options: SearchAugmentedRepairOptions = {}
): Promise<{
  query: string;
  hints: SearchHint[];
  summary: string;
}> {
  const visualSummary = buildVisualSummary(
    options.visualDiffBundleRef,
    Math.max(400, options.maxVisualPayloadChars ?? 2400)
  );
  const query = buildQuery(errors, visualSummary);
  if (!query) {
    return {
      query: '',
      hints: [],
      summary: 'No valid error query generated for search-augmented repair.',
    };
  }

  const allowedDomains = normalizeAllowedDomains(options.allowedDomains ?? []);
  if (allowedDomains.length === 0) {
    return {
      query,
      hints: [],
      summary: [
        `query="${query}"`,
        `visualSummary=${visualSummary ? 'present' : 'absent'}`,
        'Search-augmented repair skipped: SEARCH_REPAIR_ALLOWED_DOMAINS is empty.',
      ].join('\n'),
    };
  }

  const candidates = options.candidates ?? buildDefaultCandidates(query);
  const rankedCandidates = rankCandidates(candidates, allowedDomains);
  const queryKeywords = extractKeywords(query);
  const fetcher = options.fetchExcerptFn ?? fetchExcerpt;

  const hinted = await Promise.all(
    rankedCandidates.map(async (ranked): Promise<SearchHint> => {
      const excerpt = await fetcher(ranked.candidate.url);
      const haystack = `${ranked.candidate.title} ${ranked.candidate.url} ${excerpt || ''}`.toLowerCase();
      const score = computeScore({
        sourceType: ranked.candidate.sourceType,
        domainPriority: ranked.domainPriority,
        haystack,
        queryKeywords,
      });

      return {
        ...ranked.candidate,
        hostname: ranked.hostname,
        score,
        confidence: mapConfidence(score),
        excerpt,
      };
    })
  );

  hinted.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.sourceType !== right.sourceType) {
      return left.sourceType === 'official' ? -1 : 1;
    }
    const urlOrder = left.url.localeCompare(right.url);
    if (urlOrder !== 0) {
      return urlOrder;
    }
    return left.title.localeCompare(right.title);
  });

  const summary = [
    `query="${query}"`,
    `visualSummary=${visualSummary ? 'present' : 'absent'}`,
    `allowedDomains=${allowedDomains.join(', ')}`,
    `candidates=${candidates.length}, accepted=${rankedCandidates.length}`,
    ...hinted.map(item => `${item.title}: ${item.url}`),
  ].join('\n');

  return {
    query,
    hints: hinted,
    summary,
  };
}

export function formatSearchHints(result: {
  query: string;
  hints: SearchHint[];
  summary: string;
}): string {
  const lines: string[] = [];
  lines.push('[SearchAugmentedRepair]');
  lines.push(`query=${result.query}`);
  for (const hint of result.hints) {
    lines.push(
      `- ${hint.title} (source=${hint.sourceType}, confidence=${hint.confidence}, score=${hint.score}, host=${hint.hostname})`
    );
    lines.push(`  ${hint.url}`);
    if (hint.excerpt) {
      lines.push(`  excerpt=${hint.excerpt}`);
    }
  }
  return lines.join('\n');
}

