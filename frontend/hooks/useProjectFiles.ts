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
const DEFAULT_FILE_PAGE_LIMIT = 50;
const sharedRecentPollingStarts = new Map<string, number>();

type PollingPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
} | null;

interface CoordinatorSnapshot {
  files: StoredFile[];
  isLoading: boolean;
  isPolling: boolean;
  stats: FileStorageStats | null;
  pagination: PollingPagination;
}

interface CoordinatorRequest {
  sessionID: string;
  params: FileQueryParams;
  signature: string;
  apiBaseUrl: string;
  pollInterval: number;
  maxRetries: number;
  requestedAt: number;
}

interface ActivePollingJob extends CoordinatorRequest {
  intervalId: ReturnType<typeof setInterval> | null;
  retryCount: number;
  stableRounds: number;
  lastObservedTotal: number;
  inFlight: boolean;
  stopped: boolean;
}

interface CoordinatorSubscriber {
  onSnapshot: (snapshot: CoordinatorSnapshot) => void;
  onFilesLoaded?: (files: StoredFile[]) => void;
  onError?: (error: Error) => void;
}

const coordinatorSubscribers = new Map<string, CoordinatorSubscriber>();
const coordinatorRequests = new Map<string, CoordinatorRequest>();
let coordinatorActiveJob: ActivePollingJob | null = null;
let ownerSequence = 0;

let coordinatorSnapshot: CoordinatorSnapshot = {
  files: [],
  isLoading: false,
  isPolling: false,
  stats: null,
  pagination: null,
};

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
  pagination: PollingPagination;
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

function nextOwnerId(): string {
  ownerSequence += 1;
  return `project-files-owner-${ownerSequence}`;
}

function cloneQueryParams(params: FileQueryParams = {}): FileQueryParams {
  return { ...params };
}

function buildQueryParams(params: FileQueryParams = {}): URLSearchParams {
  const queryParams = new URLSearchParams();
  if (params.page) queryParams.append('page', params.page.toString());
  if (params.limit) queryParams.append('limit', params.limit.toString());
  if (params.search) queryParams.append('search', params.search);
  if (params.language) queryParams.append('language', params.language);
  if (params.sortBy) queryParams.append('sortBy', params.sortBy);
  if (params.sortOrder) queryParams.append('sortOrder', params.sortOrder);
  return queryParams;
}

function sortStoredFilesByPath(files: StoredFile[]): StoredFile[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

function publishSnapshot(): void {
  coordinatorSubscribers.forEach(subscriber => {
    subscriber.onSnapshot(coordinatorSnapshot);
  });
}

function updateSnapshot(patch: Partial<CoordinatorSnapshot>): void {
  coordinatorSnapshot = {
    ...coordinatorSnapshot,
    ...patch,
  };
  publishSnapshot();
}

function notifyFilesLoaded(job: ActivePollingJob, files: StoredFile[]): void {
  coordinatorSubscribers.forEach((subscriber, ownerId) => {
    const request = coordinatorRequests.get(ownerId);
    if (!request) {
      return;
    }
    if (request.signature !== job.signature || request.apiBaseUrl !== job.apiBaseUrl) {
      return;
    }
    subscriber.onFilesLoaded?.(files);
  });
}

function notifyError(job: ActivePollingJob, error: Error): void {
  coordinatorSubscribers.forEach((subscriber, ownerId) => {
    const request = coordinatorRequests.get(ownerId);
    if (!request) {
      return;
    }
    if (request.signature !== job.signature || request.apiBaseUrl !== job.apiBaseUrl) {
      return;
    }
    subscriber.onError?.(error);
  });
}

function getCurrentTotal(data: FileBatchResponse): number {
  return data.pagination?.total ?? data.files.length;
}

function areStoredFilesEqual(left: StoredFile[], right: StoredFile[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = sortStoredFilesByPath(left);
  const sortedRight = sortStoredFilesByPath(right);

  for (let index = 0; index < sortedLeft.length; index += 1) {
    const leftFile = sortedLeft[index];
    const rightFile = sortedRight[index];
    if (!leftFile || !rightFile) {
      return false;
    }
    if (
      leftFile.sessionID !== rightFile.sessionID ||
      leftFile.path !== rightFile.path ||
      leftFile.content !== rightFile.content
    ) {
      return false;
    }
  }

  return true;
}

function shouldStopForStableSnapshot(job: ActivePollingJob, data: FileBatchResponse): boolean {
  const currentTotal = getCurrentTotal(data);

  if (currentTotal <= 0) {
    job.lastObservedTotal = currentTotal;
    job.stableRounds = 0;
    return false;
  }

  if (job.lastObservedTotal === currentTotal) {
    job.stableRounds += 1;
  } else {
    job.lastObservedTotal = currentTotal;
    job.stableRounds = 0;
  }

  const reachedStableRounds = job.stableRounds >= STABLE_FILE_TOTAL_ROUNDS;
  if (reachedStableRounds) {
    console.log('[useProjectFiles] Stop polling after stable file total snapshot', {
      sessionID: job.sessionID,
      currentTotal,
      stableRounds: job.stableRounds,
    });
  }
  return reachedStableRounds;
}

function isActiveJob(job: ActivePollingJob): boolean {
  return coordinatorActiveJob === job && !job.stopped;
}

function clearRequestsBySignature(signature: string, apiBaseUrl: string): void {
  coordinatorRequests.forEach((request, ownerId) => {
    if (request.signature === signature && request.apiBaseUrl === apiBaseUrl) {
      coordinatorRequests.delete(ownerId);
    }
  });
}

function stopActiveJob(options: { clearRequests?: boolean } = {}): void {
  const activeJob = coordinatorActiveJob;
  if (!activeJob) {
    updateSnapshot({ isPolling: false, isLoading: false });
    return;
  }

  activeJob.stopped = true;
  if (activeJob.intervalId) {
    clearInterval(activeJob.intervalId);
    activeJob.intervalId = null;
  }

  if (options.clearRequests) {
    clearRequestsBySignature(activeJob.signature, activeJob.apiBaseUrl);
  }

  coordinatorActiveJob = null;
  updateSnapshot({ isPolling: false, isLoading: false });
}

async function fetchFileBatch(job: ActivePollingJob): Promise<FileBatchResponse> {
  const requestedLimit =
    typeof job.params.limit === 'number' && Number.isFinite(job.params.limit) && job.params.limit > 0
      ? job.params.limit
      : DEFAULT_FILE_PAGE_LIMIT;
  const requestedPage =
    typeof job.params.page === 'number' && Number.isFinite(job.params.page) && job.params.page > 0
      ? job.params.page
      : 1;

  const fetchPage = async (page: number): Promise<FileBatchResponse> => {
    const encodedSessionId = encodeURIComponent(job.sessionID);
    const queryParams = buildQueryParams({
      ...job.params,
      page,
      limit: requestedLimit,
    });
    const response = await fetch(
      `${job.apiBaseUrl}/api/sessions/${encodedSessionId}/files?${queryParams.toString()}`,
      {
        headers: withApiAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return (await response.json()) as FileBatchResponse;
  };

  const firstPage = await fetchPage(requestedPage);
  const allFiles = [...firstPage.files];

  let currentPage = firstPage.pagination.page;
  const totalPages = firstPage.pagination.totalPages;

  while (currentPage < totalPages && currentPage < 100) {
    currentPage += 1;
    const nextPage = await fetchPage(currentPage);
    allFiles.push(...nextPage.files);
  }

  const mergedFiles = sortStoredFilesByPath(allFiles);

  return {
    sessionID: firstPage.sessionID,
    files: mergedFiles,
    pagination: {
      ...firstPage.pagination,
      page: requestedPage,
      limit: mergedFiles.length,
      hasNext: false,
      hasPrev: false,
      totalPages: 1,
    },
  };
}

async function fetchFileStats(request: CoordinatorRequest): Promise<FileStorageStats> {
  const encodedSessionId = encodeURIComponent(request.sessionID);
  const response = await fetch(`${request.apiBaseUrl}/api/sessions/${encodedSessionId}/files/stats`, {
    headers: withApiAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return (await response.json()) as FileStorageStats;
}

async function runPollingTick(job: ActivePollingJob): Promise<void> {
  if (!isActiveJob(job) || job.inFlight) {
    return;
  }

  job.inFlight = true;
  updateSnapshot({ isLoading: true });

  try {
    const data = await fetchFileBatch(job);

    if (!isActiveJob(job)) {
      return;
    }

    const normalizedFiles = sortStoredFilesByPath(data.files);
    const filesChanged = !areStoredFilesEqual(coordinatorSnapshot.files, normalizedFiles);
    const paginationChanged =
      !coordinatorSnapshot.pagination
      || coordinatorSnapshot.pagination.page !== data.pagination.page
      || coordinatorSnapshot.pagination.limit !== data.pagination.limit
      || coordinatorSnapshot.pagination.total !== data.pagination.total
      || coordinatorSnapshot.pagination.totalPages !== data.pagination.totalPages
      || coordinatorSnapshot.pagination.hasNext !== data.pagination.hasNext
      || coordinatorSnapshot.pagination.hasPrev !== data.pagination.hasPrev;

    if (filesChanged || paginationChanged) {
      coordinatorSnapshot = {
        ...coordinatorSnapshot,
        files: normalizedFiles,
        pagination: data.pagination,
        stats: {
          sessionID: job.sessionID,
          fileCount: data.pagination.total,
          totalSize: coordinatorSnapshot.stats?.totalSize || 0,
          filesByLanguage: {},
        },
      };
      publishSnapshot();
    }

    if (normalizedFiles.length > 0 && filesChanged) {
      job.retryCount = 0;
      notifyFilesLoaded(job, normalizedFiles);
      console.log(`[useProjectFiles] Loaded ${normalizedFiles.length} files for session ${job.sessionID}`);
    }

    if (shouldStopForStableSnapshot(job, data)) {
      stopActiveJob({ clearRequests: true });
    }
  } catch (error) {
    if (!isActiveJob(job)) {
      return;
    }

    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[useProjectFiles] Failed to fetch files:', err);
    notifyError(job, err);

    job.retryCount += 1;
    if (job.retryCount >= job.maxRetries) {
      console.warn(`[useProjectFiles] Max retries (${job.maxRetries}) reached`);
      stopActiveJob({ clearRequests: true });
    }
  } finally {
    job.inFlight = false;
    if (isActiveJob(job)) {
      updateSnapshot({ isLoading: false });
    }
  }
}

function startJob(request: CoordinatorRequest): void {
  const job: ActivePollingJob = {
    ...request,
    intervalId: null,
    retryCount: 0,
    stableRounds: 0,
    lastObservedTotal: -1,
    inFlight: false,
    stopped: false,
  };

  coordinatorActiveJob = job;
  updateSnapshot({
    isPolling: true,
    isLoading: false,
  });

  runPollingTick(job).then(() => {
    if (!isActiveJob(job)) {
      return;
    }

    job.intervalId = setInterval(() => {
      void runPollingTick(job);
    }, job.pollInterval);
  });
}

function selectLatestRequest(): CoordinatorRequest | null {
  let latest: CoordinatorRequest | null = null;
  coordinatorRequests.forEach(request => {
    if (!latest || request.requestedAt > latest.requestedAt) {
      latest = request;
    }
  });
  return latest;
}

function reconcileActiveJob(): void {
  const target = selectLatestRequest();
  if (!target) {
    stopActiveJob();
    return;
  }

  const activeJob = coordinatorActiveJob;
  if (
    activeJob &&
    activeJob.signature === target.signature &&
    activeJob.apiBaseUrl === target.apiBaseUrl
  ) {
    activeJob.maxRetries = target.maxRetries;
    if (activeJob.pollInterval !== target.pollInterval) {
      activeJob.pollInterval = target.pollInterval;
      if (activeJob.intervalId) {
        clearInterval(activeJob.intervalId);
      }
      activeJob.intervalId = setInterval(() => {
        void runPollingTick(activeJob);
      }, activeJob.pollInterval);
    }
    updateSnapshot({ isPolling: true });
    return;
  }

  stopActiveJob();
  startJob(target);
}

function subscribeToCoordinator(ownerId: string, subscriber: CoordinatorSubscriber): () => void {
  coordinatorSubscribers.set(ownerId, subscriber);
  subscriber.onSnapshot(coordinatorSnapshot);

  return () => {
    coordinatorSubscribers.delete(ownerId);
    coordinatorRequests.delete(ownerId);
    reconcileActiveJob();
  };
}

function requestStartPolling(ownerId: string, request: CoordinatorRequest): void {
  coordinatorRequests.set(ownerId, request);
  reconcileActiveJob();
}

function requestStopPolling(ownerId: string): void {
  coordinatorRequests.delete(ownerId);
  reconcileActiveJob();
}

async function requestRefresh(ownerId: string): Promise<void> {
  const ownerRequest = coordinatorRequests.get(ownerId);
  if (!ownerRequest) {
    return;
  }

  reconcileActiveJob();
  const activeJob = coordinatorActiveJob;
  if (!activeJob) {
    return;
  }
  if (
    activeJob.signature !== ownerRequest.signature ||
    activeJob.apiBaseUrl !== ownerRequest.apiBaseUrl
  ) {
    return;
  }

  await runPollingTick(activeJob);
}

async function requestFetchStats(ownerId: string): Promise<void> {
  const ownerRequest = coordinatorRequests.get(ownerId);
  if (!ownerRequest) {
    return;
  }

  try {
    const stats = await fetchFileStats(ownerRequest);
    const latestRequest = coordinatorRequests.get(ownerId);
    if (!latestRequest) {
      return;
    }
    if (
      latestRequest.signature !== ownerRequest.signature ||
      latestRequest.apiBaseUrl !== ownerRequest.apiBaseUrl
    ) {
      return;
    }
    updateSnapshot({ stats });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[useProjectFiles] Failed to fetch stats:', err);
    const activeJob = coordinatorActiveJob;
    if (activeJob) {
      notifyError(activeJob, err);
    }
  }
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

  const [files, setFiles] = useState<StoredFile[]>(() => coordinatorSnapshot.files);
  const [isLoading, setIsLoading] = useState(() => coordinatorSnapshot.isLoading);
  const [isPolling, setIsPolling] = useState(() => coordinatorSnapshot.isPolling);
  const [stats, setStats] = useState<FileStorageStats | null>(() => coordinatorSnapshot.stats);
  const [pagination, setPagination] = useState<PollingPagination>(() => coordinatorSnapshot.pagination);
  const onFilesLoadedRef = useRef(onFilesLoaded);
  const onErrorRef = useRef(onError);
  const recentPollingStartsRef = useRef<Map<string, number>>(new Map());
  const ownerIdRef = useRef(nextOwnerId());
  const ownerSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    onFilesLoadedRef.current = onFilesLoaded;
  }, [onFilesLoaded]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const ownerId = ownerIdRef.current;
    const unsubscribe = subscribeToCoordinator(ownerId, {
      onSnapshot: snapshot => {
        setFiles(snapshot.files);
        setIsLoading(snapshot.isLoading);
        setIsPolling(snapshot.isPolling);
        setStats(snapshot.stats);
        setPagination(snapshot.pagination);
      },
      onFilesLoaded: loadedFiles => {
        onFilesLoadedRef.current?.(loadedFiles);
      },
      onError: error => {
        onErrorRef.current?.(error);
      },
    });

    return () => {
      unsubscribe();
      const signature = ownerSignatureRef.current;
      if (signature) {
        recentPollingStartsRef.current.delete(signature);
        sharedRecentPollingStarts.delete(signature);
      }
      recentPollingStartsRef.current.clear();
      pruneRecentPollingStarts(sharedRecentPollingStarts, Date.now());
    };
  }, []);

  const stopPolling = useCallback(() => {
    const ownerId = ownerIdRef.current;
    const signature = ownerSignatureRef.current;
    if (signature) {
      recentPollingStartsRef.current.delete(signature);
      sharedRecentPollingStarts.delete(signature);
    }
    ownerSignatureRef.current = null;
    requestStopPolling(ownerId);
  }, []);

  const startPolling = useCallback((sessionID: string, params: FileQueryParams = {}) => {
    console.log(`[useProjectFiles] Starting polling for session ${sessionID}`);

    const pollingSignature = buildPollingSignature(sessionID, params);
    const now = Date.now();
    const localDebounced = shouldDebouncePollingStart(
      recentPollingStartsRef.current,
      pollingSignature,
      now,
    );
    const sharedDebounced = shouldDebouncePollingStart(
      sharedRecentPollingStarts,
      pollingSignature,
      now,
    );
    if (localDebounced || sharedDebounced) {
      console.log('[useProjectFiles] Polling request debounced', { sessionID, pollingSignature });
      return;
    }

    recentPollingStartsRef.current.set(pollingSignature, now);
    sharedRecentPollingStarts.set(pollingSignature, now);

    ownerSignatureRef.current = pollingSignature;
    requestStartPolling(ownerIdRef.current, {
      sessionID,
      params: cloneQueryParams(params),
      signature: pollingSignature,
      apiBaseUrl: normalizedApiBaseUrl,
      pollInterval,
      maxRetries,
      requestedAt: now,
    });
  }, [normalizedApiBaseUrl, pollInterval, maxRetries]);

  const refresh = useCallback(async () => {
    await requestRefresh(ownerIdRef.current);
    await requestFetchStats(ownerIdRef.current);
  }, []);

  const fetchStats = useCallback(async () => {
    await requestFetchStats(ownerIdRef.current);
  }, []);

  const reset = useCallback(() => {
    const signature = ownerSignatureRef.current;
    if (signature) {
      recentPollingStartsRef.current.delete(signature);
      sharedRecentPollingStarts.delete(signature);
    }
    ownerSignatureRef.current = null;
    requestStopPolling(ownerIdRef.current);
    setFiles([]);
    setIsLoading(false);
    setIsPolling(false);
    setStats(null);
    setPagination(null);
  }, []);

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
