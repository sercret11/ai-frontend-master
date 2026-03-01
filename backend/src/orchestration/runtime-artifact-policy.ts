import type { StoredFile } from '@ai-frontend/shared-types';

type PathLike = {
  path: string;
};

export interface RuntimeArtifactPathDecision {
  allowed: boolean;
  normalizedPath: string;
  reason?: string;
}

export interface RuntimeArtifactFilterResult<T extends PathLike> {
  accepted: T[];
  blocked: Array<{ path: string; reason: string }>;
}

function normalizePath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  return normalized;
}

function looksLikeSyntheticRootSegment(segment: string): boolean {
  return segment.includes('-') || segment.includes('_');
}

function unwrapSyntheticRoot(normalizedPath: string): string {
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length < 2) {
    return normalizedPath;
  }

  const topLevel = segments[0] || '';
  if (!topLevel || topLevel.includes('.')) {
    return normalizedPath;
  }

  const candidate = segments.slice(1).join('/');
  if (!candidate) {
    return normalizedPath;
  }

  const candidateTopLevel = getTopLevelSegment(candidate);
  const topLevelLooksSynthetic = looksLikeSyntheticRootSegment(topLevel);
  if (!candidateTopLevel || !topLevelLooksSynthetic) {
    return normalizedPath;
  }

  return candidate;
}

function getTopLevelSegment(inputPath: string): string {
  return normalizePath(inputPath).split('/').filter(Boolean)[0] || '';
}

export function normalizeGeneratedArtifactPaths<T extends PathLike>(
  files: T[],
  _existingFiles: PathLike[] = []
): T[] {
  if (files.length === 0) return files;

  const normalizedFiles = files.map(file => ({
    ...file,
    path: normalizePath(file.path),
  }));

  const firstSegments = normalizedFiles[0]?.path.split('/').filter(Boolean) || [];
  const commonRoot = firstSegments[0];
  if (!commonRoot) return normalizedFiles;

  const hasCommonRoot = normalizedFiles.every(file => file.path.startsWith(`${commonRoot}/`));
  if (!hasCommonRoot) return normalizedFiles;

  const strippedPaths = normalizedFiles.map(file => file.path.slice(commonRoot.length + 1));
  const hasNestedAfterStrip = strippedPaths.some(path => path.includes('/'));
  const hasRootFileAfterStrip = strippedPaths.some(path => !path.includes('/'));
  const commonRootLooksSynthetic = looksLikeSyntheticRootSegment(commonRoot);
  const shouldStripCommonRoot =
    commonRootLooksSynthetic &&
    hasNestedAfterStrip &&
    (hasRootFileAfterStrip || commonRootLooksSynthetic);

  if (!shouldStripCommonRoot) return normalizedFiles;

  return normalizedFiles.map(file => ({
    ...file,
    path: file.path.slice(commonRoot.length + 1),
  }));
}

export function evaluateRuntimeArtifactPath(
  filePath: string,
  _existingFiles: StoredFile[]
): RuntimeArtifactPathDecision {
  const normalizedPath = unwrapSyntheticRoot(normalizePath(filePath));
  if (!normalizedPath || normalizedPath === '.' || normalizedPath === '..') {
    return {
      allowed: false,
      normalizedPath,
      reason: 'RUNTIME_ARTIFACT_PATH_BLOCKED: empty path is not allowed',
    };
  }

  if (
    normalizedPath.startsWith('../') ||
    normalizedPath.includes('/../') ||
    normalizedPath.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalizedPath)
  ) {
    return {
      allowed: false,
      normalizedPath,
      reason: `RUNTIME_ARTIFACT_PATH_BLOCKED: "${normalizedPath}" is not a valid workspace-relative path`,
    };
  }

  return { allowed: true, normalizedPath };
}

export function filterRuntimeArtifactFiles<T extends PathLike>(
  files: T[],
  existingFiles: StoredFile[]
): RuntimeArtifactFilterResult<T> {
  const accepted: T[] = [];
  const blocked: Array<{ path: string; reason: string }> = [];
  const seen = new Set<string>();

  const baseline = [...existingFiles];
  for (const file of files) {
    const decision = evaluateRuntimeArtifactPath(file.path, baseline as StoredFile[]);
    if (!decision.allowed) {
      blocked.push({
        path: normalizePath(file.path),
        reason: decision.reason || 'RUNTIME_ARTIFACT_PATH_BLOCKED',
      });
      continue;
    }
    if (seen.has(decision.normalizedPath)) {
      continue;
    }
    seen.add(decision.normalizedPath);
    const normalizedFile = {
      ...file,
      path: decision.normalizedPath,
    };
    accepted.push(normalizedFile);
    baseline.push({
      id: `virtual-${baseline.length + 1}`,
      sessionID: '',
      path: decision.normalizedPath,
      content: '',
      language: 'text',
      size: 0,
      createdAt: Date.now(),
    });
  }

  return { accepted, blocked };
}
