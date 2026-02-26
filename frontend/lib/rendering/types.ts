import type {
  AppGraph,
  PatchEnvelope,
  RenderingAdapterDescriptor,
  RenderingCapability,
  RenderingRequest,
  RenderingResult,
} from '@ai-frontend/shared-types';

export interface RenderingExecutor {
  readonly descriptor: RenderingAdapterDescriptor;
  canExecute(request: RenderingRequest): Promise<boolean> | boolean;
  execute(request: RenderingRequest): Promise<RenderingResult>;
  applyPatch?(graph: AppGraph, patch: PatchEnvelope): Promise<AppGraph> | AppGraph;
  applyFileDiff?(path: string, content: string, request?: RenderingRequest): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

export interface AdapterLookup {
  mode?: RenderingAdapterDescriptor['mode'];
  capability?: RenderingCapability;
}
