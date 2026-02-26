import { parseSync } from '@oxc-parser/wasm';

interface OxcInitResult {
  cached: boolean;
  ready: boolean;
  durationMs: number;
}

const OXC_CACHE_DB = 'ai-frontend-oxc-cache';
const OXC_CACHE_STORE = 'parser';
const OXC_CACHE_KEY = 'wasm-ready-v1';
const OXC_CACHE_VERSION = '0.60.0';

let initPromise: Promise<OxcInitResult> | null = null;

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function readCacheMarker(): Promise<string | null> {
  if (!canUseIndexedDb()) {
    return null;
  }

  return new Promise(resolve => {
    const request = indexedDB.open(OXC_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OXC_CACHE_STORE)) {
        db.createObjectStore(OXC_CACHE_STORE);
      }
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(OXC_CACHE_STORE, 'readonly');
      const store = tx.objectStore(OXC_CACHE_STORE);
      const getRequest = store.get(OXC_CACHE_KEY);
      getRequest.onerror = () => resolve(null);
      getRequest.onsuccess = () => {
        const value = typeof getRequest.result === 'string' ? getRequest.result : null;
        resolve(value);
      };
    };
  });
}

async function writeCacheMarker(value: string): Promise<void> {
  if (!canUseIndexedDb()) {
    return;
  }

  await new Promise<void>(resolve => {
    const request = indexedDB.open(OXC_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OXC_CACHE_STORE)) {
        db.createObjectStore(OXC_CACHE_STORE);
      }
    };
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(OXC_CACHE_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.objectStore(OXC_CACHE_STORE).put(value, OXC_CACHE_KEY);
    };
  });
}

export async function initOxcWasm(): Promise<OxcInitResult> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const start = Date.now();
    const cacheMarker = await readCacheMarker();
    const cached = cacheMarker === OXC_CACHE_VERSION;

    const wasmModule = (await import('@oxc-parser/wasm')) as unknown as {
      default?: (moduleOrPath?: unknown) => Promise<unknown>;
    };
    if (typeof wasmModule.default === 'function') {
      await wasmModule.default();
    }
    parseSync('export const __warmup = <div />;', {
      sourceFilename: '__oxc_warmup__.tsx',
      sourceType: 'module',
    });

    if (!cached) {
      await writeCacheMarker(OXC_CACHE_VERSION);
    }

    return {
      cached,
      ready: true,
      durationMs: Date.now() - start,
    };
  })();

  return initPromise;
}
