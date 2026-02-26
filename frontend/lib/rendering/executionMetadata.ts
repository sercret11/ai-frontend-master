import type { RenderingRequest, RuntimeEvent } from '@ai-frontend/shared-types';

export type RenderingProjectType = 'next-js' | 'react-vite' | 'react-native' | 'uniapp';

export interface RenderingProjectFile {
  path: string;
  content: string;
}

export interface RenderingHooks {
  onProgress?: (message: string) => void;
  onReady?: (url: string) => void;
  onError?: (error: string) => void;
  onServerLog?: (log: string) => void;
  onRuntimeEvent?: (event: RuntimeEvent) => void;
}

export interface RenderingExecutionMetadata {
  projectType: RenderingProjectType;
  files: RenderingProjectFile[];
  hooks?: RenderingHooks;
  runtimeApiBaseUrl?: string;
  repairPollingIntervalMs?: number;
  repairTimeoutMs?: number;
}

const RENDERING_EXECUTION_METADATA_KEY = '__renderingExecution';

function isRenderingProjectType(value: unknown): value is RenderingProjectType {
  return (
    value === 'next-js' ||
    value === 'react-vite' ||
    value === 'react-native' ||
    value === 'uniapp'
  );
}

function isRenderingProjectFile(value: unknown): value is RenderingProjectFile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record['path'] === 'string' && typeof record['content'] === 'string';
}

function isRenderingExecutionMetadata(value: unknown): value is RenderingExecutionMetadata {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (!isRenderingProjectType(record['projectType'])) {
    return false;
  }

  const files = record['files'];
  if (!Array.isArray(files) || !files.every(file => isRenderingProjectFile(file))) {
    return false;
  }

  return true;
}

export function attachExecutionMetadata(
  request: RenderingRequest,
  metadata: RenderingExecutionMetadata
): RenderingRequest {
  return {
    ...request,
    metadata: {
      ...(request.metadata ?? {}),
      [RENDERING_EXECUTION_METADATA_KEY]: metadata,
    },
  };
}

export function readExecutionMetadata(request: RenderingRequest): RenderingExecutionMetadata | null {
  const raw = request.metadata?.[RENDERING_EXECUTION_METADATA_KEY];
  if (!isRenderingExecutionMetadata(raw)) {
    return null;
  }
  return raw;
}
