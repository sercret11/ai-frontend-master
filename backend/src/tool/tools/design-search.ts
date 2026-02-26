/**
 * Design Search Tool - 直接读取 ui-ux-data CSV 进行检索
 */

import * as fs from 'fs/promises';
import { existsSync, type Dirent } from 'fs';
import * as path from 'path';
import { Tool } from '../tool';
import type { DesignSearchMetadata } from '@ai-frontend/shared-types';
import { z } from 'zod';

type ResourceDomain = 'style' | 'color' | 'typography' | 'chart' | 'product' | 'ux';
type SearchDomain = ResourceDomain | 'auto';

export interface SearchDocument {
  domain: ResourceDomain;
  sourceFile: string;
  rowNumber: number;
  headers: string[];
  values: string[];
  title: string;
  keywords: string;
  snippet: string;
  searchableText: string;
}

interface RankedResult {
  doc: SearchDocument;
  score: number;
}

export interface SearchScoreWeights {
  exactQuery: number;
  tokenInText: number;
  tokenInTitle: number;
  tokenInKeywords: number;
  hyphenBoost: number;
}

const DATA_PATH_CANDIDATES = ['ui-ux-data', '../ui-ux-data'];
const DOCUMENT_CACHE = new Map<string, SearchDocument[]>();

export const DEFAULT_SEARCH_SCORE_WEIGHTS: Readonly<SearchScoreWeights> = Object.freeze({
  exactQuery: 12,
  tokenInText: 2,
  tokenInTitle: 3,
  tokenInKeywords: 2,
  hyphenBoost: 1,
});

const SEARCH_SCORE_ENV_MAP: Record<keyof SearchScoreWeights, string> = {
  exactQuery: 'UI_UX_SEARCH_WEIGHT_EXACT_QUERY',
  tokenInText: 'UI_UX_SEARCH_WEIGHT_TOKEN_TEXT',
  tokenInTitle: 'UI_UX_SEARCH_WEIGHT_TOKEN_TITLE',
  tokenInKeywords: 'UI_UX_SEARCH_WEIGHT_TOKEN_KEYWORDS',
  hyphenBoost: 'UI_UX_SEARCH_WEIGHT_HYPHEN',
};

function parseWeightFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

export function resolveSearchScoreWeights(
  env: Record<string, string | undefined> = process.env
): SearchScoreWeights {
  return {
    exactQuery: parseWeightFromEnv(
      env[SEARCH_SCORE_ENV_MAP.exactQuery],
      DEFAULT_SEARCH_SCORE_WEIGHTS.exactQuery
    ),
    tokenInText: parseWeightFromEnv(
      env[SEARCH_SCORE_ENV_MAP.tokenInText],
      DEFAULT_SEARCH_SCORE_WEIGHTS.tokenInText
    ),
    tokenInTitle: parseWeightFromEnv(
      env[SEARCH_SCORE_ENV_MAP.tokenInTitle],
      DEFAULT_SEARCH_SCORE_WEIGHTS.tokenInTitle
    ),
    tokenInKeywords: parseWeightFromEnv(
      env[SEARCH_SCORE_ENV_MAP.tokenInKeywords],
      DEFAULT_SEARCH_SCORE_WEIGHTS.tokenInKeywords
    ),
    hyphenBoost: parseWeightFromEnv(
      env[SEARCH_SCORE_ENV_MAP.hyphenBoost],
      DEFAULT_SEARCH_SCORE_WEIGHTS.hyphenBoost
    ),
  };
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(input: string): string[] {
  return normalizeText(input)
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length > 1);
}

function resolveDataRoot(): string {
  const explicit = process.env.UI_UX_DATA_PATH;
  if (explicit) {
    const absolute = path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
    return absolute;
  }

  for (const candidate of DATA_PATH_CANDIDATES) {
    const absolute = path.resolve(process.cwd(), candidate);
    if (existsSync(absolute)) {
      return absolute;
    }
  }

  return path.resolve(process.cwd(), 'ui-ux-data');
}

async function collectCsvFiles(root: string): Promise<string[]> {
  const result: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) {
        result.push(fullPath);
      }
    }
  }

  await walk(root);
  return result;
}

export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const input = content.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i++;
      }
      row.push(field);
      field = '';
      if (row.some(cell => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(cell => cell.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

export function inferDomain(relativeFilePath: string): ResourceDomain {
  const lower = relativeFilePath.replace(/\\/g, '/').toLowerCase();

  if (lower.includes('color')) return 'color';
  if (lower.includes('typography')) return 'typography';
  if (lower.includes('chart')) return 'chart';
  if (lower.includes('product')) return 'product';

  if (
    lower.includes('ux') ||
    lower.includes('interface') ||
    lower.includes('reasoning') ||
    lower.includes('performance') ||
    lower.includes('icon')
  ) {
    return 'ux';
  }

  return 'style';
}

function pickValue(headers: string[], values: string[], candidates: string[]): string {
  const normalizedHeaders = headers.map(header => normalizeText(header));

  for (const candidate of candidates) {
    const needle = normalizeText(candidate);
    const index = normalizedHeaders.findIndex(header => header.includes(needle));
    if (index >= 0 && values[index] && values[index].trim().length > 0) {
      return values[index].trim();
    }
  }

  return '';
}

export function buildSearchDocument(
  domain: ResourceDomain,
  sourceFile: string,
  headers: string[],
  values: string[],
  rowNumber: number
): SearchDocument {
  const title =
    pickValue(headers, values, [
      'style category',
      'pattern name',
      'product type',
      'font pairing name',
      'issue',
      'guideline',
      'icon name',
      'category',
      'type',
    ]) || `Row ${rowNumber}`;

  const keywords = pickValue(headers, values, ['keywords', 'mood/style keywords', 'ai prompt keywords']);
  const snippet =
    pickValue(headers, values, ['description', 'best for', 'usage', 'notes', 'key considerations']) ||
    values.filter(Boolean).slice(0, 4).join(' | ');

  const searchableParts: string[] = [title, keywords, snippet];
  for (let i = 0; i < headers.length && i < values.length; i++) {
    searchableParts.push(`${headers[i]}: ${values[i]}`);
  }

  return {
    domain,
    sourceFile,
    rowNumber,
    headers,
    values,
    title,
    keywords,
    snippet,
    searchableText: searchableParts.join(' | '),
  };
}

export function scoreDocument(
  query: string,
  doc: SearchDocument,
  weights: SearchScoreWeights = DEFAULT_SEARCH_SCORE_WEIGHTS
): number {
  const q = normalizeText(query);
  if (!q) return 0;

  const tokens = tokenize(query);
  const text = normalizeText(doc.searchableText);
  const title = normalizeText(doc.title);
  const keywords = normalizeText(doc.keywords);
  let score = 0;

  if (text.includes(q)) {
    score += weights.exactQuery;
  }

  for (const token of tokens) {
    if (!token) continue;
    if (text.includes(token)) score += weights.tokenInText;
    if (title.includes(token)) score += weights.tokenInTitle;
    if (keywords.includes(token)) score += weights.tokenInKeywords;
    if (token.length > 3 && text.includes(`${token}-`)) score += weights.hyphenBoost;
  }

  return score;
}

export function detectDomainFromQuery(query: string): ResourceDomain {
  const q = normalizeText(query);
  if (/color|palette|cta|hex|contrast/.test(q)) return 'color';
  if (/font|typography|typeface|line[- ]?height/.test(q)) return 'typography';
  if (/chart|graph|visualization|dashboard/.test(q)) return 'chart';
  if (/product|saas|ecommerce|finance|healthcare/.test(q)) return 'product';
  if (/ux|accessibility|interaction|usability|a11y/.test(q)) return 'ux';
  return 'style';
}

async function loadDocuments(root: string): Promise<SearchDocument[]> {
  if (DOCUMENT_CACHE.has(root)) {
    return DOCUMENT_CACHE.get(root)!;
  }

  const files = await collectCsvFiles(root);
  const docs: SearchDocument[] = [];

  for (const filePath of files) {
    const relative = path.relative(root, filePath).replace(/\\/g, '/');
    const domain = inferDomain(relative);
    let content: string;

    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const rows = parseCsv(content);
    if (rows.length < 2) continue;

    const headers = rows[0];
    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      if (!values.some(value => value && value.trim().length > 0)) continue;
      docs.push(buildSearchDocument(domain, relative, headers, values, i + 1));
    }
  }

  DOCUMENT_CACHE.set(root, docs);
  return docs;
}

function toCompactRecord(doc: SearchDocument): Record<string, string> {
  const record: Record<string, string> = {};
  const maxFields = 8;
  let picked = 0;

  for (let i = 0; i < doc.headers.length && i < doc.values.length; i++) {
    const header = (doc.headers[i] || '').trim();
    const value = (doc.values[i] || '').trim();
    if (!header || !value) continue;
    record[header] = value.length > 220 ? `${value.slice(0, 220)}...` : value;
    picked++;
    if (picked >= maxFields) break;
  }

  return record;
}

export const DesignSearchTool = Tool.define('design_search', {
  description:
    'Search UI/UX resources directly from local ui-ux-data CSV files (styles, colors, typography, charts, products, UX patterns).',
  parameters: z.object({
    query: z.string().describe('Search query describing the desired design resource'),
    domain: z
      .enum(['style', 'color', 'typography', 'chart', 'product', 'ux', 'auto'])
      .optional()
      .describe('Domain to search: style, color, typography, chart, product, ux (defaults to auto)'),
    maxResults: z.number().int().min(1).max(10).optional().describe('Maximum results to return (default: 3)'),
  }),
  async execute(params, ctx) {
    const query = params.query.trim();
    const requestedDomain: SearchDomain = params.domain || 'auto';
    const maxResults = params.maxResults || 3;
    const dataRoot = resolveDataRoot();
    const scoreWeights = resolveSearchScoreWeights();

    try {
      const docs = await loadDocuments(dataRoot);
      if (docs.length === 0) {
        return {
          title: `Design Search: ${query}`,
          metadata: {
            resourceType: requestedDomain === 'auto' ? 'style' : requestedDomain,
            query,
            count: 0,
            maxResults,
            dataRoot,
          } as DesignSearchMetadata,
          output: `No searchable CSV documents found under ${dataRoot}.`,
        };
      }

      const effectiveDomain: ResourceDomain =
        requestedDomain === 'auto' ? detectDomainFromQuery(query) : requestedDomain;
      const candidateDocs =
        requestedDomain === 'auto' ? docs : docs.filter(doc => doc.domain === requestedDomain);

      const ranked: RankedResult[] = candidateDocs
        .map(doc => ({ doc, score: scoreDocument(query, doc, scoreWeights) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

      const results = ranked.map(item => ({
        score: Number(item.score.toFixed(3)),
        domain: item.doc.domain,
        source: item.doc.sourceFile,
        row: item.doc.rowNumber,
        title: item.doc.title,
        keywords: item.doc.keywords,
        snippet: item.doc.snippet,
        fields: toCompactRecord(item.doc),
      }));

      ctx.metadata({
        title: `Design Search: ${query}`,
        metadata: {
          resourceType: effectiveDomain,
          query,
          count: results.length,
          maxResults,
        } as DesignSearchMetadata,
      });

      let output = `## Design Search Results\n\n`;
      output += `**Query:** ${query}\n`;
      output += `**Domain:** ${requestedDomain === 'auto' ? `auto -> ${effectiveDomain}` : requestedDomain}\n`;
      output += `**Results Found:** ${results.length}\n`;
      output += `**Data Source:** ${dataRoot}\n\n`;
      output += `**Score Weights:** ${JSON.stringify(scoreWeights)}\n\n`;

      if (results.length === 0) {
        output += 'No matching records found.\n';
      } else {
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          output += `### Result ${i + 1}\n\n`;
          output += `**Score:** ${result.score}\n`;
          output += `**Source:** ${result.source}:${result.row}\n`;
          output += `**Title:** ${result.title}\n\n`;
          output += `${JSON.stringify(result, null, 2)}\n\n`;
        }
      }

      return {
        title: `Design Search: ${query}`,
        metadata: {
          resourceType: effectiveDomain,
          query,
          count: results.length,
          maxResults,
        } as DesignSearchMetadata,
        output,
      };
    } catch (error) {
      return {
        title: 'Design Search Error',
        metadata: {
          query,
          error: String(error),
        } as DesignSearchMetadata,
        output: `Design search failed: ${error}`,
      };
    }
  },
});
