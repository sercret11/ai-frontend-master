import { parseSync } from '@oxc-parser/wasm';
import { runSyntaxGate } from './syntax-gate';
import type { AstReplacePatchV2, AstSemanticSelector } from './types';

export interface SandpackCompileErrorSignal {
  filePath: string;
  line?: number;
  snippet?: string;
  rawMessage: string;
}

export interface AstSurgeryOutcome {
  ok: boolean;
  files: Record<string, string>;
  touchedFile?: string;
  reason?: string;
  report?: {
    strategy: 'semantic-dual-check' | 'lca-amputation';
    targetType?: string;
    targetLine?: number;
    snippetMatched: boolean;
  };
}

export interface AstReplaceOutcome {
  ok: boolean;
  files: Record<string, string>;
  touchedFile?: string;
  reason?: string;
  code?: 'AST_SELECTOR_NOT_FOUND' | 'AST_REPLACEMENT_INVALID' | 'AST_APPLY_FAILED';
}

interface ParsedProgram {
  program: Record<string, unknown> | null;
  errors: string[];
}

interface TraversedNode {
  index: number;
  node: Record<string, unknown>;
  type: string;
  start: number;
  end: number;
  parentIndex: number | null;
  children: number[];
}

interface ReplacementValidation {
  ok: boolean;
  mode: 'statement' | 'expression';
  reason?: string;
}

interface CandidateSelection {
  targetIndex: number;
  snippetMatched: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function parseLineColumn(message: string): { line?: number } {
  const match = message.match(/:(\d+):(\d+)/);
  if (!match?.[1]) {
    return {};
  }
  return { line: Number(match[1]) };
}

function sanitizeSourceFilename(filePath: string): string {
  const sanitized = filePath.split(/[?#]/)[0] || filePath;
  const hasExtension = /\.[cm]?[jt]sx?$/i.test(sanitized);
  return hasExtension ? sanitized : `${sanitized}.tsx`;
}

function makeVirtualFilename(filePath: string, suffix: string): string {
  const normalized = sanitizeSourceFilename(filePath);
  const extensionMatch = normalized.match(/(\.[cm]?[jt]sx?)$/i);
  if (!extensionMatch) {
    return `${normalized}.${suffix}.tsx`;
  }
  const extension = extensionMatch[1] || '.tsx';
  const stem = normalized.slice(0, normalized.length - extension.length);
  return `${stem}.${suffix}${extension}`;
}

function parseProgram(filePath: string, source: string): ParsedProgram {
  try {
    const parsed = parseSync(source, {
      sourceFilename: sanitizeSourceFilename(filePath),
      sourceType: 'module',
    }) as unknown;

    const errors = isRecord(parsed) && Array.isArray(parsed['errors'])
      ? parsed['errors']
          .map(item => {
            if (isRecord(item) && typeof item['message'] === 'string') {
              return item['message'];
            }
            return String(item);
          })
          .filter(Boolean)
      : [];

    const program = isRecord(parsed) && isRecord(parsed['program'])
      ? (parsed['program'] as Record<string, unknown>)
      : null;

    return {
      program,
      errors,
    };
  } catch (error) {
    return {
      program: null,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function readNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.floor(value);
}

function getNodeRange(node: Record<string, unknown>): { start: number; end: number } | null {
  const span = node['span'];
  if (isRecord(span)) {
    const start = readNumber(span['start']);
    const end = readNumber(span['end']);
    if (start !== null && end !== null && end > start) {
      return { start, end };
    }
  }

  const start = readNumber(node['start']);
  const end = readNumber(node['end']);
  if (start !== null && end !== null && end > start) {
    return { start, end };
  }

  const range = node['range'];
  if (Array.isArray(range) && range.length >= 2) {
    const rangeStart = readNumber(range[0]);
    const rangeEnd = readNumber(range[1]);
    if (rangeStart !== null && rangeEnd !== null && rangeEnd > rangeStart) {
      return { start: rangeStart, end: rangeEnd };
    }
  }

  return null;
}

function collectNodes(program: Record<string, unknown>): TraversedNode[] {
  const nodes: TraversedNode[] = [];

  const walk = (value: unknown, parentIndex: number | null): void => {
    if (!isRecord(value)) {
      return;
    }

    const type = value['type'];
    if (typeof type !== 'string') {
      return;
    }

    const range = getNodeRange(value);
    let nextParentIndex = parentIndex;
    if (range) {
      const index = nodes.length;
      nodes.push({
        index,
        node: value,
        type,
        start: range.start,
        end: range.end,
        parentIndex,
        children: [],
      });
      nextParentIndex = index;

      if (parentIndex !== null) {
        const parent = nodes[parentIndex];
        if (parent) {
          parent.children.push(index);
        }
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (
        key === 'type' ||
        key === 'start' ||
        key === 'end' ||
        key === 'range' ||
        key === 'loc' ||
        key === 'span' ||
        key === 'parent'
      ) {
        continue;
      }

      if (Array.isArray(child)) {
        for (const entry of child) {
          walk(entry, nextParentIndex);
        }
      } else {
        walk(child, nextParentIndex);
      }
    }
  };

  walk(program, null);
  return nodes;
}

function isStatementLike(type: string): boolean {
  return (
    type.endsWith('Statement') ||
    type.endsWith('Declaration') ||
    type === 'JSXElement' ||
    type === 'JSXFragment'
  );
}

function getNodeIdentifier(node: Record<string, unknown>): string | undefined {
  const id = node['id'];
  if (isRecord(id) && typeof id['name'] === 'string') {
    return id['name'];
  }

  const key = node['key'];
  if (isRecord(key) && typeof key['name'] === 'string') {
    return key['name'];
  }
  if (isRecord(key) && typeof key['value'] === 'string') {
    return key['value'];
  }

  return undefined;
}

function getAncestryTypes(nodes: TraversedNode[], nodeIndex: number): string[] {
  const types: string[] = [];
  let current = nodes[nodeIndex]?.parentIndex ?? null;
  while (current !== null) {
    const parent = nodes[current];
    if (!parent) {
      break;
    }
    types.push(parent.type);
    current = parent.parentIndex;
  }
  return types;
}

function hasEffectiveSelector(selector: AstSemanticSelector): boolean {
  return Boolean(
    selector.type ||
      selector.identifier ||
      selector.contains ||
      (selector.ancestry && selector.ancestry.length > 0)
  );
}

function evaluateSelectorScore(
  node: TraversedNode,
  selector: AstSemanticSelector,
  source: string,
  nodes: TraversedNode[]
): number {
  let score = 0;

  if (selector.type) {
    if (node.type !== selector.type) {
      return Number.NEGATIVE_INFINITY;
    }
    score += 12;
  }

  if (selector.identifier) {
    const identifier = getNodeIdentifier(node.node);
    if (!identifier || identifier !== selector.identifier) {
      return Number.NEGATIVE_INFINITY;
    }
    score += 18;
  }

  if (selector.contains) {
    const nodeCode = normalize(source.slice(node.start, node.end));
    const contains = normalize(selector.contains);
    if (!contains || !nodeCode.includes(contains)) {
      return Number.NEGATIVE_INFINITY;
    }
    score += 20;
  }

  if (selector.ancestry && selector.ancestry.length > 0) {
    const ancestry = getAncestryTypes(nodes, node.index);
    const missing = selector.ancestry.some(type => !ancestry.includes(type));
    if (missing) {
      return Number.NEGATIVE_INFINITY;
    }
    score += selector.ancestry.length * 3;
  }

  return score;
}

function findBestNode(
  nodes: TraversedNode[],
  selector: AstSemanticSelector,
  source: string
): TraversedNode | null {
  let best: TraversedNode | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const score = evaluateSelectorScore(node, selector, source, nodes);
    if (!Number.isFinite(score)) {
      continue;
    }

    if (
      score > bestScore ||
      (score === bestScore &&
        best !== null &&
        node.end - node.start < best.end - best.start)
    ) {
      best = node;
      bestScore = score;
    }
  }

  return best;
}

function validateReplacement(filePath: string, replacement: string): ReplacementValidation {
  const statementWrapper = parseProgram(
    makeVirtualFilename(filePath, 'replacement-statement'),
    `function __TEMP__(){\n${replacement}\n}`
  );
  if (statementWrapper.program && statementWrapper.errors.length === 0) {
    return { ok: true, mode: 'statement' };
  }

  const expressionWrapper = parseProgram(
    makeVirtualFilename(filePath, 'replacement-expression'),
    `function __TEMP__(){ return (${replacement}); }`
  );
  if (expressionWrapper.program && expressionWrapper.errors.length === 0) {
    return { ok: true, mode: 'expression' };
  }

  const reason =
    statementWrapper.errors[0] ||
    expressionWrapper.errors[0] ||
    'replacement fragment is invalid';

  return {
    ok: false,
    mode: 'statement',
    reason,
  };
}

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function offsetToLine(offset: number, lineOffsets: number[]): number {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const current = lineOffsets[middle] ?? 0;
    const next = lineOffsets[middle + 1] ?? Number.POSITIVE_INFINITY;
    if (offset >= current && offset < next) {
      return middle + 1;
    }
    if (offset < current) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return lineOffsets.length;
}

function buildReplacementForNode(
  node: TraversedNode,
  replacement: string,
  validation: ReplacementValidation
): string {
  const trimmed = replacement.trim();
  const hasReturn = /^return\b/.test(trimmed);

  if (node.type === 'ReturnStatement' && validation.mode === 'expression' && !hasReturn) {
    return `return (${trimmed});`;
  }

  if (isStatementLike(node.type) && validation.mode === 'expression') {
    return `(${trimmed});`;
  }

  return replacement;
}

function sliceIncludesSnippet(source: string, node: TraversedNode, snippet: string): boolean {
  const sourceSlice = normalize(source.slice(node.start, node.end));
  return sourceSlice.includes(normalize(snippet));
}

function selectSurgeryTarget(
  nodes: TraversedNode[],
  source: string,
  signal: SandpackCompileErrorSignal,
  lineOffsets: number[]
): CandidateSelection | null {
  const statementNodes = nodes.filter(node => isStatementLike(node.type));
  if (statementNodes.length === 0) {
    return null;
  }

  const hasSnippet = typeof signal.snippet === 'string' && signal.snippet.trim().length > 0;
  const hasLine = typeof signal.line === 'number' && Number.isFinite(signal.line);

  const ranked = statementNodes
    .map(node => {
      const startLine = offsetToLine(node.start, lineOffsets);
      const endLine = offsetToLine(node.end, lineOffsets);
      const snippetMatched = hasSnippet
        ? sliceIncludesSnippet(source, node, signal.snippet || '')
        : false;
      const lineDistance = hasLine
        ? Math.min(Math.abs((signal.line as number) - startLine), Math.abs((signal.line as number) - endLine))
        : 0;
      const lineMatched = hasLine
        ? (signal.line as number) >= startLine - 2 && (signal.line as number) <= endLine + 2
        : false;
      const span = Math.max(1, node.end - node.start);

      return {
        node,
        snippetMatched,
        lineMatched,
        lineDistance,
        score:
          (snippetMatched ? 40 : 0) +
          (lineMatched ? Math.max(0, 12 - lineDistance) : 0) -
          Math.floor(span / 180),
      };
    })
    .filter(item => {
      if (hasSnippet && hasLine) {
        return item.snippetMatched && item.lineMatched;
      }
      if (hasSnippet) {
        return item.snippetMatched;
      }
      if (hasLine) {
        return item.lineMatched;
      }
      return false;
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return (left.node.end - left.node.start) - (right.node.end - right.node.start);
    });

  const winner = ranked[0];
  if (!winner) {
    return null;
  }

  return {
    targetIndex: winner.node.index,
    snippetMatched: winner.snippetMatched,
  };
}

function collectStatementAncestors(nodes: TraversedNode[], startIndex: number): number[] {
  const result: number[] = [];
  let current: number | null = startIndex;

  while (current !== null) {
    const currentNode: TraversedNode | undefined = nodes[current];
    if (!currentNode) {
      break;
    }
    if (isStatementLike(currentNode.type)) {
      result.push(current);
    }
    current = currentNode.parentIndex;
  }

  return result;
}

function applyReplacementByRange(
  source: string,
  start: number,
  end: number,
  replacement: string
): string {
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

export function parseSandpackErrorSignal(
  message: string,
  fallbackFilePath?: string
): SandpackCompileErrorSignal | null {
  if (!message || !message.trim()) {
    return null;
  }

  const normalized = message.replace(/\r\n/g, '\n');
  const fileMatch = normalized.match(/((?:\/|\.\/)?[\w./-]+\.(?:[cm]?[jt]sx?)):(\d+):(\d+)/);
  const filePath = fileMatch?.[1] || fallbackFilePath;
  if (!filePath) {
    return null;
  }

  const { line } = parseLineColumn(fileMatch?.[0] || normalized);
  const snippetMatch = normalized.match(/^[>|]\s*(.+)$/m);
  const snippet = snippetMatch?.[1]?.trim() || undefined;

  return {
    filePath,
    line,
    snippet,
    rawMessage: normalized,
  };
}

export function applyAstReplacePatch(
  files: Record<string, string>,
  patch: AstReplacePatchV2
): AstReplaceOutcome {
  const source = files[patch.filePath];
  if (typeof source !== 'string') {
    return {
      ok: false,
      files,
      reason: `target file not found: ${patch.filePath}`,
      code: 'AST_APPLY_FAILED',
    };
  }

  const selector = patch.selector;
  if (!selector || !hasEffectiveSelector(selector)) {
    return {
      ok: false,
      files,
      reason: 'selector is empty or invalid',
      code: 'AST_SELECTOR_NOT_FOUND',
    };
  }

  if (patch.filePath.toLowerCase().endsWith('.json')) {
    if (selector.contains && !normalize(source).includes(normalize(selector.contains))) {
      return {
        ok: false,
        files,
        reason: 'selector did not match target json file',
        code: 'AST_SELECTOR_NOT_FOUND',
      };
    }
    try {
      JSON.parse(patch.replacement);
    } catch (error) {
      return {
        ok: false,
        files,
        reason: error instanceof Error ? error.message : String(error),
        code: 'AST_REPLACEMENT_INVALID',
      };
    }

    const nextFiles = {
      ...files,
      [patch.filePath]: patch.replacement,
    };
    return {
      ok: true,
      files: nextFiles,
      touchedFile: patch.filePath,
    };
  }

  const parsed = parseProgram(patch.filePath, source);
  if (!parsed.program) {
    return {
      ok: false,
      files,
      reason: parsed.errors[0] || 'failed to parse source file',
      code: 'AST_APPLY_FAILED',
    };
  }

  const nodes = collectNodes(parsed.program);
  const target = findBestNode(nodes, selector, source);
  if (!target) {
    return {
      ok: false,
      files,
      reason: 'selector did not match any AST node',
      code: 'AST_SELECTOR_NOT_FOUND',
    };
  }

  const validation = validateReplacement(patch.filePath, patch.replacement);
  if (!validation.ok) {
    return {
      ok: false,
      files,
      reason: validation.reason || 'invalid replacement fragment',
      code: 'AST_REPLACEMENT_INVALID',
    };
  }

  const replacement = buildReplacementForNode(target, patch.replacement, validation);
  const nextContent = applyReplacementByRange(source, target.start, target.end, replacement);
  const nextFiles = {
    ...files,
    [patch.filePath]: nextContent,
  };

  const gate = runSyntaxGate(nextFiles, [patch.filePath]);
  if (!gate.ok) {
    return {
      ok: false,
      files,
      reason: gate.errors[0]?.message || 'syntax gate failed after ast replacement',
      code: 'AST_APPLY_FAILED',
    };
  }

  return {
    ok: true,
    files: nextFiles,
    touchedFile: patch.filePath,
  };
}

export function applyAstSurgery(
  files: Record<string, string>,
  signal: SandpackCompileErrorSignal
): AstSurgeryOutcome {
  const source = files[signal.filePath];
  if (typeof source !== 'string') {
    return {
      ok: false,
      files,
      reason: `target file not found: ${signal.filePath}`,
    };
  }

  const parsed = parseProgram(signal.filePath, source);
  if (!parsed.program) {
    return {
      ok: false,
      files,
      reason: parsed.errors[0] || 'failed to parse source for surgery',
    };
  }

  const nodes = collectNodes(parsed.program);
  if (nodes.length === 0) {
    return {
      ok: false,
      files,
      reason: 'semantic dual-check failed: parser did not return traversable AST nodes',
    };
  }

  const lineOffsets = buildLineOffsets(source);
  const selected = selectSurgeryTarget(nodes, source, signal, lineOffsets);
  if (!selected) {
    return {
      ok: false,
      files,
      reason:
        'semantic dual-check failed: unable to locate a statement matching both line proximity and snippet fingerprint',
    };
  }

  const chain = collectStatementAncestors(nodes, selected.targetIndex);
  if (chain.length === 0) {
    return {
      ok: false,
      files,
      reason: 'failed to build statement ancestor chain',
    };
  }

  for (let index = 0; index < chain.length; index += 1) {
    const node = nodes[chain[index] as number];
    if (!node) {
      continue;
    }

    const candidate = applyReplacementByRange(source, node.start, node.end, '');
    const nextFiles = {
      ...files,
      [signal.filePath]: candidate,
    };
    const gate = runSyntaxGate(nextFiles, [signal.filePath]);
    if (!gate.ok) {
      continue;
    }

    return {
      ok: true,
      files: nextFiles,
      touchedFile: signal.filePath,
      report: {
        strategy: index === 0 ? 'semantic-dual-check' : 'lca-amputation',
        targetType: node.type,
        targetLine:
          typeof signal.line === 'number'
            ? signal.line
            : offsetToLine(node.start, lineOffsets),
        snippetMatched: selected.snippetMatched,
      },
    };
  }

  return {
    ok: false,
    files,
    reason: 'all LCA amputation attempts failed syntax gate',
  };
}
