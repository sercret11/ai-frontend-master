import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Terminal } from 'lucide-react';
import {
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from '@codesandbox/sandpack-react';
import type { SandpackPredefinedTemplate } from '@codesandbox/sandpack-react';
import { useProjectStore } from '../../lib/stores/projectStore';
import { applyAstSurgery, parseSandpackErrorSignal } from '../../lib/sandpack/ast-surgery';
import { canonicalizeProjectPath, normalizeProjectFiles } from '../../lib/services/path-utils';

type PreviewViewState = 'empty' | 'assembling' | 'code' | 'error' | 'idle';
type SandpackLifecycleState = 'ready' | 'disposing' | 'bootstrapping';
type SandpackBridgeMessage = {
  type: string;
  action?: string;
  error?: unknown;
};

function parseDependenciesFromPackageJson(content: string | undefined): Record<string, string> {
  if (!content) {
    return {};
  }

  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const normalize = (input: Record<string, unknown> | undefined): Record<string, string> => {
      if (!input) return {};
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'string') {
          next[key] = value;
        }
      }
      return next;
    };
    return {
      ...normalize(parsed.dependencies),
      ...normalize(parsed.devDependencies),
    };
  } catch {
    return {};
  }
}

function resolveTemplate(projectType: string | null): SandpackPredefinedTemplate {
  if (projectType === 'next-js') {
    return 'react-ts';
  }
  if (projectType === 'react-native') {
    return 'react-ts';
  }
  if (projectType === 'uniapp') {
    return 'react-ts';
  }
  return 'react-ts';
}

function normalizeFiles(files: Array<{ path: string; content: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of normalizeProjectFiles(files)) {
    const normalizedPath = canonicalizeProjectPath(file.path);
    if (!normalizedPath) {
      continue;
    }
    result[`/${normalizedPath}`] = file.content;
  }

  return result;
}

function toFileMap(files: Array<{ path: string; content: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const file of normalizeProjectFiles(files)) {
    const normalizedPath = canonicalizeProjectPath(file.path);
    if (!normalizedPath) {
      continue;
    }
    map[normalizedPath] = file.content;
  }
  return map;
}

function fromFileMap(files: Record<string, string>): Array<{ path: string; content: string }> {
  return normalizeProjectFiles(
    Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ path, content }))
  );
}

function SandpackStatusBridge(): null {
  const { sandpack } = useSandpack();
  const files = useProjectStore(state => state.files);
  const setFiles = useProjectStore(state => state.setFiles);
  const setPreviewMode = useProjectStore(state => state.setPreviewMode);
  const setInjuryMode = useProjectStore(state => state.setInjuryMode);
  const setLastSurgeryRecord = useProjectStore(state => state.setLastSurgeryRecord);
  const lastSurgeryRecord = useProjectStore(state => state.lastSurgeryRecord);
  const setExecutorState = useProjectStore(state => state.setExecutorState);
  const addLog = useProjectStore(state => state.addLog);
  const sandpackStatus = String((sandpack as unknown as { status?: string }).status || 'idle');

  React.useEffect(() => {
    if (sandpackStatus === 'running' || sandpackStatus === 'transpiling') {
      setExecutorState({
        phase: 'compiling',
        executorId: 'sandpack-renderer',
        message: `Sandpack ${sandpackStatus}`,
        error: null,
      });
    } else if (sandpackStatus === 'idle') {
      setExecutorState({
        phase: 'rendering-code',
        executorId: 'sandpack-renderer',
        message: 'Sandpack preview is ready.',
        error: null,
      });
    }
  }, [sandpackStatus, setExecutorState]);

  React.useEffect(() => {
    const sandpackWithListen = sandpack as typeof sandpack & {
      listen?: (listener: (msg: SandpackBridgeMessage) => void) => () => void;
    };
    if (typeof sandpackWithListen.listen !== 'function') {
      return;
    }

    const unsubscribe = sandpackWithListen.listen((msg: SandpackBridgeMessage) => {
      if (msg.type === 'done') {
        setExecutorState({
          phase: 'rendering-code',
          executorId: 'sandpack-renderer',
          message: 'Compile succeeded.',
          error: null,
        });
        return;
      }

      if (msg.type === 'start') {
        setExecutorState({
          phase: 'compiling',
          executorId: 'sandpack-renderer',
          message: 'Compiling sandbox...',
          error: null,
        });
        return;
      }

      if (msg.type === 'action' && msg.action === 'show-error') {
        const errorText = typeof msg.error === 'string' ? msg.error : 'Sandpack compile error';
        const signal = parseSandpackErrorSignal(errorText);
        if (signal && lastSurgeryRecord?.reason !== errorText) {
          const surgery = applyAstSurgery(toFileMap(files), signal);
          if (surgery.ok) {
            setFiles(fromFileMap(surgery.files));
            setInjuryMode(true);
            setLastSurgeryRecord({
              filePath: signal.filePath,
              line: signal.line,
              snippet: signal.snippet,
              reason: errorText,
              timestamp: Date.now(),
            });
            setPreviewMode('code');
            setExecutorState({
              phase: 'rendering-code',
              executorId: 'sandpack-renderer',
              message: 'Compile recovered via AST surgery',
              error: null,
            });
            addLog(`[sandpack:surgery] patched ${signal.filePath}:${signal.line || '?'}`);
            return;
          }
          addLog(`[sandpack:surgery:failed] ${surgery.reason || 'unknown reason'}`);
        }

        setExecutorState({
          phase: 'error',
          executorId: 'sandpack-renderer',
          message: 'Compile failed.',
          error: errorText,
        });
        addLog(`[sandpack:error] ${errorText}`);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [
    addLog,
    files,
    lastSurgeryRecord?.reason,
    sandpack,
    setExecutorState,
    setFiles,
    setInjuryMode,
    setLastSurgeryRecord,
    setPreviewMode,
  ]);

  return null;
}

const PreviewViewComponent: React.FC = () => {
  const {
    files,
    projectType,
    logs,
    error,
    latestRenderStage,
    previewMode,
    executorState,
    patchQueueDepth,
    revision,
    dependencyMap,
    dependencySignature,
    injuryMode,
    setPreviewMode,
    setExecutorState,
  } = useProjectStore();

  React.useEffect(() => {
    if (!projectType || files.length === 0) {
      return;
    }

    if (previewMode !== 'code') {
      setPreviewMode('code');
    }

    if (executorState.phase === 'idle') {
      setExecutorState({
        phase: 'rendering-code',
        executorId: 'sandpack-renderer',
        message: 'Rendering with Sandpack...',
        error: null,
      });
    }
  }, [
    executorState.phase,
    files.length,
    previewMode,
    projectType,
    setExecutorState,
    setPreviewMode,
  ]);

  const normalizedFiles = useMemo(() => normalizeFiles(files), [files]);
  const packageJsonContent = normalizedFiles['/package.json'];
  const packageDependencies = useMemo(
    () => parseDependenciesFromPackageJson(packageJsonContent),
    [packageJsonContent]
  );

  const mergedDependencies = useMemo(
    () => ({
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      ...packageDependencies,
      ...dependencyMap,
    }),
    [dependencyMap, packageDependencies]
  );

  const runtimeDependencySignature = useMemo(() => {
    if (dependencySignature) {
      return dependencySignature;
    }
    return JSON.stringify(
      Object.entries(mergedDependencies).sort(([left], [right]) => left.localeCompare(right))
    );
  }, [dependencySignature, mergedDependencies]);

  const [activeDependencySignature, setActiveDependencySignature] = React.useState(runtimeDependencySignature);
  const [sandpackLifecycleState, setSandpackLifecycleState] = React.useState<SandpackLifecycleState>('ready');
  const disposeTimerRef = React.useRef<number | null>(null);
  const bootstrapTimerRef = React.useRef<number | null>(null);

  const clearLifecycleTimers = React.useCallback(() => {
    if (disposeTimerRef.current !== null) {
      window.clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }
    if (bootstrapTimerRef.current !== null) {
      window.clearTimeout(bootstrapTimerRef.current);
      bootstrapTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (activeDependencySignature === runtimeDependencySignature) {
      return;
    }

    clearLifecycleTimers();
    setSandpackLifecycleState('disposing');
    setExecutorState({
      phase: 'disposing',
      executorId: 'sandpack-renderer',
      message: 'Disposing previous sandbox instance...',
      error: null,
    });

    disposeTimerRef.current = window.setTimeout(() => {
      setActiveDependencySignature(runtimeDependencySignature);
      setSandpackLifecycleState('bootstrapping');
      setExecutorState({
        phase: 'bootstrapping',
        executorId: 'sandpack-renderer',
        message: 'Bootstrapping sandbox runtime...',
        error: null,
      });

      bootstrapTimerRef.current = window.setTimeout(() => {
        setSandpackLifecycleState('ready');
      }, 260);
    }, 320);
  }, [
    activeDependencySignature,
    clearLifecycleTimers,
    runtimeDependencySignature,
    setExecutorState,
  ]);

  React.useEffect(() => {
    return () => {
      clearLifecycleTimers();
    };
  }, [clearLifecycleTimers]);

  const sandpackKey = useMemo(
    () => `${projectType || 'unknown'}:${activeDependencySignature}`,
    [activeDependencySignature, projectType]
  );

  const stageMeta = latestRenderStage
    ? [
        typeof latestRenderStage.durationMs === 'number' ? `${latestRenderStage.durationMs}ms` : '',
        typeof latestRenderStage.sequence === 'number' ? `#${latestRenderStage.sequence}` : '',
        latestRenderStage.groupId ? `group=${latestRenderStage.groupId}` : '',
      ]
        .filter(Boolean)
        .join(' | ')
    : '';

  const viewState = useMemo<PreviewViewState>(() => {
    if (files.length === 0) return 'empty';
    if (error || executorState.phase === 'error' || latestRenderStage?.status === 'failed') return 'error';
    if (
      executorState.phase === 'assembling' ||
      executorState.phase === 'disposing' ||
      executorState.phase === 'bootstrapping' ||
      latestRenderStage?.status === 'started'
    ) {
      return 'assembling';
    }
    if (previewMode === 'code' || executorState.phase === 'rendering-code' || executorState.phase === 'compiling') {
      return 'code';
    }
    return 'idle';
  }, [error, executorState.phase, files.length, latestRenderStage?.status, previewMode]);

  const displayStatus = useMemo(() => {
    if (latestRenderStage) {
      return `Pipeline ${latestRenderStage.stage} (${latestRenderStage.status})${
        latestRenderStage.message ? ` - ${latestRenderStage.message}` : ''
      }`;
    }
    return executorState.message || 'Ready';
  }, [executorState.message, latestRenderStage]);

  const statusHint = useMemo(() => {
    switch (viewState) {
      case 'assembling':
        if (executorState.phase === 'disposing') {
          return 'Disposing old sandbox runtime before hard reload.';
        }
        if (executorState.phase === 'bootstrapping') {
          return 'Bootstrapping fresh sandbox runtime.';
        }
        return 'Receiving patch events and preparing commit.';
      case 'code':
        return injuryMode
          ? 'Running in injury mode after AST surgery.'
          : 'Sandpack runtime is active.';
      case 'error':
        return executorState.error || error || 'Unexpected rendering error.';
      case 'idle':
        return 'Waiting for next request.';
      default:
        return 'Waiting for project files.';
    }
  }, [error, executorState.error, injuryMode, viewState]);

  const mergedLogs = useMemo(() => {
    const stateSummary = [
      `[state] phase=${executorState.phase} mode=${previewMode ?? 'none'} revision=${revision} queue=${patchQueueDepth}`,
      executorState.message ? `[executor] ${executorState.message}` : null,
      latestRenderStage
        ? `[pipeline] ${latestRenderStage.stage}/${latestRenderStage.status}${
            latestRenderStage.message ? ` - ${latestRenderStage.message}` : ''
          }`
        : null,
      injuryMode ? '[surgery] injury-mode=on' : null,
    ].filter(Boolean) as string[];

    return [...stateSummary, ...logs].slice(-30);
  }, [
    executorState.message,
    executorState.phase,
    injuryMode,
    latestRenderStage,
    logs,
    patchQueueDepth,
    previewMode,
    revision,
  ]);

  if (viewState === 'empty') {
    return (
      <div className="w-full h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-24 h-24 mb-6 text-gray-300 mx-auto">
            <svg
              className="w-full h-full"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Waiting for files</h3>
          <p className="text-sm text-gray-600">Generate or import project files to start live preview.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-gray-100">
      <div className="bg-white border-b border-gray-200 p-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {viewState === 'assembling' || executorState.phase === 'compiling' ? (
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
            ) : viewState === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-600" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-green-600" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-700 truncate">{displayStatus}</div>
              {stageMeta && <div className="text-[10px] text-gray-500 truncate font-mono">{stageMeta}</div>}
            </div>
          </div>
          {projectType && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">{projectType}</span>
          )}
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">{files.length} files</span>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">rev {revision}</span>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">queue {patchQueueDepth}</span>
          {injuryMode && (
            <span className="text-xs text-amber-700 bg-amber-100 px-2 py-1 rounded">injury mode</span>
          )}
        </div>
      </div>

      {(error || executorState.error) && (
        <div className="bg-red-50 border-b border-red-200 p-3">
          <div className="flex items-start gap-2 text-sm">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-medium text-red-800">Render Error</div>
              <div className="text-red-700 mt-1">{executorState.error || error}</div>
            </div>
          </div>
        </div>
      )}

      {mergedLogs.length > 0 && (
        <div className="bg-gray-900 text-gray-100 text-xs font-mono p-3 max-h-44 overflow-y-auto">
          <div className="flex items-center gap-2 mb-2 text-gray-400">
            <Terminal className="w-3 h-3" />
            <span className="font-medium">Runtime Logs</span>
          </div>
          {mergedLogs.map((line, index) => (
            <div key={`${index}-${line.slice(0, 16)}`} className="whitespace-pre-wrap break-words">
              {line}
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0">
        {sandpackLifecycleState === 'disposing' ? (
          <div className="h-full w-full flex items-center justify-center bg-gray-50 text-sm text-gray-600">
            Disposing previous sandbox runtime...
          </div>
        ) : (
          <SandpackProvider
            key={sandpackKey}
            template={resolveTemplate(projectType)}
            files={normalizedFiles}
            customSetup={{
              dependencies: mergedDependencies,
            }}
            options={{
              recompileMode: 'immediate',
              recompileDelay: 120,
              activeFile: '/src/App.tsx',
              externalResources: [],
            }}
          >
            <SandpackStatusBridge />
            <SandpackLayout style={{ height: '100%' }}>
              <SandpackPreview style={{ height: '100%' }} showOpenInCodeSandbox={false} />
            </SandpackLayout>
          </SandpackProvider>
        )}
      </div>

      <div className="bg-white border-t border-gray-200 px-3 py-2 text-xs text-gray-600">
        {statusHint}
      </div>
    </div>
  );
};

export const PreviewView = React.memo(PreviewViewComponent, () => false);
PreviewView.displayName = 'PreviewView';
