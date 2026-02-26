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

const FRONTEND_TOP_LEVEL_ALLOWLIST = new Set<string>([
  'src',
  'public',
  'assets',
  'app',
  'components',
  'styles',
  'hooks',
  'utils',
  'lib',
  'types',
  'data',
  'config',
  'research',
  'docs',
  'index.html',
  'package.json',
  'vite.config.ts',
  'vite.config.js',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'postcss.config.js',
  'tailwind.config.js',
  'tailwind.config.ts',
  'README.md',
  '.env',
  '.env.local',
]);

const RESERVED_TOP_LEVEL_PREFIXES = ['backend/', 'shared-types/', 'frontend/'];
const RESERVED_SRC_SEGMENTS = new Set<string>([
  'orchestration',
  'tool',
  'llm',
  'security',
  'storage',
  'validation',
  'monitoring',
  'rendering',
  'auth',
  'prompt',
]);

function normalizePath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  return normalized.replace(/^frontend\//i, '');
}

function unwrapSyntheticRoot(normalizedPath: string): string {
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length < 2) {
    return normalizedPath;
  }

  const topLevel = segments[0] || '';
  if (!topLevel || FRONTEND_TOP_LEVEL_ALLOWLIST.has(topLevel)) {
    return normalizedPath;
  }

  if (RESERVED_TOP_LEVEL_PREFIXES.some(prefix => normalizedPath.startsWith(prefix))) {
    return normalizedPath;
  }

  const candidate = segments.slice(1).join('/');
  if (!candidate) {
    return normalizedPath;
  }

  const candidateTopLevel = getTopLevelSegment(candidate);
  if (!candidateTopLevel || !FRONTEND_TOP_LEVEL_ALLOWLIST.has(candidateTopLevel)) {
    return normalizedPath;
  }

  if (candidateTopLevel === 'src') {
    const srcSegment = getSrcChildSegment(candidate);
    if (srcSegment && RESERVED_SRC_SEGMENTS.has(srcSegment)) {
      return normalizedPath;
    }
  }

  return candidate;
}

function getTopLevelSegment(inputPath: string): string {
  return normalizePath(inputPath).split('/').filter(Boolean)[0] || '';
}

function getSrcChildSegment(inputPath: string): string {
  const segments = normalizePath(inputPath).split('/').filter(Boolean);
  if (segments[0] !== 'src') return '';
  const second = segments[1] || '';
  if (!second) return '';

  // src/main.tsx, src/App.tsx should be treated as root files instead of nested segments.
  if (segments.length === 2 && second.includes('.')) {
    return '';
  }
  return second;
}

function collectTopLevelSegments(files: PathLike[]): Set<string> {
  const segments = new Set<string>();
  for (const file of files) {
    const top = getTopLevelSegment(file.path);
    if (top) {
      segments.add(top);
    }
  }
  return segments;
}

function hasSessionRootPackage(files: PathLike[]): boolean {
  return files.some(file => normalizePath(file.path) === 'package.json');
}

function isInitialArtifactPathAllowed(normalizedPath: string): boolean {
  const topLevel = getTopLevelSegment(normalizedPath);
  if (!topLevel || !FRONTEND_TOP_LEVEL_ALLOWLIST.has(topLevel)) {
    return false;
  }

  if (topLevel === 'src') {
    const srcSegment = getSrcChildSegment(normalizedPath);
    if (srcSegment && RESERVED_SRC_SEGMENTS.has(srcSegment)) {
      return false;
    }
  }

  return true;
}

export function normalizeGeneratedArtifactPaths<T extends PathLike>(
  files: T[],
  existingFiles: PathLike[] = []
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

  const hasRootPackageInBatch = normalizedFiles.some(file => file.path === `${commonRoot}/package.json`);
  const knownTopLevels = new Set<string>([
    ...collectTopLevelSegments(existingFiles),
    ...FRONTEND_TOP_LEVEL_ALLOWLIST,
  ]);
  const shouldStripCommonRoot =
    hasRootPackageInBatch || (!knownTopLevels.has(commonRoot) && hasSessionRootPackage(existingFiles));

  if (!shouldStripCommonRoot) return normalizedFiles;

  return normalizedFiles.map(file => ({
    ...file,
    path: file.path.slice(commonRoot.length + 1),
  }));
}

export function evaluateRuntimeArtifactPath(
  filePath: string,
  existingFiles: StoredFile[]
): RuntimeArtifactPathDecision {
  const normalizedPath = unwrapSyntheticRoot(normalizePath(filePath));
  if (!normalizedPath || normalizedPath === '.' || normalizedPath === '..') {
    return {
      allowed: false,
      normalizedPath,
      reason: 'RUNTIME_ARTIFACT_PATH_BLOCKED: empty path is not allowed',
    };
  }

  for (const reservedPrefix of RESERVED_TOP_LEVEL_PREFIXES) {
    if (normalizedPath.startsWith(reservedPrefix)) {
      return {
        allowed: false,
        normalizedPath,
        reason: `RUNTIME_ARTIFACT_PATH_BLOCKED: "${normalizedPath}" is outside runtime artifact workspace`,
      };
    }
  }

  if (normalizedPath.startsWith('src/')) {
    const srcSegment = getSrcChildSegment(normalizedPath);
    if (srcSegment && RESERVED_SRC_SEGMENTS.has(srcSegment)) {
      return {
        allowed: false,
        normalizedPath,
        reason: `RUNTIME_ARTIFACT_PATH_BLOCKED: "${normalizedPath}" targets reserved backend source segment`,
      };
    }
  }

  if (existingFiles.length === 0) {
    if (!isInitialArtifactPathAllowed(normalizedPath)) {
      return {
        allowed: false,
        normalizedPath,
        reason: `RUNTIME_ARTIFACT_PATH_BLOCKED: "${normalizedPath}" is outside initial frontend artifact roots`,
      };
    }
    return { allowed: true, normalizedPath };
  }

  const existingPathSet = new Set(existingFiles.map(file => normalizePath(file.path)));
  if (existingPathSet.has(normalizedPath)) {
    return { allowed: true, normalizedPath };
  }

  const topLevel = getTopLevelSegment(normalizedPath);
  const knownTopLevels = new Set<string>([
    ...collectTopLevelSegments(existingFiles),
    ...FRONTEND_TOP_LEVEL_ALLOWLIST,
  ]);
  if (!topLevel || !knownTopLevels.has(topLevel)) {
    return {
      allowed: false,
      normalizedPath,
      reason: `RUNTIME_ARTIFACT_PATH_BLOCKED: "${normalizedPath}" is outside known frontend artifact roots`,
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
