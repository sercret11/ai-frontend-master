import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RenderPipelineStageEvent, RuntimeEvent } from '@ai-frontend/shared-types';
import { VirtualFileSystem, getVFS, resetVFS } from '../services/VirtualFileSystem';
import type { VirtualFile } from '../services/VirtualFileSystem';

export interface ProjectFile {
  path: string;
  content: string;
}

export type ProjectType = 'next-js' | 'react-vite' | 'react-native' | 'uniapp';
export type PreviewMode = 'code' | null;

export type ExecutorPhase =
  | 'idle'
  | 'assembling'
  | 'disposing'
  | 'bootstrapping'
  | 'compiling'
  | 'rendering-code'
  | 'error';

export interface ExecutorState {
  phase: ExecutorPhase;
  executorId: string | null;
  message: string;
  error: string | null;
  updatedAt: number;
}

export interface SurgeryRecord {
  filePath: string;
  line?: number;
  snippet?: string;
  reason: string;
  timestamp: number;
}

function createInitialExecutorState(message: string = 'Waiting for task'): ExecutorState {
  return {
    phase: 'idle',
    executorId: null,
    message,
    error: null,
    updatedAt: Date.now(),
  };
}

function resolveCounterValue(
  current: number,
  next: number | ((value: number) => number)
): number {
  const resolved = typeof next === 'function' ? next(current) : next;
  if (!Number.isFinite(resolved)) {
    return current;
  }
  return Math.max(0, Math.floor(resolved));
}

function isRuntimeEventRelevant(event: RuntimeEvent): boolean {
  return !event.type.startsWith('sandbox.');
}

function isProjectType(value: unknown): value is ProjectType {
  return value === 'next-js' || value === 'react-vite' || value === 'react-native' || value === 'uniapp';
}

export interface CompilerState {
  files: ProjectFile[];
  projectType: ProjectType | null;
  vfs: VirtualFileSystem;
  fileTree: VirtualFile[];
  selectedFile: VirtualFile | null;
  previewUrl: string | null;
  revision: number;
  previewMode: PreviewMode;
  executorState: ExecutorState;
  patchQueueDepth: number;
  lastHealthyPreviewUrl: string | null;
  logs: string[];
  error: string | null;
  runtimeEvents: RuntimeEvent[];
  latestRenderStage: RenderPipelineStageEvent | null;
  dependencyMap: Record<string, string>;
  dependencySignature: string;
  injuryMode: boolean;
  lastSurgeryRecord: SurgeryRecord | null;
  setFiles: (files: ProjectFile[]) => void;
  setProjectType: (type: ProjectType) => void;
  setPreviewUrl: (url: string | null) => void;
  updateFile: (path: string, content: string) => Promise<void>;
  reset: () => void;
  addLog: (message: string) => void;
  clearLogs: () => void;
  pushRuntimeEvent: (event: RuntimeEvent) => void;
  clearRuntimeEvents: () => void;
  setRevision: (next: number | ((current: number) => number)) => void;
  incrementRevision: (delta?: number) => void;
  setPreviewMode: (mode: PreviewMode) => void;
  setExecutorState: (
    next:
      | Partial<ExecutorState>
      | ((current: ExecutorState) => Partial<ExecutorState> | ExecutorState)
  ) => void;
  setPatchQueueDepth: (next: number | ((current: number) => number)) => void;
  setDependencyMap: (dependencies: Record<string, string>, signature: string) => void;
  setInjuryMode: (enabled: boolean) => void;
  setLastSurgeryRecord: (record: SurgeryRecord | null) => void;
  createFile: (path: string, content: string) => void;
  deleteFile: (path: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;
  selectFile: (file: VirtualFile | null) => void;
  refreshFileTree: () => void;
  searchFiles: (query: string) => VirtualFile[];
  importFromToolResult: (toolResult: {
    title: string;
    output: string;
    metadata?: { template?: string; projectName?: string };
  }) => void;
}

export const useProjectStore = create<CompilerState>()(
  persist(
    (set, get) => ({
      files: [],
      projectType: null,
      vfs: getVFS(),
      fileTree: [],
      selectedFile: null,
      previewUrl: null,
      revision: 0,
      previewMode: null,
      executorState: createInitialExecutorState(),
      patchQueueDepth: 0,
      lastHealthyPreviewUrl: null,
      logs: [],
      error: null,
      runtimeEvents: [],
      latestRenderStage: null,
      dependencyMap: {},
      dependencySignature: '',
      injuryMode: false,
      lastSurgeryRecord: null,

      setFiles: files => {
        const vfs = getVFS();
        vfs.initializeFiles(files);

        set({
          files,
          fileTree: vfs.getFileTree(),
          previewUrl: null,
          lastHealthyPreviewUrl: null,
          revision: 0,
          previewMode: null,
          executorState: createInitialExecutorState(
            files.length > 0 ? 'Files loaded, waiting for render' : 'Waiting for task'
          ),
          patchQueueDepth: 0,
          injuryMode: false,
          lastSurgeryRecord: null,
        });
      },

      setProjectType: type => set({ projectType: type }),

      setPreviewUrl: url =>
        set(state => ({
          previewUrl: url,
          lastHealthyPreviewUrl: url ?? state.lastHealthyPreviewUrl,
        })),

      updateFile: async (path, content) => {
        const { vfs } = get();
        vfs.setFile(path, content);

        set(state => ({
          files: state.files.map(file => (file.path === path ? { ...file, content } : file)),
          fileTree: vfs.getFileTree(),
          revision: state.revision + 1,
        }));

        const selectedFile = get().selectedFile;
        if (selectedFile && selectedFile.path === path) {
          set({ selectedFile: vfs.getFile(path) || null });
        }
      },

      createFile: (path, content) => {
        const { vfs } = get();
        const parts = path.split('/');
        for (let index = 1; index < parts.length - 1; index += 1) {
          const dirPath = parts.slice(0, index + 1).join('/');
          if (!vfs.getFile(dirPath)) {
            vfs.createDirectory(dirPath);
          }
        }

        vfs.setFile(path, content);
        set(state => ({
          files: [...state.files, { path, content }],
          fileTree: vfs.getFileTree(),
          revision: state.revision + 1,
        }));
      },

      deleteFile: path => {
        const { vfs } = get();
        if (!vfs.deleteFile(path)) {
          return;
        }

        set(state => ({
          files: state.files.filter(file => file.path !== path),
          fileTree: vfs.getFileTree(),
          selectedFile: state.selectedFile?.path === path ? null : state.selectedFile,
          revision: state.revision + 1,
        }));
      },

      renameFile: (oldPath, newPath) => {
        const { vfs } = get();
        const file = vfs.getFile(oldPath);
        if (!file) {
          return;
        }

        const content = file.content ?? '';
        vfs.setFile(newPath, content);
        vfs.deleteFile(oldPath);

        set(state => ({
          files: [
            ...state.files.filter(item => item.path !== oldPath && item.path !== newPath),
            { path: newPath, content },
          ],
          fileTree: vfs.getFileTree(),
          selectedFile:
            state.selectedFile?.path === oldPath ? vfs.getFile(newPath) || null : state.selectedFile,
          revision: state.revision + 1,
        }));
      },

      selectFile: file => set({ selectedFile: file }),

      refreshFileTree: () => set({ fileTree: get().vfs.getFileTree() }),

      searchFiles: query => get().vfs.searchFiles(query),

      importFromToolResult: toolResult => {
        const { output, metadata } = toolResult;
        const regex = /```(\w+)(?:\s+([^\s\n]+))?\n([\s\S]*?)\n```/g;
        const files: ProjectFile[] = [];
        let match: RegExpExecArray | null;
        while ((match = regex.exec(output)) !== null) {
          const language = match[1] || 'txt';
          const providedPath = match[2];
          const code = (match[3] || '').trim();
          const path = providedPath || `unknown.${language}`;
          files.push({ path, content: code });
        }

        if (metadata?.template && isProjectType(metadata.template)) {
          get().setProjectType(metadata.template);
        }

        get().setFiles(files);
        get().addLog(`Imported ${files.length} files from tool output`);
      },

      reset: () => {
        resetVFS();
        set({
          files: [],
          projectType: null,
          vfs: getVFS(),
          fileTree: [],
          selectedFile: null,
          previewUrl: null,
          revision: 0,
          previewMode: null,
          executorState: createInitialExecutorState(),
          patchQueueDepth: 0,
          lastHealthyPreviewUrl: null,
          logs: [],
          error: null,
          runtimeEvents: [],
          latestRenderStage: null,
          dependencyMap: {},
          dependencySignature: '',
          injuryMode: false,
          lastSurgeryRecord: null,
        });
      },

      addLog: message => set(state => ({ logs: [...state.logs, message] })),
      clearLogs: () => set({ logs: [] }),

      pushRuntimeEvent: event => {
        if (!isRuntimeEventRelevant(event)) {
          return;
        }

        set(state => ({
          runtimeEvents: [...state.runtimeEvents, event].slice(-300),
          latestRenderStage:
            event.type === 'render.pipeline.stage' ? event : state.latestRenderStage,
        }));
      },

      clearRuntimeEvents: () =>
        set({
          runtimeEvents: [],
          latestRenderStage: null,
        }),

      setRevision: next =>
        set(state => ({
          revision: resolveCounterValue(state.revision, next),
        })),

      incrementRevision: (delta = 1) =>
        set(state => ({
          revision: Math.max(0, state.revision + delta),
        })),

      setPreviewMode: mode => set({ previewMode: mode }),

      setExecutorState: next =>
        set(state => {
          const patch = typeof next === 'function' ? next(state.executorState) : next;
          const nextExecutorState = {
            ...state.executorState,
            ...patch,
          };

          const hasChanged =
            nextExecutorState.phase !== state.executorState.phase ||
            nextExecutorState.executorId !== state.executorState.executorId ||
            nextExecutorState.message !== state.executorState.message ||
            nextExecutorState.error !== state.executorState.error;

          if (!hasChanged) {
            return state;
          }

          return {
            executorState: {
              ...nextExecutorState,
              updatedAt: Date.now(),
            },
          };
        }),

      setPatchQueueDepth: next =>
        set(state => ({
          patchQueueDepth: resolveCounterValue(state.patchQueueDepth, next),
        })),

      setDependencyMap: (dependencies, signature) =>
        set({
          dependencyMap: dependencies,
          dependencySignature: signature,
        }),

      setInjuryMode: enabled => set({ injuryMode: enabled }),

      setLastSurgeryRecord: record => set({ lastSurgeryRecord: record }),
    }),
    {
      name: 'project-storage',
      partialize: state => ({
        files: state.files,
        projectType: state.projectType,
      }),
      version: 2,
    }
  )
);

if (typeof window !== 'undefined') {
  (window as { projectStore?: typeof useProjectStore }).projectStore = useProjectStore;
}
