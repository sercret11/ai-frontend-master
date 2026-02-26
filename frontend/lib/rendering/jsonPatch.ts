import type { AppGraph, JsonPatchOperation, PatchEnvelope } from '@ai-frontend/shared-types';

const ARRAY_APPEND_TOKEN = '-';

export interface JsonPatchApplyOptions {
  strict?: boolean;
  mutate?: boolean;
}

export interface PatchEnvelopeApplyOptions extends JsonPatchApplyOptions {
  now?: number;
  skipVersionCheck?: boolean;
}

export class JsonPatchApplyError extends Error {
  constructor(message: string, public readonly operation: JsonPatchOperation) {
    super(message);
    this.name = 'JsonPatchApplyError';
  }
}

function isObjectLike(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null;
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function parsePointer(path: string): string[] {
  if (path === '') {
    return [];
  }
  if (!path.startsWith('/')) {
    throw new Error(`Invalid JSON pointer: ${path}`);
  }
  return path.slice(1).split('/').map(decodePointerToken);
}

function parseArrayIndex(token: string, allowAppend: boolean): number | typeof ARRAY_APPEND_TOKEN {
  if (allowAppend && token === ARRAY_APPEND_TOKEN) {
    return ARRAY_APPEND_TOKEN;
  }
  if (!/^(0|[1-9]\d*)$/.test(token)) {
    throw new Error(`Invalid array index token: ${token}`);
  }
  return Number(token);
}

interface ParentTarget {
  container: Record<string, unknown> | unknown[];
  token: string;
}

function resolveParent(document: unknown, tokens: string[], createMissing: boolean): ParentTarget {
  if (tokens.length === 0) {
    throw new Error('Root path has no parent container');
  }

  let current: unknown = document;
  const parentTokens = tokens.slice(0, -1);

  for (const token of parentTokens) {
    if (Array.isArray(current)) {
      const index = parseArrayIndex(token, false);
      if (index === ARRAY_APPEND_TOKEN) {
        throw new Error('Append token is not allowed in non-terminal path');
      }
      if (index < 0 || index >= current.length) {
        throw new Error(`Array index out of range: ${index}`);
      }

      const nextValue = current[index];
      if (isObjectLike(nextValue)) {
        current = nextValue;
        continue;
      }

      if (!createMissing) {
        throw new Error(`Path segment is not traversable: ${token}`);
      }

      const created: Record<string, unknown> = {};
      current[index] = created;
      current = created;
      continue;
    }

    if (!isObjectLike(current)) {
      throw new Error(`Path segment is not traversable: ${token}`);
    }

    const objectContainer = current as Record<string, unknown>;
    const nextValue = objectContainer[token];

    if (isObjectLike(nextValue)) {
      current = nextValue;
      continue;
    }

    if (nextValue === undefined) {
      if (!createMissing) {
        throw new Error(`Missing path segment: ${token}`);
      }
      const created: Record<string, unknown> = {};
      objectContainer[token] = created;
      current = created;
      continue;
    }

    if (!createMissing) {
      throw new Error(`Path segment is not traversable: ${token}`);
    }
    const created: Record<string, unknown> = {};
    objectContainer[token] = created;
    current = created;
  }

  if (!isObjectLike(current)) {
    throw new Error('Resolved parent container is not object-like');
  }

  const token = tokens[tokens.length - 1];
  if (!token) {
    throw new Error('Failed to resolve final token');
  }

  return {
    container: current,
    token,
  };
}

function getValueByPath(document: unknown, path: string): unknown {
  const tokens = parsePointer(path);
  let current: unknown = document;

  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = parseArrayIndex(token, false);
      if (index === ARRAY_APPEND_TOKEN) {
        throw new Error('Append token is not allowed while reading value');
      }
      if (index < 0 || index >= current.length) {
        throw new Error(`Array index out of range: ${index}`);
      }
      current = current[index];
      continue;
    }

    if (!isObjectLike(current)) {
      throw new Error(`Path is not readable at segment: ${token}`);
    }

    const objectContainer = current as Record<string, unknown>;
    if (!(token in objectContainer)) {
      throw new Error(`Path segment does not exist: ${token}`);
    }
    current = objectContainer[token];
  }

  return current;
}

function addAtPath(document: unknown, path: string, value: unknown): unknown {
  if (path === '') {
    return value;
  }

  const tokens = parsePointer(path);
  const { container, token } = resolveParent(document, tokens, true);

  if (Array.isArray(container)) {
    const index = parseArrayIndex(token, true);
    if (index === ARRAY_APPEND_TOKEN) {
      container.push(value);
      return document;
    }
    if (index > container.length) {
      throw new Error(`Array index out of range for add: ${index}`);
    }
    container.splice(index, 0, value);
    return document;
  }

  container[token] = value;
  return document;
}

function removeAtPath(document: unknown, path: string): unknown {
  if (path === '') {
    return undefined;
  }

  const tokens = parsePointer(path);
  const { container, token } = resolveParent(document, tokens, false);

  if (Array.isArray(container)) {
    const index = parseArrayIndex(token, false);
    if (index === ARRAY_APPEND_TOKEN) {
      throw new Error('Append token is not allowed for remove');
    }
    if (index < 0 || index >= container.length) {
      throw new Error(`Array index out of range for remove: ${index}`);
    }
    container.splice(index, 1);
    return document;
  }

  if (!(token in container)) {
    throw new Error(`Path segment does not exist for remove: ${token}`);
  }
  delete container[token];
  return document;
}

function replaceAtPath(document: unknown, path: string, value: unknown): unknown {
  if (path === '') {
    return value;
  }

  const tokens = parsePointer(path);
  const { container, token } = resolveParent(document, tokens, false);

  if (Array.isArray(container)) {
    const index = parseArrayIndex(token, false);
    if (index === ARRAY_APPEND_TOKEN) {
      throw new Error('Append token is not allowed for replace');
    }
    if (index < 0 || index >= container.length) {
      throw new Error(`Array index out of range for replace: ${index}`);
    }
    container[index] = value;
    return document;
  }

  if (!(token in container)) {
    throw new Error(`Path segment does not exist for replace: ${token}`);
  }
  container[token] = value;
  return document;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }

  const leftIsObject = isObjectLike(left) && !Array.isArray(left);
  const rightIsObject = isObjectLike(right) && !Array.isArray(right);
  if (leftIsObject && rightIsObject) {
    const leftObject = left as Record<string, unknown>;
    const rightObject = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftObject);
    const rightKeys = Object.keys(rightObject);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    for (const key of leftKeys) {
      if (!(key in rightObject)) {
        return false;
      }
      if (!deepEqual(leftObject[key], rightObject[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

function applyOperation(document: unknown, operation: JsonPatchOperation): unknown {
  switch (operation.op) {
    case 'add':
      return addAtPath(document, operation.path, operation.value);
    case 'remove':
      return removeAtPath(document, operation.path);
    case 'replace':
      return replaceAtPath(document, operation.path, operation.value);
    case 'move': {
      const value = getValueByPath(document, operation.from);
      const removed = removeAtPath(document, operation.from);
      return addAtPath(removed, operation.path, value);
    }
    case 'copy': {
      const value = cloneValue(getValueByPath(document, operation.from));
      return addAtPath(document, operation.path, value);
    }
    case 'test': {
      const currentValue = getValueByPath(document, operation.path);
      if (!deepEqual(currentValue, operation.value)) {
        throw new Error(`Test operation failed at path: ${operation.path}`);
      }
      return document;
    }
    default:
      return document;
  }
}

/**
 * 应用 JSON Patch（RFC 6902）操作集合。
 */
export function applyJsonPatch<T>(
  input: T,
  operations: readonly JsonPatchOperation[],
  options: JsonPatchApplyOptions = {}
): T {
  const strict = options.strict ?? true;
  const mutate = options.mutate ?? false;
  let document: unknown = mutate ? input : cloneValue(input);

  for (const operation of operations) {
    try {
      document = applyOperation(document, operation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown JSON Patch error';
      if (strict) {
        throw new JsonPatchApplyError(message, operation);
      }
    }
  }

  return document as T;
}

/**
 * 将 PatchEnvelope 应用到 AppGraph。
 * 默认启用 graphId/baseVersion 的校验，避免错补丁污染运行时状态。
 */
export function applyPatchEnvelope(
  graph: AppGraph,
  envelope: PatchEnvelope,
  options: PatchEnvelopeApplyOptions = {}
): AppGraph {
  const strict = options.strict ?? true;

  if (envelope.graphId !== graph.graphId) {
    const message = `Patch graphId mismatch: expected ${graph.graphId}, got ${envelope.graphId}`;
    if (strict) {
      throw new Error(message);
    }
    return graph;
  }

  if (!options.skipVersionCheck && envelope.baseVersion !== graph.version) {
    const message = `Patch baseVersion mismatch: expected ${graph.version}, got ${envelope.baseVersion}`;
    if (strict) {
      throw new Error(message);
    }
    return graph;
  }

  const patchedGraph = applyJsonPatch(graph, envelope.operations, {
    strict,
    mutate: options.mutate,
  });

  if (!isObjectLike(patchedGraph) || Array.isArray(patchedGraph)) {
    throw new Error('Patched AppGraph is invalid');
  }

  const nextVersion =
    envelope.targetVersion ?? Math.max(graph.version + 1, envelope.baseVersion + 1);

  return {
    ...patchedGraph,
    graphId: graph.graphId,
    version: nextVersion,
    updatedAt: options.now ?? Date.now(),
  };
}
