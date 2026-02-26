/**
 * Apply Diff Tool - Search/Replace Block 协议
 *
 * 说明：
 * - 主协议采用 SEARCH/REPLACE block，避免 Unified Diff 行号漂移导致的失败。
 * - 必须唯一匹配；若匹配到多个位置，直接拒绝执行并返回歧义错误。
 * - 支持空白字符归一化匹配，降低缩进或换行微调带来的误判失败。
 */

import * as path from 'path';
import { z } from 'zod';
import { Tool } from '../tool';
import { FileStorage } from '../../storage/file-storage';
import type { FileOperationMetadata } from '@ai-frontend/shared-types';
import { normalizeWorkspaceRelativePath } from '../../security/path-safety';
import { evaluateContractWrite } from '../../orchestration/contract-policy';
import { evaluateRuntimeArtifactPath } from '../../orchestration/runtime-artifact-policy';

interface ApplyDiffParams {
  filePath: string;
  patch: string;
  normalizeWhitespace?: boolean;
}

type ApplyDiffResult = {
  title: string;
  metadata: FileOperationMetadata;
  output: string;
};

interface SearchReplaceBlock {
  search: string;
  replace: string;
}

type ApplyDiffErrorCode =
  | 'INVALID_BLOCK_FORMAT'
  | 'AMBIGUOUS_MATCH'
  | 'NO_MATCH_STRICT'
  | 'NO_MATCH_NORMALIZED'
  | 'CONTRACT_FROZEN_WRITE_BLOCKED'
  | 'RUNTIME_ARTIFACT_PATH_BLOCKED';

interface NoMatchHint {
  lineStart: number;
  lineEnd: number;
  snippet: string;
}

interface ApplyDiffDiagnostics {
  filePath?: string;
  blockIndex?: number;
  searchPreview?: string;
  candidateHints?: NoMatchHint[];
}

class ApplyDiffError extends Error {
  readonly code: ApplyDiffErrorCode;
  readonly diagnostics?: ApplyDiffDiagnostics;

  constructor(code: ApplyDiffErrorCode, message: string, diagnostics?: ApplyDiffDiagnostics) {
    super(message);
    this.name = 'ApplyDiffError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

interface LineMatchRange {
  start: number;
  endExclusive: number;
}

const SEARCH_REPLACE_BLOCK_REGEX =
  /<<<<<<<\s*SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>\s*REPLACE/gm;

function normalizeLineWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function normalizeEol(input: string, eol: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\n/g, eol);
}

function parseSearchReplaceBlocks(patch: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = SEARCH_REPLACE_BLOCK_REGEX.exec(patch)) !== null) {
    blocks.push({
      search: match[1] ?? '',
      replace: match[2] ?? '',
    });
  }

  if (blocks.length === 0) {
    throw new ApplyDiffError(
      'INVALID_BLOCK_FORMAT',
      'Invalid patch format: expected at least one SEARCH/REPLACE block (<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE).'
    );
  }

  return blocks;
}

function extractCodeFenceContent(patch: string): string {
  const trimmed = patch.trim();
  if (!trimmed) return '';
  const fenced = trimmed.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/);
  if (fenced?.[1]) {
    return fenced[1];
  }
  return trimmed;
}

function shouldUseFullFileFallback(currentContent: string, replacement: string): boolean {
  const trimmed = replacement.trim();
  if (!trimmed) return false;
  const minLength = Math.max(120, Math.floor(currentContent.length * 0.35));
  if (trimmed.length < minLength) return false;
  return /(import\s.+from|export\s+default|function\s+[A-Z]|const\s+[A-Z]|return\s+\(|<div|<main|<section)/.test(
    trimmed
  );
}

function findStrictMatches(content: string, search: string): number[] {
  if (!search) return [];

  const matches: number[] = [];
  let fromIndex = 0;

  while (fromIndex <= content.length) {
    const index = content.indexOf(search, fromIndex);
    if (index === -1) break;
    matches.push(index);
    fromIndex = index + 1;
  }

  return matches;
}

function findNormalizedLineMatches(content: string, search: string): LineMatchRange[] {
  const contentLines = content.replace(/\r\n/g, '\n').split('\n');
  const searchLines = search.replace(/\r\n/g, '\n').split('\n');

  if (searchLines.length === 0) return [];
  if (searchLines.length > contentLines.length) return [];

  const normalizedSearch = searchLines.map(normalizeLineWhitespace);
  const ranges: LineMatchRange[] = [];

  for (let start = 0; start <= contentLines.length - searchLines.length; start++) {
    let matched = true;
    for (let offset = 0; offset < searchLines.length; offset++) {
      const source = contentLines[start + offset];
      const target = normalizedSearch[offset];
      if (normalizeLineWhitespace(source) !== target) {
        matched = false;
        break;
      }
    }
    if (matched) {
      ranges.push({ start, endExclusive: start + searchLines.length });
    }
  }

  return ranges;
}

function replaceByLineRange(
  content: string,
  range: LineMatchRange,
  replacement: string,
  eol: string
): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const replacementLines = replacement.replace(/\r\n/g, '\n').split('\n');
  const next = [
    ...lines.slice(0, range.start),
    ...replacementLines,
    ...lines.slice(range.endExclusive),
  ];
  return next.join(eol);
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_$]+/g)
    .map(token => token.trim())
    .filter(Boolean);
}

function overlapScore(source: string, target: string): number {
  const sourceTokens = new Set(tokenize(source));
  const targetTokens = new Set(tokenize(target));
  if (sourceTokens.size === 0 || targetTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of sourceTokens) {
    if (targetTokens.has(token)) overlap += 1;
  }
  return overlap;
}

function formatSnippetWithLineNumbers(
  lines: string[],
  startLineZeroBased: number,
  endLineExclusiveZeroBased: number
): string {
  return lines
    .slice(startLineZeroBased, endLineExclusiveZeroBased)
    .map((line, index) => `${startLineZeroBased + index + 1} | ${line}`)
    .join('\n');
}

function buildNoMatchHints(content: string, search: string, maxHints = 3): NoMatchHint[] {
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const contentLines = normalizedContent.split('\n');
  const searchLines = search.replace(/\r\n/g, '\n').split('\n').filter(line => line.trim().length > 0);
  const searchText = searchLines.join('\n');

  if (contentLines.length === 0) {
    return [];
  }

  const windowSize = Math.max(1, Math.min(searchLines.length || 4, 12, contentLines.length));
  const ranked = Array.from({ length: Math.max(contentLines.length - windowSize + 1, 1) }).map(
    (_, start) => {
      const endExclusive = Math.min(start + windowSize, contentLines.length);
      const block = contentLines.slice(start, endExclusive).join('\n');
      const score = overlapScore(searchText, block);
      return { start, endExclusive, score };
    }
  );

  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.start - right.start;
  });

  const hints = ranked.slice(0, maxHints).map(item => {
    const contextStart = Math.max(0, item.start - 1);
    const contextEnd = Math.min(contentLines.length, item.endExclusive + 1);
    return {
      lineStart: contextStart + 1,
      lineEnd: contextEnd,
      snippet: formatSnippetWithLineNumbers(contentLines, contextStart, contextEnd),
    };
  });

  if (hints.length > 0) {
    return hints;
  }

  const headEnd = Math.min(contentLines.length, 6);
  const tailStart = Math.max(0, contentLines.length - 6);
  const fallback: NoMatchHint[] = [];
  fallback.push({
    lineStart: 1,
    lineEnd: headEnd,
    snippet: formatSnippetWithLineNumbers(contentLines, 0, headEnd),
  });
  if (tailStart > 0) {
    fallback.push({
      lineStart: tailStart + 1,
      lineEnd: contentLines.length,
      snippet: formatSnippetWithLineNumbers(contentLines, tailStart, contentLines.length),
    });
  }
  return fallback;
}

function applyOneBlock(
  content: string,
  block: SearchReplaceBlock,
  normalizeWhitespace: boolean,
  blockIndex: number,
  filePath: string
): { content: string; strategy: 'strict' | 'normalized' } {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const normalizedSearch = normalizeEol(block.search, eol);
  const normalizedReplace = normalizeEol(block.replace, eol);

  const strictMatches = findStrictMatches(content, normalizedSearch);
  if (strictMatches.length === 1) {
    const index = strictMatches[0];
    const next =
      content.slice(0, index) + normalizedReplace + content.slice(index + normalizedSearch.length);
    return { content: next, strategy: 'strict' };
  }
  if (strictMatches.length > 1) {
    throw new ApplyDiffError(
      'AMBIGUOUS_MATCH',
      `AMBIGUOUS_MATCH: SEARCH block matched ${strictMatches.length} locations in strict mode`,
      {
        filePath,
        blockIndex,
        searchPreview: block.search.slice(0, 240),
      }
    );
  }

  if (!normalizeWhitespace) {
    throw new ApplyDiffError('NO_MATCH_STRICT', 'NO_MATCH_STRICT: SEARCH block not found in strict mode', {
      filePath,
      blockIndex,
      searchPreview: block.search.slice(0, 240),
    });
  }

  const normalizedMatches = findNormalizedLineMatches(content, block.search);
  if (normalizedMatches.length === 1) {
    const next = replaceByLineRange(content, normalizedMatches[0], block.replace, eol);
    return { content: next, strategy: 'normalized' };
  }
  if (normalizedMatches.length > 1) {
    throw new ApplyDiffError(
      'AMBIGUOUS_MATCH',
      `AMBIGUOUS_MATCH: SEARCH block matched ${normalizedMatches.length} locations in normalized mode`,
      {
        filePath,
        blockIndex,
        searchPreview: block.search.slice(0, 240),
      }
    );
  }

  throw new ApplyDiffError(
    'NO_MATCH_NORMALIZED',
    'NO_MATCH_NORMALIZED: SEARCH block not found in strict or normalized mode',
    {
      filePath,
      blockIndex,
      searchPreview: block.search.slice(0, 240),
      candidateHints: buildNoMatchHints(content, block.search),
    }
  );
}

export const ApplyDiffTool = Tool.define('apply_diff', {
  description: [
    'Apply code changes using SEARCH/REPLACE blocks.',
    'MANDATORY FORMAT:',
    '<<<<<<< SEARCH',
    '<original code with enough context>',
    '=======',
    '<replacement code>',
    '>>>>>>> REPLACE',
    'STRICT RULES:',
    '- Output only SEARCH/REPLACE blocks, no explanations.',
    '- SEARCH must uniquely match exactly one location.',
    '- If SEARCH is ambiguous, the tool rejects with AMBIGUOUS_MATCH.',
    '- Include at least 2 unchanged context lines before and after edits to guarantee uniqueness.',
    '- Do not rewrite the whole file.',
  ].join('\n'),
  parameters: z.object({
    filePath: z.string().describe('Relative file path to modify'),
    patch: z.string().describe('SEARCH/REPLACE patch content'),
    normalizeWhitespace: z
      .boolean()
      .optional()
      .describe('Whether to allow whitespace-normalized matching when strict match fails'),
  }),
  async execute(
    params: ApplyDiffParams,
    ctx: { sessionID?: string }
  ): Promise<ApplyDiffResult> {
    const { sessionID } = ctx;
    if (!sessionID) {
      throw new Error('Session ID is required for apply_diff tool');
    }

    const normalizeWhitespace = params.normalizeWhitespace ?? true;

    try {
      const safePath = normalizeWorkspaceRelativePath(params.filePath);
      const contractDecision = evaluateContractWrite(sessionID, safePath);
      if (!contractDecision.allowed) {
        throw new ApplyDiffError(
          'CONTRACT_FROZEN_WRITE_BLOCKED',
          contractDecision.reason || 'CONTRACT_FROZEN_WRITE_BLOCKED',
          { filePath: safePath }
        );
      }
      const files = FileStorage.getAllFiles(sessionID);
      const runtimePathDecision = evaluateRuntimeArtifactPath(safePath, files);
      if (!runtimePathDecision.allowed) {
        throw new ApplyDiffError(
          'RUNTIME_ARTIFACT_PATH_BLOCKED',
          runtimePathDecision.reason || 'RUNTIME_ARTIFACT_PATH_BLOCKED',
          { filePath: safePath }
        );
      }
      const targetPath = runtimePathDecision.normalizedPath;
      const targetFile = files.find(f => f.path === targetPath || f.path.endsWith(targetPath));

      if (!targetFile) {
        throw new Error(`File not found in session storage: ${targetPath}`);
      }

      let usedFullFileFallback = false;
      let blocks: SearchReplaceBlock[];
      try {
        blocks = parseSearchReplaceBlocks(params.patch);
      } catch (error) {
        if (error instanceof ApplyDiffError && error.code === 'INVALID_BLOCK_FORMAT') {
          const fallbackReplacement = extractCodeFenceContent(params.patch);
          if (shouldUseFullFileFallback(targetFile.content, fallbackReplacement)) {
            blocks = [
              {
                search: targetFile.content,
                replace: fallbackReplacement,
              },
            ];
            usedFullFileFallback = true;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
      let nextContent = targetFile.content;
      let normalizedApplyCount = 0;

      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        try {
          const result = applyOneBlock(nextContent, block, normalizeWhitespace, index + 1, targetFile.path);
          if (result.strategy === 'normalized') {
            normalizedApplyCount += 1;
          }
          nextContent = result.content;
        } catch (error) {
          if (
            error instanceof ApplyDiffError &&
            (error.code === 'NO_MATCH_STRICT' || error.code === 'NO_MATCH_NORMALIZED') &&
            blocks.length === 1 &&
            shouldUseFullFileFallback(nextContent, block.replace)
          ) {
            const eol = nextContent.includes('\r\n') ? '\r\n' : '\n';
            nextContent = normalizeEol(block.replace, eol);
            usedFullFileFallback = true;
            continue;
          }
          throw error;
        }
      }

      const saveResult = FileStorage.saveFiles(sessionID, [
        {
          path: targetFile.path,
          content: nextContent,
          language: targetFile.language,
        },
      ]);
      if (saveResult.errors.length > 0) {
        throw new Error(saveResult.errors.join('; '));
      }

      const output = [
        `Applied ${blocks.length} SEARCH/REPLACE block(s) to ${targetFile.path}.`,
        normalizedApplyCount > 0
          ? `Whitespace-normalized matching used for ${normalizedApplyCount} block(s).`
          : 'Strict matching used for all blocks.',
        usedFullFileFallback ? 'Full-file fallback replacement was applied.' : '',
      ].join(' ');

      return {
        title: path.basename(targetFile.path),
        metadata: {
          filePath: targetFile.path,
          edited: true,
          language: targetFile.language,
          diff: `searchReplaceBlocks=${blocks.length}; normalized=${normalizedApplyCount}; fullFileFallback=${usedFullFileFallback}`,
        } as FileOperationMetadata,
        output,
      };
    } catch (error) {
      return {
        title: 'Apply Diff Error',
        metadata: {
          filePath: params.filePath,
          errorCode: error instanceof ApplyDiffError ? error.code : 'UNKNOWN',
          diagnostics: error instanceof ApplyDiffError ? error.diagnostics : undefined,
          error: error instanceof Error ? error.message : String(error),
        } as FileOperationMetadata,
        output: `Failed to apply SEARCH/REPLACE patch: ${
          error instanceof Error ? error.message : String(error)
        }${
          error instanceof ApplyDiffError && error.diagnostics?.candidateHints?.length
            ? `\n[DIAGNOSTICS]\n${error.diagnostics.candidateHints
                .map(
                  hint =>
                    `lines ${hint.lineStart}-${hint.lineEnd}\n${hint.snippet}`
                )
                .join('\n---\n')}`
            : ''
        }`,
      };
    }
  },
});
