/**
 * useProjectFiles - polling hook for project files.
 * Polls backend storage for generated files to avoid large SSE payloads.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  FileBatchResponse,
  FileQueryParams,
  FileStorageStats,
  StoredFile,
} from '@ai-frontend/shared-types';
import { withApiAuthHeaders } from '../utils/api-auth';
import { normalizeApiBaseUrl } from '../utils/api-base';

const START_POLLING_DEBOUNCE_MS = 500;
const STABLE_FILE_TOTAL_ROUNDS = 120;

function normalizePollingParams(params: FileQueryParams = {}): string {
  const normalizedEntries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right));

  return JSON.stringify(Object.fromEntries(normalizedEntries));
}

function buildPollingSignature(sessionID: string, params: FileQueryParams = {}): string {
  return `${sessionID}:${normalizePollingParams(params)}`;
}

export function pruneRecentPollingStarts(
  registry: Map<string, number>,
  now: number,
  debounceWindowMs: number = START_POLLING_DEBOUNCE_MS
): void {
  registry.forEach((startedAt, signature) => {
    if (now - startedAt > debounceWindowMs) {
      registry.delete(signature);
    }
  });
}

export function shouldDebouncePollingStart(
  registry: Map<string, number>,
  signature: string,
  now: number,
  debounceWindowMs: number = START_POLLING_DEBOUNCE_MS
): boolean {
  pruneRecentPollingStarts(registry, now, debounceWindowMs);
  const lastStartAt = registry.get(signature);
  return typeof lastStartAt === 'number' && now - lastStartAt < debounceWindowMs;
}

export interface UseProjectFilesOptions {
  /** Base API URL */
  apiUrl?: string;
  /** Polling interval in ms, default 2000 */
  pollInterval?: number;
  /** Max retries before stopping polling, default 10 */
  maxRetries?: number;
  /** Called when files are loaded */
  onFilesLoaded?: (files: StoredFile[]) => void;
  /** Called when a request fails */
  onError?: (error: Error) => void;
}

export interface UseProjectFilesReturn {
  /** Loaded files */
  files: StoredFile[];
  /** Loading state */
  isLoading: boolean;
  /** Polling state */
  isPolling: boolean;
  /** Stats */
  stats: FileStorageStats | null;
  /** Pagination */
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  } | null;
  /** Start polling for a session */
  startPolling: (sessionID: string, params?: FileQueryParams) => void;
  /** Stop polling */
  stopPolling: () => void;
  /** Manual refresh */
  refresh: () => Promise<void>;
  /** Fetch stats only */
  fetchStats: () => Promise<void>;
  /** Reset hook state */
  reset: () => void;
}

export function useProjectFiles(options: UseProjectFilesOptions = {}): UseProjectFilesReturn {
  const {
    apiUrl = import.meta.env['VITE_API_URL'] || 'http://localhost:3001',
    pollInterval = 2000,
    maxRetries = 10,
    onFilesLoaded,
    onError,
  } = options;
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiUrl);

  const [files, setFiles] = useState<StoredFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [stats, setStats] = useState<FileStorageStats | null>(null);
  const [pagination, setPagination] = useState<UseProjectFilesReturn['pagination']>(null);
  const onFilesLoadedRef = useRef(onFilesLoaded);
  const onErrorRef = useRef(onError);
  const recentPollingStartsRef = useRef<Map<string, number>>(new Map());

  const pollingRef = useRef<{
    intervalId: NodeJS.Timeout | null;
    retryCount: number;
    sessionID: string | null;
    params: FileQueryParams | null;
    pollingKey: number;
    active: boolean;
    lastObservedTotal: number;
    stableRounds: number;
  }>({
    intervalId: null,
    retryCount: 0,
    sessionID: null,
    params: null,
    pollingKey: 0,
    active: false,
    lastObservedTotal: -1,
    stableRounds: 0,
  });

  useEffect(() => {
    onFilesLoadedRef.current = onFilesLoaded;
  }, [onFilesLoaded]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const shouldStopForStableSnapshot = useCallback((data: FileBatchResponse | null): boolean => {
    if (!data) {
      return false;
    }

    const currentTotal = data.pagination?.total ?? data.files.length;
    if (currentTotal <= 0) {
      pollingRef.current.lastObservedTotal = currentTotal;
      pollingRef.current.stableRounds = 0;
      return false;
    }

    if (pollingRef.current.lastObservedTotal === currentTotal) {
      pollingRef.current.stableRounds += 1;
    } else {
      pollingRef.current.lastObservedTotal = currentTotal;
      pollingRef.current.stableRounds = 0;
    }

    const reachedStableRounds = pollingRef.current.stableRounds >= STABLE_FILE_TOTAL_ROUNDS;
    if (reachedStableRounds) {
      console.log('[useProjectFiles] Stop polling after stable file total snapshot', {
        currentTotal,
        stableRounds: pollingRef.current.stableRounds,
      });
    }
    return reachedStableRounds;
  }, []);

  const fetchFiles = useCallback(async (expectedPollingKey?: number) => {
    const { sessionID, params, pollingKey } = pollingRef.current;
    const requestPollingKey = expectedPollingKey ?? pollingKey;

    if (!sessionID) {
      console.warn('[useProjectFiles] No session ID, skipping fetch');
      return null;
    }

    if (requestPollingKey !== pollingKey) {
      console.log('[useProjectFiles] Polling key changed before fetch, skipping stale request');
      return null;
    }

    console.log(`[useProjectFiles] Fetching files for session ${sessionID}`);
    setIsLoading(true);

    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.search) queryParams.append('search', params.search);
      if (params?.language) queryParams.append('language', params.language);
      if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
      if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

      const response = await fetch(`${normalizedApiBaseUrl}/api/sessions/${sessionID}/files?${queryParams.toString()}`, {
        headers: withApiAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: FileBatchResponse = await response.json();

      if (
        pollingRef.current.pollingKey !== requestPollingKey ||
        pollingRef.current.sessionID !== sessionID
      ) {
        console.log('[useProjectFiles] Ignoring stale files response', {
          sessionID,
          requestPollingKey,
          currentSessionID: pollingRef.current.sessionID,
          currentPollingKey: pollingRef.current.pollingKey,
        });
        return null;
      }

      console.log(`[useProjectFiles] Response received: ${data.files.length} files, pagination:`, data.pagination);

      setFiles(data.files);
      setPagination(data.pagination);
      setStats(prev => ({
        sessionID,
        fileCount: data.pagination.total,
        totalSize: prev?.totalSize || 0,
        filesByLanguage: {},
      }));

      if (data.files.length > 0) {
        pollingRef.current.retryCount = 0;
        onFilesLoadedRef.current?.(data.files);
        console.log(`[useProjectFiles] Loaded ${data.files.length} files for session ${sessionID}`);
      }

      return data;
    } catch (error) {
      if (
        pollingRef.current.pollingKey !== requestPollingKey ||
        pollingRef.current.sessionID !== sessionID
      ) {
        return null;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[useProjectFiles] Failed to fetch files:', err);
      onErrorRef.current?.(err);
      return null;
    } finally {
      if (pollingRef.current.pollingKey === requestPollingKey) {
        setIsLoading(false);
      }
    }
  }, [normalizedApiBaseUrl]);

  const fetchStats = useCallback(async () => {
    const { sessionID, pollingKey } = pollingRef.current;

    if (!sessionID) {
      console.warn('[useProjectFiles] No session ID, skipping stats fetch');
      return;
    }

    try {
      const response = await fetch(`${normalizedApiBaseUrl}/api/sessions/${sessionID}/files/stats`, {
        headers: withApiAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: FileStorageStats = await response.json();
      if (
        pollingRef.current.pollingKey !== pollingKey ||
        pollingRef.current.sessionID !== sessionID
      ) {
        return;
      }
      setStats(data);
    } catch (error) {
      if (
        pollingRef.current.pollingKey !== pollingKey ||
        pollingRef.current.sessionID !== sessionID
      ) {
        return;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[useProjectFiles] Failed to fetch stats:', err);
      setStats(null);
      onErrorRef.current?.(err);
    }
  }, [normalizedApiBaseUrl]);

  const stopPolling = useCallback(() => {
    console.log('[useProjectFiles] Stopping polling');

    if (pollingRef.current.intervalId) {
      clearInterval(pollingRef.current.intervalId);
      pollingRef.current.intervalId = null;
    }

    pollingRef.current.retryCount = 0;
    pollingRef.current.active = false;
    pollingRef.current.lastObservedTotal = -1;
    pollingRef.current.stableRounds = 0;
    pollingRef.current.pollingKey += 1;
    setIsPolling(false);
  }, []);

  const startPolling = useCallback((sessionID: string, params: FileQueryParams = {}) => {
    console.log(`[useProjectFiles] Starting polling for session ${sessionID}`);

    const pollingSignature = buildPollingSignature(sessionID, params);
    const now = Date.now();
    if (shouldDebouncePollingStart(recentPollingStartsRef.current, pollingSignature, now)) {
      console.log('[useProjectFiles] Polling request debounced', { sessionID, pollingSignature });
      return;
    }

    const currentSignature =
      pollingRef.current.sessionID !== null
        ? buildPollingSignature(pollingRef.current.sessionID, pollingRef.current.params || {})
        : null;
    const hasActivePolling = pollingRef.current.active || pollingRef.current.intervalId !== null;

    if (hasActivePolling && currentSignature === pollingSignature) {
      console.log('[useProjectFiles] Polling already active with same session and params, skipping');
      return;
    }

    recentPollingStartsRef.current.set(pollingSignature, now);
    stopPolling();

    const nextPollingKey = pollingRef.current.pollingKey + 1;
    pollingRef.current.sessionID = sessionID;
    pollingRef.current.params = params;
    pollingRef.current.retryCount = 0;
    pollingRef.current.pollingKey = nextPollingKey;
    pollingRef.current.active = true;
    pollingRef.current.lastObservedTotal = -1;
    pollingRef.current.stableRounds = 0;
    setIsPolling(true);

    fetchFiles(nextPollingKey).then(data => {
      if (
        pollingRef.current.pollingKey !== nextPollingKey ||
        pollingRef.current.sessionID !== sessionID
      ) {
        return;
      }

      console.log(`[useProjectFiles] Initial fetch completed:`, data ? `${data.files.length} files` : 'null');

      if (shouldStopForStableSnapshot(data)) {
        stopPolling();
      } else {
        pollingRef.current.intervalId = setInterval(() => {
          if (
            pollingRef.current.pollingKey !== nextPollingKey ||
            pollingRef.current.sessionID !== sessionID
          ) {
            return;
          }

          fetchFiles(nextPollingKey).then(nextData => {
            if (
              pollingRef.current.pollingKey !== nextPollingKey ||
              pollingRef.current.sessionID !== sessionID
            ) {
              return;
            }

            if (shouldStopForStableSnapshot(nextData)) {
              stopPolling();
            } else {
              pollingRef.current.retryCount++;
              if (pollingRef.current.retryCount >= maxRetries) {
                console.warn(`[useProjectFiles] Max retries (${maxRetries}) reached`);
                stopPolling();
              }
            }
          });
        }, pollInterval);
      }
    });
  }, [pollInterval, maxRetries, fetchFiles, shouldStopForStableSnapshot, stopPolling]);

  const refresh = useCallback(async () => {
    await fetchFiles();
    await fetchStats();
  }, [fetchFiles, fetchStats]);

  const reset = useCallback(() => {
    const currentSessionID = pollingRef.current.sessionID;
    const currentParams = pollingRef.current.params || {};
    const nextPollingKey = pollingRef.current.pollingKey + 1;

    if (currentSessionID) {
      recentPollingStartsRef.current.delete(buildPollingSignature(currentSessionID, currentParams));
    }

    stopPolling();
    setFiles([]);
    setIsLoading(false);
    setStats(null);
    setPagination(null);
    pollingRef.current = {
      intervalId: null,
      retryCount: 0,
      sessionID: null,
      params: null,
      pollingKey: nextPollingKey,
      active: false,
      lastObservedTotal: -1,
      stableRounds: 0,
    };
  }, [stopPolling]);

  useEffect(() => {
    return () => {
      stopPolling();
      recentPollingStartsRef.current.clear();
    };
  }, [stopPolling]);

  return {
    files,
    isLoading,
    isPolling,
    stats,
    pagination,
    startPolling,
    stopPolling,
    refresh,
    fetchStats,
    reset,
  };
}
