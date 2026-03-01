import React, { useMemo } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import {
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from '@codesandbox/sandpack-react';
import { useProjectStore } from '../../lib/stores/projectStore';

type ProjectFile = { path: string; content: string };

const DEFAULT_SANDBOX_BUNDLER_URL = 'https://sandpack-bundler.codesandbox.io';
const SANDBOX_LAYOUT_PATCH = `
  .sp-wrapper,
  .sp-layout,
  .sp-stack,
  .sp-preview,
  .sp-preview-container,
  .sp-preview-iframe {
    height: 100% !important;
    min-height: 100% !important;
  }
`;

type PathAliasRule = {
  aliasPrefix: string;
  targetPrefix: string;
};

const SOURCE_FILE_MATCHER = /\.(tsx|ts|jsx|js|mjs|cjs)$/i;
const IMPORT_SPECIFIER_PATTERN =
  /\bfrom\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const MODULE_RESOLUTION_EXTENSIONS = [
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.json',
];

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function normalizeFiles(files: ProjectFile[]): Record<string, string> {
  const result: Record<string, string> = {};
  files.forEach(file => {
    result[normalizePath(file.path)] = file.content;
  });
  return result;
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

function stripJsonComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function parseJsonLike(content: string): unknown | null {
  const stripped = stripJsonComments(content).replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function collectPathAliasRules(files: Record<string, string>): PathAliasRule[] {
  const rules: PathAliasRule[] = [];

  Object.entries(files).forEach(([filePath, content]) => {
    if (!/\.json$/i.test(filePath)) return;
    if (!/compilerOptions/.test(content) || !/paths/.test(content)) return;

    const parsed = parseJsonLike(content);
    if (!parsed || typeof parsed !== 'object') return;

    const compilerOptions = (parsed as { compilerOptions?: unknown }).compilerOptions;
    if (!compilerOptions || typeof compilerOptions !== 'object') return;

    const baseUrlRaw = (compilerOptions as { baseUrl?: unknown }).baseUrl;
    const baseUrl = typeof baseUrlRaw === 'string' ? baseUrlRaw : '.';
    const paths = (compilerOptions as { paths?: unknown }).paths;
    if (!paths || typeof paths !== 'object') return;

    const configDir = dirname(filePath);
    const resolvedBase = joinPath(configDir, baseUrl);

    Object.entries(paths as Record<string, unknown>).forEach(([aliasPattern, targetList]) => {
      if (!Array.isArray(targetList) || targetList.length === 0) return;
      const firstTarget = targetList.find(item => typeof item === 'string');
      if (typeof firstTarget !== 'string') return;

      const aliasPrefix = aliasPattern.replace(/\*.*$/, '');
      const targetPrefix = firstTarget.replace(/\*.*$/, '');
      if (!aliasPrefix || !targetPrefix) return;

      rules.push({
        aliasPrefix,
        targetPrefix: joinPath(resolvedBase, targetPrefix),
      });
    });
  });

  return rules.sort((a, b) => b.aliasPrefix.length - a.aliasPrefix.length);
}

function resolveModulePath(targetBase: string, files: Record<string, string>): string | undefined {
  const normalizedBase = normalizePath(targetBase);
  if (files[normalizedBase]) return normalizedBase;

  for (const ext of MODULE_RESOLUTION_EXTENSIONS) {
    const direct = `${normalizedBase}${ext}`;
    if (files[direct]) return direct;
  }

  for (const ext of MODULE_RESOLUTION_EXTENSIONS) {
    const indexPath = normalizePath(`${normalizedBase}/index${ext}`);
    if (files[indexPath]) return indexPath;
  }

  return undefined;
}

function resolveAliasedSpecifier(
  specifier: string,
  files: Record<string, string>,
  aliasRules: PathAliasRule[],
): string | undefined {
  for (const rule of aliasRules) {
    if (!specifier.startsWith(rule.aliasPrefix)) continue;
    const remainder = specifier.slice(rule.aliasPrefix.length);
    const candidate = joinPath(rule.targetPrefix, remainder);
    const resolved = resolveModulePath(candidate, files);
      if (resolved) return resolved;
  }
  const fallbackResolved = resolveAliasBySuffixSearch(specifier, files);
  if (fallbackResolved) return fallbackResolved;
  return undefined;
}

function resolveAliasBySuffixSearch(
  specifier: string,
  files: Record<string, string>,
): string | undefined {
  if (!specifier.startsWith('@') || !specifier.includes('/')) {
    return undefined;
  }

  const normalized = specifier.slice(1);
  let token = '';
  let rest = '';

  if (normalized.startsWith('/')) {
    rest = normalized.slice(1);
  } else {
    const segments = normalized.split('/');
    token = segments.shift() || '';
    rest = segments.join('/');
  }

  const suffixCandidates = new Set<string>();
  if (token && rest) suffixCandidates.add(`${token}/${rest}`);
  if (rest) suffixCandidates.add(rest);
  if (token && !rest) suffixCandidates.add(token);

  const resolveSuffix = (suffix: string): string | undefined => {
    const normalizedSuffix = suffix.replace(/^\/+/, '');
    if (!normalizedSuffix) return undefined;

    const suffixVariants = [
      `/${normalizedSuffix}`,
      ...MODULE_RESOLUTION_EXTENSIONS.map(ext => `/${normalizedSuffix}${ext}`),
      ...MODULE_RESOLUTION_EXTENSIONS.map(ext => `/${normalizedSuffix}/index${ext}`),
    ];

    for (const variant of suffixVariants) {
      const matches = Object.keys(files).filter(path => path.endsWith(variant));
      if (matches.length > 0) {
        matches.sort((a, b) => a.length - b.length);
        return matches[0];
      }
    }

    return undefined;
  };

  for (const suffix of suffixCandidates) {
    const resolved = resolveSuffix(suffix);
    if (resolved) return resolved;
  }

  return undefined;
}

function rewriteAliasedImports(files: Record<string, string>): Record<string, string> {
  const aliasRules = collectPathAliasRules(files);

  const rewritten: Record<string, string> = { ...files };
  const sourceFileMatcher = /\.(tsx|ts|jsx|js|mjs|cjs)$/i;

  Object.entries(files).forEach(([path, content]) => {
    if (!sourceFileMatcher.test(path)) return;

    const nextContent = content
      .replace(/(\bfrom\s+['"])([^'"]+)(['"])/g, (full, head, specifier, tail) => {
        if (!specifier.startsWith('@')) return full;
        const resolved = resolveAliasedSpecifier(specifier, files, aliasRules);
        return resolved ? `${head}${resolved}${tail}` : full;
      })
      .replace(/(\bimport\s*\(\s*['"])([^'"]+)(['"]\s*\))/g, (full, head, specifier, tail) => {
        if (!specifier.startsWith('@')) return full;
        const resolved = resolveAliasedSpecifier(specifier, files, aliasRules);
        return resolved ? `${head}${resolved}${tail}` : full;
      })
      .replace(/(\brequire\s*\(\s*['"])([^'"]+)(['"]\s*\))/g, (full, head, specifier, tail) => {
        if (!specifier.startsWith('@')) return full;
        const resolved = resolveAliasedSpecifier(specifier, files, aliasRules);
        return resolved ? `${head}${resolved}${tail}` : full;
      });

    rewritten[path] = nextContent;
  });

  return rewritten;
}

function listImportSpecifiers(content: string): string[] {
  IMPORT_SPECIFIER_PATTERN.lastIndex = 0;
  const specifiers: string[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = IMPORT_SPECIFIER_PATTERN.exec(content)) !== null) {
    const specifier = (match[1] || match[2] || match[3] || '').trim();
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function resolveRuntimeImportPath(
  files: Record<string, string>,
  aliasRules: PathAliasRule[],
  fromPath: string,
  specifier: string,
): string | undefined {
  if (specifier.startsWith('.')) {
    const candidate = joinPath(dirname(fromPath), specifier);
    return resolveModulePath(candidate, files);
  }

  if (specifier.startsWith('/')) {
    return resolveModulePath(specifier, files);
  }

  if (specifier.startsWith('@')) {
    return resolveAliasedSpecifier(specifier, files, aliasRules);
  }

  const normalized = specifier.replace(/^\/+/, '');
  if (!normalized) return undefined;
  return resolveModulePath(`/${normalized}`, files);
}

function isLikelyLocalImport(
  files: Record<string, string>,
  aliasRules: PathAliasRule[],
  fromPath: string,
  specifier: string,
): boolean {
  if (!specifier || specifier.startsWith('node:')) {
    return false;
  }

  if (specifier.startsWith('.')) {
    return true;
  }

  if (specifier.startsWith('/')) {
    return true;
  }

  if (specifier.startsWith('@')) {
    if (specifier.startsWith('@/')) {
      return true;
    }
    return Boolean(resolveAliasedSpecifier(specifier, files, aliasRules));
  }

  return Boolean(resolveRuntimeImportPath(files, aliasRules, fromPath, specifier));
}

function extractPackageDependencies(files: Record<string, string>): Record<string, string> {
  const packageEntry = Object.entries(files).find(([path]) => /(^|\/)package\.json$/i.test(path));
  if (!packageEntry) {
    return {};
  }

  const parsed = parseJsonLike(packageEntry[1]);
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }

  const dependencies = (parsed as { dependencies?: unknown }).dependencies;
  if (!dependencies || typeof dependencies !== 'object') {
    return {};
  }

  const result: Record<string, string> = {};
  Object.entries(dependencies as Record<string, unknown>).forEach(([name, version]) => {
    if (typeof name !== 'string' || typeof version !== 'string') {
      return;
    }
    const trimmedName = name.trim();
    const trimmedVersion = version.trim();
    if (!trimmedName || !trimmedVersion) {
      return;
    }
    result[trimmedName] = trimmedVersion;
  });

  return result;
}

function inferCompanionDependencies(files: Record<string, string>): Record<string, string> {
  const source = Object.values(files).join('\n');
  const inferred: Record<string, string> = {};

  if (/\bzustand\b/.test(source)) {
    inferred['use-sync-external-store'] = '^1.2.0';
  }

  if (/zustand\/middleware(\/immer)?/.test(source)) {
    inferred.immer = '^10.1.1';
  }

  return inferred;
}

function buildSandpackDependencies(
  packageDependencies: Record<string, string>,
  inferredCompanionDependencies: Record<string, string>,
  inferredRuntimeDependencies: Record<string, string>,
  dependencyMap: Record<string, string>,
  missingDependencies: Record<string, string>,
): Record<string, string> {
  const baseDependencies: Record<string, string> = {
    react: '^18.3.1',
    'react-dom': '^18.3.1',
    'lucide-react': 'latest',
  };

  const sanitizedPackageDependencies = Object.fromEntries(
    Object.entries(packageDependencies).filter(([name]) => name !== 'react' && name !== 'react-dom'),
  );
  const sanitizedRuntimeDependencies = Object.fromEntries(
    Object.entries(dependencyMap).filter(([name]) => name !== 'react' && name !== 'react-dom'),
  );

  const merged: Record<string, string> = {
    ...baseDependencies,
    ...sanitizedPackageDependencies,
    ...inferredCompanionDependencies,
    ...inferredRuntimeDependencies,
    ...sanitizedRuntimeDependencies,
    ...missingDependencies,
  };

  const packageReact = packageDependencies.react;
  const packageReactDom = packageDependencies['react-dom'];
  const runtimeReact = dependencyMap.react;
  const runtimeReactDom = dependencyMap['react-dom'];

  if (runtimeReact && runtimeReactDom) {
    merged.react = runtimeReact;
    merged['react-dom'] = runtimeReactDom;
  } else if (runtimeReact && !runtimeReactDom) {
    merged.react = runtimeReact;
    merged['react-dom'] = runtimeReact;
  } else if (!runtimeReact && runtimeReactDom) {
    merged.react = runtimeReactDom;
    merged['react-dom'] = runtimeReactDom;
  } else if (packageReact && packageReactDom) {
    merged.react = packageReact;
    merged['react-dom'] = packageReactDom;
  }

  if (merged.react !== merged['react-dom']) {
    if (merged.react === 'latest' || merged['react-dom'] === 'latest') {
      merged.react = 'latest';
      merged['react-dom'] = 'latest';
    } else {
      merged.react = merged['react-dom'];
    }
  }

  return merged;
}

function extractMissingModuleDependencies(message: string | undefined): Record<string, string> {
  if (!message) return {};

  const result: Record<string, string> = {};
  const pattern = /Cannot find module ['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(message)) !== null) {
    const specifier = (match[1] || '').trim();
    if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
      continue;
    }

    if (specifier.startsWith('@')) {
      const segments = specifier.split('/');
      if (segments.length >= 2) {
        result[`${segments[0]}/${segments[1]}`] = 'latest';
      }
      continue;
    }

    const packageName = specifier.split('/')[0];
    if (packageName) {
      result[packageName] = 'latest';
    }
  }

  return result;
}

function extractRuntimeDependencies(
  files: Record<string, string>,
  entryPath: string | undefined,
): Record<string, string> {
  if (!entryPath) return {};

  const inferred: Record<string, string> = {};
  const aliasRules = collectPathAliasRules(files);
  const knownNodeBuiltins = new Set([
    'assert',
    'buffer',
    'child_process',
    'crypto',
    'events',
    'fs',
    'http',
    'https',
    'module',
    'os',
    'path',
    'process',
    'stream',
    'timers',
    'url',
    'util',
    'v8',
    'zlib',
  ]);

  const resolvePackageName = (specifier: string): string | null => {
    if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return null;
    if (specifier.startsWith('node:')) return null;
    if (specifier.startsWith('@')) {
      if (isLikelyLocalImport(files, aliasRules, '/', specifier)) return null;
    }

    if (specifier.startsWith('@')) {
      const parts = specifier.split('/');
      if (parts.length < 2) return null;
      return `${parts[0]}/${parts[1]}`;
    }

    const firstSegment = specifier.split('/')[0];
    return firstSegment || null;
  };

  const visited = new Set<string>();
  const queue: string[] = [];
  const normalizedEntry = normalizePath(entryPath);
  if (files[normalizedEntry]) {
    queue.push(normalizedEntry);
  }

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (visited.has(current)) continue;
    visited.add(current);

    const content = files[current];
    if (!content || !SOURCE_FILE_MATCHER.test(current)) continue;

    const specifiers = listImportSpecifiers(content);
    for (const specifier of specifiers) {
      if (!specifier) continue;

      const runtimePath = resolveRuntimeImportPath(files, aliasRules, current, specifier);
      if (runtimePath && !visited.has(runtimePath)) {
        queue.push(runtimePath);
        continue;
      }

      if (isLikelyLocalImport(files, aliasRules, current, specifier)) {
        continue;
      }

      const packageName = resolvePackageName(specifier);
      if (!packageName || knownNodeBuiltins.has(packageName)) continue;
      if (!(packageName in inferred)) {
        inferred[packageName] = 'latest';
      }
    }
  }

  return inferred;
}

function evaluateEntryCandidate(
  files: Record<string, string>,
  aliasRules: PathAliasRule[],
  entryPath: string,
): { path: string; score: number; reachableFiles: number; unresolvedLocalImports: number } {
  const normalizedEntry = normalizePath(entryPath);
  const visited = new Set<string>();
  const queue: string[] = files[normalizedEntry] ? [normalizedEntry] : [];
  let unresolvedLocalImports = 0;

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (visited.has(current)) continue;
    visited.add(current);

    const content = files[current];
    if (!content || !SOURCE_FILE_MATCHER.test(current)) continue;

    const specifiers = listImportSpecifiers(content);
    for (const specifier of specifiers) {
      const resolved = resolveRuntimeImportPath(files, aliasRules, current, specifier);
      if (resolved) {
        if (!visited.has(resolved)) {
          queue.push(resolved);
        }
        continue;
      }

      if (isLikelyLocalImport(files, aliasRules, current, specifier)) {
        unresolvedLocalImports += 1;
      }
    }
  }

  const source = files[normalizedEntry] || '';
  let score = 0;
  if (/\bcreateRoot\s*\(/.test(source) || /\bReactDOM\.render\s*\(/.test(source)) score += 100;
  if (/\bdocument\.getElementById\s*\(/.test(source) && /\brender\s*\(/.test(source)) score += 40;
  if (/\bRouterProvider\b|\bBrowserRouter\b/.test(source)) score += 20;
  if (/^\s*import\s+/m.test(source)) score += 10;
  if (/\bexport\s+default\b/.test(source) && !/\brender\s*\(/.test(source)) score -= 30;

  score += Math.min(80, visited.size * 5);
  score -= unresolvedLocalImports * 120;
  if (visited.size <= 1 && unresolvedLocalImports > 0) {
    score -= 160;
  }

  return {
    path: normalizedEntry,
    score,
    reachableFiles: visited.size,
    unresolvedLocalImports,
  };
}

function resolveEntryFile(files: Record<string, string>): string | undefined {
  const codeEntries = Object.keys(files).filter(path => SOURCE_FILE_MATCHER.test(path));
  if (codeEntries.length === 0) return undefined;

  const aliasRules = collectPathAliasRules(files);
  const scored = codeEntries.map(path => evaluateEntryCandidate(files, aliasRules, path));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.unresolvedLocalImports !== b.unresolvedLocalImports) {
      return a.unresolvedLocalImports - b.unresolvedLocalImports;
    }
    if (b.reachableFiles !== a.reachableFiles) {
      return b.reachableFiles - a.reachableFiles;
    }
    return a.path.localeCompare(b.path);
  });

  const best = scored[0];
  if (!best) return undefined;
  if (best.score <= 0 && best.reachableFiles <= 1) return undefined;
  return best.path;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

function buildFilesSignature(files: ProjectFile[]): string {
  const joined = files
    .map(file => `${normalizePath(file.path)}:${hashString(file.content || '')}`)
    .sort()
    .join('|');
  return hashString(joined);
}

function SandpackStatusBridge(props: {
  onMissingDependencies: (dependencies: Record<string, string>) => void;
}): null {
  const { sandpack } = useSandpack();
  const setExecutorState = useProjectStore(state => state.setExecutorState);
  const sandpackStatus = String((sandpack as { status?: string }).status || 'idle');

  React.useEffect(() => {
    if (sandpackStatus === 'running' || sandpackStatus === 'transpiling') {
      setExecutorState({
        phase: 'compiling',
        executorId: 'sandpack-renderer',
        message: 'Building...',
        error: null,
      });
    } else if (sandpackStatus === 'idle') {
      setExecutorState({
        phase: 'rendering-code',
        executorId: 'sandpack-renderer',
        message: 'Ready',
        error: null,
      });
    }
  }, [sandpackStatus, setExecutorState]);

  React.useEffect(() => {
    const missing = extractMissingModuleDependencies(sandpack.error?.message);
    if (Object.keys(missing).length === 0) return;
    props.onMissingDependencies(missing);
  }, [props.onMissingDependencies, sandpack.error?.message]);

  return null;
}

const PreviewViewComponent: React.FC = () => {
  const {
    files,
    error,
    executorState,
    dependencyMap,
    dependencySignature,
    setExecutorState,
  } = useProjectStore();

  const sourceSignature = useMemo(() => buildFilesSignature(files), [files]);

  const normalizedFiles = useMemo(() => {
    const base = normalizeFiles(files);
    return rewriteAliasedImports(base);
  }, [sourceSignature]);
  const packageDependencies = useMemo(
    () => extractPackageDependencies(normalizedFiles),
    [normalizedFiles],
  );
  const inferredCompanionDependencies = useMemo(
    () => inferCompanionDependencies(normalizedFiles),
    [normalizedFiles],
  );

  const resolvedEntry = useMemo(() => resolveEntryFile(normalizedFiles), [normalizedFiles]);
  const inferredRuntimeDependencies = useMemo(
    () => extractRuntimeDependencies(normalizedFiles, resolvedEntry),
    [normalizedFiles, resolvedEntry],
  );
  const [missingDependencies, setMissingDependencies] = React.useState<Record<string, string>>({});
  const registerMissingDependencies = React.useCallback((dependencies: Record<string, string>) => {
    setMissingDependencies(previous => {
      const next = { ...previous };
      let changed = false;
      Object.entries(dependencies).forEach(([name, version]) => {
        if (!name || next[name]) return;
        next[name] = version;
        changed = true;
      });
      return changed ? next : previous;
    });
  }, []);
  React.useEffect(() => {
    setMissingDependencies({});
  }, [sourceSignature]);
  const sandpackDependencies = useMemo(
    () =>
      buildSandpackDependencies(
        packageDependencies,
        inferredCompanionDependencies,
        inferredRuntimeDependencies,
        dependencyMap,
        missingDependencies,
      ),
    [
      packageDependencies,
      inferredCompanionDependencies,
      inferredRuntimeDependencies,
      dependencyMap,
      missingDependencies,
    ],
  );
  const { sandpackFiles, sandpackEntry } = useMemo(() => {
    const nextFiles = { ...normalizedFiles };
    if (!resolvedEntry) {
      return { sandpackFiles: nextFiles, sandpackEntry: undefined as string | undefined };
    }

    const normalizedEntry = normalizePath(resolvedEntry);
    const hasRootIndex = Object.keys(nextFiles).some(path => /^\/index\.[^/]+$/i.test(path));
    const isRootIndexEntry = /^\/index\.[^/]+$/i.test(normalizedEntry);

    if (!hasRootIndex && !isRootIndexEntry) {
      const entryImportPath = normalizedEntry.startsWith('/') ? `.${normalizedEntry}` : normalizedEntry;
      nextFiles['/index.tsx'] = `import '${entryImportPath}';\n`;
      return { sandpackFiles: nextFiles, sandpackEntry: '/index.tsx' };
    }

    return { sandpackFiles: nextFiles, sandpackEntry: normalizedEntry };
  }, [normalizedFiles, resolvedEntry]);

  const remountKey = useMemo(
    () => `sp-${sourceSignature}-${dependencySignature || 'deps'}`,
    [sourceSignature, dependencySignature],
  );
  const configuredBundlerURL = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env?.VITE_SANDBOX_BUNDLER_URL;
  const bundlerURL =
    typeof configuredBundlerURL === 'string' && configuredBundlerURL.trim().length > 0
      ? configuredBundlerURL.trim()
      : DEFAULT_SANDBOX_BUNDLER_URL;

  return (
    <div className="flex-1 w-full h-full min-h-0 overflow-hidden relative flex flex-col bg-white">
      {(error || executorState.error) && (
        <div className="absolute inset-x-0 top-0 z-50 bg-red-600 text-white p-3 flex items-center gap-3 shadow-xl">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <div className="text-[10px] font-bold truncate flex-1">{executorState.error || error}</div>
          <button
            onClick={() => setExecutorState({ ...executorState, error: null })}
            className="p-1 hover:bg-white/20 rounded"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex-1 w-full min-h-0 overflow-hidden relative">
        {files.length > 0 ? (
          <>
            <style>{SANDBOX_LAYOUT_PATCH}</style>
            <SandpackProvider
              key={remountKey}
              template="react-ts"
              files={sandpackFiles}
              customSetup={{
                dependencies: sandpackDependencies,
                ...(sandpackEntry ? { entry: sandpackEntry } : {}),
              }}
              options={{
                bundlerURL,
                recompileMode: 'immediate',
                initMode: 'immediate',
              }}
            >
              <SandpackStatusBridge onMissingDependencies={registerMissingDependencies} />
              <SandpackLayout
                style={{ height: '100%', width: '100%', border: 'none', background: 'transparent' }}
              >
                <SandpackPreview
                  style={{ height: '100%', width: '100%', border: 'none' }}
                  showOpenInCodeSandbox={false}
                  showRefreshButton={false}
                  showSandpackErrorOverlay
                />
              </SandpackLayout>
            </SandpackProvider>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full opacity-20">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        )}
      </div>

      {(executorState.phase === 'compiling' || executorState.phase === 'bootstrapping') && (
        <div className="absolute top-4 right-4 z-40 bg-white/80 backdrop-blur-sm border border-gray-100 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-sm animate-in fade-in">
          <Loader2 className="w-3 h-3 text-blue-600 animate-spin" />
          <span className="text-[10px] font-bold text-gray-600 uppercase">Updating</span>
        </div>
      )}
    </div>
  );
};

export const PreviewView = React.memo(PreviewViewComponent, () => false);
PreviewView.displayName = 'PreviewView';
