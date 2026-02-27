/**
 * Rendering orchestrator for schema preview pipeline.
 */

import type {
  AppGraph,
  PreviewMode,
  RenderDegradeInfo,
  RenderingRequest,
  RuntimeEvent,
  RenderingResult as ExecutorRenderingResult,
} from '@ai-frontend/shared-types';
import type { RenderAdapterType, RenderPipelineStage } from '@ai-frontend/shared-types';
import {
  AdapterRegistry,
  SchemaExecutor,
  attachExecutionMetadata,
  readExecutionMetadata,
} from '../rendering';
import { canonicalizeProjectPath, normalizeProjectFiles } from './path-utils';
import type {
  RenderingExecutionMetadata,
  RenderingExecutor,
  RenderingProjectFile,
  RenderingProjectType,
} from '../rendering';

export interface RenderPipelineEvent {
  adapter: RenderAdapterType;
  stage: RenderPipelineStage;
  status: 'started' | 'completed' | 'failed';
  message?: string;
  timestamp: number;
}

export interface RenderEngineHooks {
  onEvent?: (event: RenderPipelineEvent) => void;
  onProgress?: (message: string) => void;
  onReady?: (url: string) => void;
  onError?: (error: string) => void;
  onServerLog?: (log: string) => void;
  onRuntimeEvent?: (event: RuntimeEvent) => void;
  runtimeApiBaseUrl?: string;
  repairPollingIntervalMs?: number;
  repairTimeoutMs?: number;
}

export interface RenderResult {
  success: boolean;
  adapter: RenderAdapterType;
  mode?: PreviewMode;
  previewUrl?: string;
  degraded?: RenderDegradeInfo;
  error?: string;
}

export type SupportedProjectType = 'next-js' | 'react-vite' | 'react-native' | 'uniapp';

export interface ProjectFileLike {
  path: string;
  content: string;
}

interface RenderSessionState {
  executorId: string;
  request: RenderingRequest;
}

const PROJECT_MODE_ROUTING: Record<SupportedProjectType, PreviewMode> = {
  'next-js': 'schema',
  'react-vite': 'schema',
  'react-native': 'schema',
  uniapp: 'schema',
};

const EXECUTOR_ID_TO_ADAPTER = {
  'schema-renderer': 'schema-renderer',
} as const;

function emitStage(
  hooks: RenderEngineHooks | undefined,
  adapter: RenderAdapterType,
  stage: RenderPipelineStage,
  status: 'started' | 'completed' | 'failed',
  message?: string
): void {
  hooks?.onEvent?.({
    adapter,
    stage,
    status,
    message,
    timestamp: Date.now(),
  });
}

function resolveAdapterTypeByExecutorId(executorId: string): RenderAdapterType {
  const mapped = EXECUTOR_ID_TO_ADAPTER[executorId as keyof typeof EXECUTOR_ID_TO_ADAPTER];
  return mapped ?? 'schema-renderer';
}

function resolveAdapterTypeByMode(_mode: PreviewMode): RenderAdapterType {
  return 'schema-renderer';
}

function getResultError(result: ExecutorRenderingResult): string {
  if (result.artifact.kind === 'error' && typeof result.artifact.payload === 'string') {
    return result.artifact.payload;
  }
  return result.diagnostics?.[0] ?? 'Render execution failed';
}

function getPreviewUrl(result: ExecutorRenderingResult): string | undefined {
  if (result.artifact.kind !== 'url') {
    return undefined;
  }
  if (typeof result.artifact.payload !== 'string') {
    return undefined;
  }
  return result.artifact.payload;
}

function toRenderingProjectType(projectType: SupportedProjectType): RenderingProjectType {
  return projectType;
}

function toRenderingFiles(files: readonly ProjectFileLike[]): RenderingProjectFile[] {
  return normalizeProjectFiles(files).map(file => ({
    path: file.path,
    content: file.content,
  }));
}

function toExecutionMetadata(
  files: readonly ProjectFileLike[],
  projectType: SupportedProjectType,
  hooks?: RenderEngineHooks
): RenderingExecutionMetadata {
  return {
    projectType: toRenderingProjectType(projectType),
    files: toRenderingFiles(files),
    hooks: hooks
      ? {
          onProgress: hooks.onProgress,
          onReady: hooks.onReady,
          onError: hooks.onError,
          onServerLog: hooks.onServerLog,
          onRuntimeEvent: hooks.onRuntimeEvent,
        }
      : undefined,
    runtimeApiBaseUrl: hooks?.runtimeApiBaseUrl,
    repairPollingIntervalMs: hooks?.repairPollingIntervalMs,
    repairTimeoutMs: hooks?.repairTimeoutMs,
  };
}

function createGraphFromFiles(
  files: readonly ProjectFileLike[],
  projectType: SupportedProjectType
): AppGraph {
  const rootNodeId = 'root';
  const now = Date.now();
  const graphId = `${projectType}-${now}`;
  const rootNode: AppGraph['nodes'][string] = {
    id: rootNodeId,
    type: 'root',
    name: 'project-root',
    props: {
      projectType,
      fileCount: files.length,
    },
    children: [],
  };

  const nodes: AppGraph['nodes'] = {
    [rootNodeId]: rootNode,
  };

  let totalBytes = 0;
  files.forEach((file, index) => {
    const nodeId = `file-${index + 1}`;
    totalBytes += file.content.length;
    rootNode.children.push(nodeId);

    nodes[nodeId] = {
      id: nodeId,
      type: 'asset',
      name: file.path,
      props: {
        path: file.path,
        size: file.content.length,
      },
      children: [],
    };
  });

  return {
    graphId,
    version: 1,
    entryNodeId: rootNodeId,
    nodes,
    updatedAt: now,
    metadata: {
      projectType,
      fileCount: files.length,
      totalBytes,
    },
  };
}

function createRenderRequest(
  files: readonly ProjectFileLike[],
  projectType: SupportedProjectType,
  hooks?: RenderEngineHooks
): RenderingRequest {
  const baseRequest: RenderingRequest = {
    sessionId: `render-${projectType}`,
    runId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    mode: PROJECT_MODE_ROUTING[projectType],
    graph: createGraphFromFiles(files, projectType),
  };

  return attachExecutionMetadata(baseRequest, toExecutionMetadata(files, projectType, hooks));
}

function upsertFile(
  files: readonly RenderingProjectFile[],
  path: string,
  content: string
): RenderingProjectFile[] {
  const normalizedPath = canonicalizeProjectPath(path);
  if (!normalizedPath) {
    return normalizeProjectFiles(files);
  }

  const nextFiles = files.filter(file => canonicalizeProjectPath(file.path) !== normalizedPath);
  nextFiles.push({ path: normalizedPath, content });
  return normalizeProjectFiles(nextFiles);
}

export class RenderEngine {
  private readonly registry = new AdapterRegistry();
  private readonly executors = new Map<string, RenderingExecutor>();
  private readonly sessions = new Map<SupportedProjectType, RenderSessionState>();

  constructor() {
    const schemaExecutor = new SchemaExecutor();

    this.registerExecutor(schemaExecutor);
  }

  private registerExecutor(executor: RenderingExecutor): void {
    this.registry.register(executor);
    this.executors.set(executor.descriptor.id, executor);
  }

  private async resolveExecutor(
    request: RenderingRequest
  ): Promise<{ executor: RenderingExecutor; request: RenderingRequest }> {
    const schemaRequest: RenderingRequest =
      request.mode === 'schema' ? request : { ...request, mode: 'schema' };
    const directExecutor = await this.registry.resolveBest({ mode: 'schema' }, schemaRequest);
    if (directExecutor) {
      return { executor: directExecutor, request: schemaRequest };
    }

    throw new Error('No rendering executor available for mode: schema');
  }

  async render(
    files: ProjectFileLike[],
    projectType: SupportedProjectType,
    hooks?: RenderEngineHooks
  ): Promise<RenderResult> {
    const request = createRenderRequest(files, projectType, hooks);
    const requestedAdapter = resolveAdapterTypeByMode(request.mode);

    emitStage(hooks, requestedAdapter, 'plan', 'started', 'Build rendering request');
    emitStage(hooks, requestedAdapter, 'plan', 'completed');
    emitStage(hooks, requestedAdapter, 'route', 'started', 'Resolve rendering executor');

    let resolved: { executor: RenderingExecutor; request: RenderingRequest };
    try {
      resolved = await this.resolveExecutor(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resolve executor';
      emitStage(hooks, requestedAdapter, 'route', 'failed', message);
      hooks?.onError?.(message);
      return {
        success: false,
        adapter: requestedAdapter,
        error: message,
      };
    }

    const adapter = resolveAdapterTypeByExecutorId(resolved.executor.descriptor.id);
    const routeMessage = `Executor selected: ${resolved.executor.descriptor.id}`;

    emitStage(hooks, adapter, 'route', 'completed', routeMessage);
    emitStage(hooks, adapter, 'execute', 'started', 'Execute render task');

    let executionResult: ExecutorRenderingResult;
    try {
      executionResult = await resolved.executor.execute(resolved.request);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Render execution failed';
      emitStage(hooks, adapter, 'execute', 'failed', message);
      hooks?.onError?.(message);
      return {
        success: false,
        adapter,
        error: message,
      };
    }

    if (!executionResult.success) {
      const errorMessage = getResultError(executionResult);
      emitStage(hooks, adapter, 'execute', 'failed', errorMessage);
      hooks?.onError?.(errorMessage);
      return {
        success: false,
        adapter,
        mode: executionResult.mode,
        degraded: executionResult.degraded,
        error: errorMessage,
      };
    }

    emitStage(hooks, adapter, 'execute', 'completed');
    emitStage(hooks, adapter, 'publish', 'started', 'Publish preview artifact');

    const previewUrl = getPreviewUrl(executionResult);
    if (previewUrl) {
      hooks?.onReady?.(previewUrl);
    }
    if (executionResult.degraded) {
      hooks?.onProgress?.(
        `Render degraded: ${executionResult.degraded.fromMode} -> ${executionResult.degraded.toMode} (${executionResult.degraded.reason})`
      );
    }

    emitStage(hooks, adapter, 'publish', 'completed');

    this.sessions.set(projectType, {
      executorId: resolved.executor.descriptor.id,
      request: resolved.request,
    });

    return {
      success: true,
      adapter,
      mode: executionResult.mode,
      previewUrl,
      degraded: executionResult.degraded,
    };
  }

  async applyFileDiff(projectType: SupportedProjectType, path: string, content: string): Promise<void> {
    const session = this.sessions.get(projectType);
    if (!session) {
      return;
    }

    const normalizedPath = canonicalizeProjectPath(path);
    if (!normalizedPath) {
      return;
    }

    const nextRequest = this.updateRequestWithFileDiff(session.request, projectType, normalizedPath, content);
    this.sessions.set(projectType, {
      ...session,
      request: nextRequest,
    });

    const executor = this.executors.get(session.executorId);
    if (!executor) {
      return;
    }

    if (!executor.applyFileDiff) {
      await executor.execute(nextRequest);
      return;
    }

    try {
      await executor.applyFileDiff(normalizedPath, content, nextRequest);
    } catch {
      await executor.execute(nextRequest);
    }
  }

  private updateRequestWithFileDiff(
    request: RenderingRequest,
    projectType: SupportedProjectType,
    path: string,
    content: string
  ): RenderingRequest {
    const metadata = readExecutionMetadata(request);
    if (!metadata) {
      return request;
    }

    const nextFiles = upsertFile(metadata.files, path, content);
    const nextMetadata: RenderingExecutionMetadata = {
      ...metadata,
      files: nextFiles,
    };

    const nextRequest: RenderingRequest = {
      ...request,
      graph: createGraphFromFiles(nextFiles, projectType),
    };

    return attachExecutionMetadata(nextRequest, nextMetadata);
  }

  async dispose(projectType: SupportedProjectType): Promise<void> {
    const session = this.sessions.get(projectType);
    if (!session) {
      return;
    }

    this.sessions.delete(projectType);
    const executor = this.executors.get(session.executorId);
    if (!executor?.dispose) {
      return;
    }

    const stillInUse = [...this.sessions.values()].some(item => item.executorId === session.executorId);
    if (stillInUse) {
      return;
    }

    await executor.dispose();
  }

  async disposeAll(): Promise<void> {
    const disposeTasks = [...this.executors.values()].map(async executor => {
      if (executor.dispose) {
        await executor.dispose();
      }
    });

    await Promise.allSettled(disposeTasks);
    this.sessions.clear();
  }
}

let renderEngineInstance: RenderEngine | null = null;

export function getRenderEngine(): RenderEngine {
  if (!renderEngineInstance) {
    renderEngineInstance = new RenderEngine();
  }
  return renderEngineInstance;
}
