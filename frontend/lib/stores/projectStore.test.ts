import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VirtualFile } from '../services/VirtualFileSystem';

type ProjectStoreModule = typeof import('./projectStore');
type ProjectStoreHook = ProjectStoreModule['useProjectStore'];

type PersistApi = {
  rehydrate: () => Promise<void> | void;
};

type StoreWithPersist = ProjectStoreHook & {
  persist?: PersistApi;
};

type MemoryLocalStorage = Storage & {
  map: Map<string, string>;
};

function createMemoryLocalStorage(initial?: Record<string, string>): MemoryLocalStorage {
  const map = new Map(Object.entries(initial || {}));

  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    map,
  } as MemoryLocalStorage;
}

async function loadProjectStore(
  initialStorage: Record<string, string> = {}
): Promise<{ useProjectStore: StoreWithPersist; localStorageMock: MemoryLocalStorage }> {
  vi.resetModules();

  const localStorageMock = createMemoryLocalStorage(initialStorage);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: localStorageMock,
  });

  const module = (await import('./projectStore')) as ProjectStoreModule;
  return {
    useProjectStore: module.useProjectStore as StoreWithPersist,
    localStorageMock,
  };
}

function collectTreePaths(nodes: VirtualFile[]): string[] {
  const paths: string[] = [];
  const walk = (items: VirtualFile[]) => {
    for (const item of items) {
      paths.push(item.path);
      if (item.children && item.children.length > 0) {
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return paths;
}

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  vi.resetModules();
});

describe('projectStore hydration consistency', () => {
  it('persists files in deterministic normalized order', async () => {
    const { useProjectStore, localStorageMock } = await loadProjectStore();

    useProjectStore.getState().setFiles([
      { path: 'src\\b.ts', content: 'B0' },
      { path: './src/a.ts', content: 'A0' },
      { path: 'src//a.ts', content: 'A1' },
      { path: '/src/c.ts/', content: 'C0' },
    ]);

    const payload = localStorageMock.map.get('project-storage');
    expect(payload).toBeTruthy();

    const parsed = JSON.parse(payload as string) as {
      state: { files: Array<{ path: string; content: string }> };
      version: number;
    };

    expect(parsed.version).toBe(2);
    expect(parsed.state.files).toEqual([
      { path: 'src/a.ts', content: 'A1' },
      { path: 'src/b.ts', content: 'B0' },
      { path: 'src/c.ts', content: 'C0' },
    ]);
  });

  it('keeps selected file aligned with file tree after rehydrate', async () => {
    const persistedState = JSON.stringify({
      state: {
        files: [
          { path: './src\\main.ts', content: 'main-v1' },
          { path: 'src//utils.ts', content: 'utils-v1' },
          { path: 'src/main.ts', content: 'main-v2' },
        ],
        projectType: 'react-vite',
      },
      version: 2,
    });

    const { useProjectStore, localStorageMock } = await loadProjectStore();

    const persistApi = useProjectStore.persist;
    expect(persistApi).toBeDefined();

    useProjectStore.getState().setFiles([
      { path: 'tmp/placeholder.ts', content: 'placeholder' },
    ]);
    useProjectStore.getState().selectFile({
      name: 'main.ts',
      path: './src\\main.ts',
      type: 'file',
      content: 'stale',
    });

    localStorageMock.setItem('project-storage', persistedState);
    await persistApi!.rehydrate();

    const state = useProjectStore.getState();
    expect(state.files).toEqual([
      { path: 'src/main.ts', content: 'main-v2' },
      { path: 'src/utils.ts', content: 'utils-v1' },
    ]);
    expect(state.selectedFile?.path).toBe('src/main.ts');
    expect(state.selectedFile).toBe(state.vfs.getFile('src/main.ts') || null);

    const treePaths = collectTreePaths(state.fileTree);
    expect(treePaths).toContain('src');
    expect(state.vfs.getFile('src/main.ts')).toBeTruthy();
    expect(state.vfs.getFile('src/utils.ts')).toBeTruthy();
  });

  it('updateFile upserts safely for canonical-equivalent paths', async () => {
    const { useProjectStore } = await loadProjectStore();

    useProjectStore.getState().setFiles([{ path: 'src\\main.tsx', content: 'v1' }]);
    useProjectStore.getState().selectFile({
      name: 'main.tsx',
      path: './src\\main.tsx',
      type: 'file',
      content: 'stale',
    });

    await useProjectStore.getState().updateFile('src//main.tsx', 'v2');
    await useProjectStore.getState().updateFile('./src/main.tsx', 'v3');

    const state = useProjectStore.getState();
    expect(state.files).toEqual([{ path: 'src/main.tsx', content: 'v3' }]);
    expect(state.selectedFile?.path).toBe('src/main.tsx');
    expect(state.selectedFile?.content).toBe('v3');
    expect(state.selectedFile).toBe(state.vfs.getFile('src/main.tsx') || null);
    expect(state.revision).toBe(2);
  });
});
