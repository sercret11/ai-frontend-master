import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkflowContext } from '../contexts/WorkflowContext';
import type {
  AutonomyBudgetEvent,
  AutonomyDecisionEvent,
  AutonomyIterationEvent,
  RuntimeEvent,
  RuntimeToolCallState,
} from '@ai-frontend/shared-types';
import { useProjectStore } from '../lib/stores/projectStore';
import { withApiAuthHeaders } from '../utils/api-auth';
import { applyPatchBatchEnvelope } from '../lib/sandpack/patch-batch';
import type { PatchBatchEnvelope } from '../lib/sandpack/types';
import { normalizeApiBaseUrl } from '../utils/api-base';

interface DependencyChecklistItem {
  framework: string;
  packageName: string;
  topics: string[];
  projectType?: 'next-js' | 'react-vite' | 'react-native' | 'uniapp';
}

interface ResearchDigestPayload {
  generatedAt: number;
  summary: string;
  dependencies: DependencyChecklistItem[];
  apiSignatures: Array<Record<string, unknown>>;
  snippets: Array<Record<string, unknown>>;
  versionHints: Array<Record<string, unknown>>;
  sourceRefs: Array<Record<string, unknown>>;
}

type RuntimeEndpoint = 'stream' | 'assemble';

function resolvePreviewModeFromExecutor(): 'code' {
  return 'code';
}

function resolveExecutorPhaseByMode(): 'rendering-code' {
  return 'rendering-code';
}

function isRuntimeEventRelevant(event: RuntimeEvent): boolean {
  return !event.type.startsWith('sandbox.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function tryAcquireStreamMessageLock(lockRef: { current: boolean }): boolean {
  if (lockRef.current) {
    return false;
  }
  lockRef.current = true;
  return true;
}

export function releaseStreamMessageLock(lockRef: { current: boolean }): void {
  lockRef.current = false;
}

export function isExpectedStreamAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError';
  }
  if (isRecord(error)) {
    return error['name'] === 'AbortError';
  }
  return false;
}

export function shouldReportStreamError(error: unknown): boolean {
  return !isExpectedStreamAbortError(error);
}

function buildRuntimeApiUrl(
  apiUrl: string,
  backendSessionId: string | null,
  endpoint: RuntimeEndpoint
): string {
  const runtimeSession = backendSessionId || 'new';
  const trimmedApiUrl = apiUrl.replace(/\/+$/, '');
  const runtimePath = endpoint === 'assemble' ? 'assemble' : 'stream';

  if (trimmedApiUrl.includes('/api/runtime/sessions/')) {
    return trimmedApiUrl;
  }

  const baseApiUrl = normalizeApiBaseUrl(trimmedApiUrl);
  return `${baseApiUrl}/api/runtime/sessions/${runtimeSession}/${runtimePath}`;
}

function buildContext7ApiUrl(apiUrl: string): string {
  const trimmedApiUrl = apiUrl.replace(/\/+$/, '');
  if (trimmedApiUrl.includes('/api/runtime/context7/research')) {
    return trimmedApiUrl;
  }
  const baseApiUrl = normalizeApiBaseUrl(trimmedApiUrl);
  return `${baseApiUrl}/api/runtime/context7/research`;
}

function toFileMap(files: Array<{ path: string; content: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of files) {
    result[file.path] = file.content;
  }
  return result;
}

function fromFileMap(files: Record<string, string>): Array<{ path: string; content: string }> {
  return Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ path, content }));
}

const SANDBOX_STALE_PREFIXES = ['.sandpack/', '.cache/', 'node_modules/.cache/', '.vite/'];

function normalizeDependencyToken(name: string): string[] {
  const cleaned = name.replace(/^@/, '').toLowerCase();
  return cleaned
    .split(/[\/-]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function purgeStaleVfsFiles(
  files: Record<string, string>,
  removedDependencies: string[]
): { files: Record<string, string>; purgedFiles: string[] } {
  if (removedDependencies.length === 0) {
    return { files, purgedFiles: [] };
  }

  const removedTokenGroups = removedDependencies.map(normalizeDependencyToken);
  const nextEntries: Array<[string, string]> = [];
  const purgedFiles: string[] = [];

  for (const [path, content] of Object.entries(files)) {
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
    const staleByPrefix = SANDBOX_STALE_PREFIXES.some(prefix => normalizedPath.startsWith(prefix));

    const staleByRemovedDependency = removedTokenGroups.some(tokens => {
      if (tokens.length === 0) return false;
      const pathLower = normalizedPath.toLowerCase();
      const generatedLikePath =
        pathLower.startsWith('src/.generated/') ||
        pathLower.startsWith('src/components/ui/generated/');
      const hitsInPath = tokens.some(token => pathLower.includes(token));
      if (hitsInPath && generatedLikePath) {
        return true;
      }
      if (!generatedLikePath || !/\.(t|j)sx?$/.test(normalizedPath)) {
        return false;
      }
      const contentLower = content.toLowerCase();
      return tokens.some(token => contentLower.includes(token));
    });

    if (staleByPrefix || staleByRemovedDependency) {
      purgedFiles.push(path);
      continue;
    }
    nextEntries.push([path, content]);
  }

  return {
    files: Object.fromEntries(nextEntries),
    purgedFiles,
  };
}

function inferFrameworkFromPackage(name: string): string {
  const lowered = name.toLowerCase();
  if (lowered === 'next' || lowered.startsWith('@next/')) return 'next.js';
  if (lowered === 'react' || lowered.startsWith('react-')) return 'react';
  if (lowered === 'zustand') return 'zustand';
  if (lowered === 'tailwindcss' || lowered.startsWith('@tailwindcss/')) return 'tailwindcss';
  return lowered;
}

function buildDependencyChecklist(
  dependencyMap: Record<string, string>
): DependencyChecklistItem[] {
  return Object.keys(dependencyMap).map(packageName => ({
    framework: inferFrameworkFromPackage(packageName),
    packageName,
    topics: ['api', 'usage', 'errors', 'migration'],
  }));
}

export interface StreamMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  interrupted?: boolean;
  toolCalls?: ToolCall[];
  runtimeEvents?: RuntimeEvent[];
}

export interface ToolCall {
  toolName: string;
  callID: string;
  args: Record<string, unknown>;
  state?: RuntimeToolCallState | 'pending' | 'executing' | 'completed' | 'failed';
  result?: string;
  progressText?: string;
}

export interface UseWorkflowChatOptions {
  apiUrl?: string;
  endpoint?: RuntimeEndpoint;
  onChunk?: (chunk: string) => void;
  onError?: (error: Error) => void;
  useGlobalContext?: boolean;
  onToolResult?: (result: {
    toolName: string;
    callID: string;
    title: string;
    output: string;
    metadata?: unknown;
  }) => void;
  onComplete?: (data: {
    sessionId?: string;
    filesCount?: number;
  }) => void;
}

export interface CurrentAutonomyState {
  iteration?: AutonomyIterationEvent;
  budget?: AutonomyBudgetEvent;
  decision?: AutonomyDecisionEvent;
}

type OrchestrationWorkerOutput =
  | { type: 'PHASE_UPDATE'; phase: string; iteration?: number; runId?: string }
  | { type: 'PATCH_BATCH_READY'; envelope: PatchBatchEnvelope }
  | { type: 'BUDGET_UPDATE'; used?: number; limit?: number; remaining?: number; unit?: string }
  | { type: 'RESEARCH_DIGEST'; digest: ResearchDigestPayload }
  | { type: 'RESEARCH_FAILED'; error: string }
  | { type: 'PARSER_READY'; cached: boolean; durationMs: number }
  | { type: 'PARSER_FAILED'; error: string };

export function useWorkflowChat(options: UseWorkflowChatOptions = {}) {
  const {
    apiUrl = import.meta.env['VITE_API_URL'] || 'http://localhost:3001',
    endpoint = 'stream',
    onChunk,
    onError,
    useGlobalContext = true,
    onToolResult,
    onComplete,
  } = options;

  let workflowContext: ReturnType<typeof useWorkflowContext> | null = null;
  try {
    workflowContext = useWorkflowContext();
  } catch {
    workflowContext = null;
  }

  const globalContext = useGlobalContext ? workflowContext : null;

  const [localMessages, setLocalMessages] = useState<StreamMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentContent, setCurrentContent] = useState('');
  const [currentRuntimeEvents, setCurrentRuntimeEvents] = useState<RuntimeEvent[]>([]);
  const [currentToolCalls, setCurrentToolCalls] = useState<ToolCall[]>([]);
  const [currentAutonomy, setCurrentAutonomy] = useState<CurrentAutonomyState>({});
  const abortControllerRef = useRef<AbortController | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const activeRunIdRef = useRef<string | null>(null);

  const pushRuntimeEvent = useProjectStore(state => state.pushRuntimeEvent);
  const clearRuntimeEvents = useProjectStore(state => state.clearRuntimeEvents);
  const setRevision = useProjectStore(state => state.setRevision);
  const setPreviewMode = useProjectStore(state => state.setPreviewMode);
  const setPreviewUrl = useProjectStore(state => state.setPreviewUrl);
  const setExecutorState = useProjectStore(state => state.setExecutorState);
  const setPatchQueueDepth = useProjectStore(state => state.setPatchQueueDepth);
  const setFiles = useProjectStore(state => state.setFiles);
  const setDependencyMap = useProjectStore(state => state.setDependencyMap);
  const addLog = useProjectStore(state => state.addLog);

  const messages = globalContext ? globalContext.messages : localMessages;
  const setMessages = globalContext ? globalContext.setMessages : setLocalMessages;
  const currentSessionId = globalContext?.currentSessionId ?? null;
  const backendSessionId = globalContext?.backendSessionId ?? null;
  const bindBackendSessionId = globalContext?.bindBackendSessionId;
  const setBackendSessionId = globalContext?.setBackendSessionId;
  const streamMessageLockRef = useRef(false);
  const backendSessionIdRef = useRef<string | null>(backendSessionId);
  const latestContextBackendSessionIdRef = useRef<string | null>(backendSessionId);
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiUrl);

  useEffect(() => {
    latestContextBackendSessionIdRef.current = backendSessionId;
    if (!streamMessageLockRef.current) {
      backendSessionIdRef.current = backendSessionId;
    }
  }, [backendSessionId]);

  const ackPatch = useCallback(
    async (sessionId: string, envelope: PatchBatchEnvelope) => {
      const url = `${normalizedApiBaseUrl}/api/runtime/sessions/${sessionId}/patch/ack`;
      await fetch(url, {
        method: 'POST',
        headers: withApiAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          revision: envelope.revision,
          patchId: envelope.patchId,
          runId: envelope.runId,
        }),
      });
    },
    [normalizedApiBaseUrl]
  );

  const rollbackPatch = useCallback(
    async (
      sessionId: string,
      envelope: PatchBatchEnvelope,
      targetRevision: number,
      reason: string,
      causeCode?: string
    ) => {
      const url = `${normalizedApiBaseUrl}/api/runtime/sessions/${sessionId}/patch/rollback`;
      const response = await fetch(url, {
        method: 'POST',
        headers: withApiAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          runId: envelope.runId,
          failedRevision: envelope.revision,
          patchId: envelope.patchId,
          targetRevision,
          reason,
          causeCode,
        }),
      });
      if (!response.ok) {
        throw new Error(`rollback request failed with ${response.status}`);
      }
      return (await response.json()) as {
        ok: boolean;
        snapshot?: {
          revision?: number;
        };
      };
    },
    [normalizedApiBaseUrl]
  );

  useEffect(() => {
    const worker = new Worker(new URL('../workers/orchestration.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = async (message: MessageEvent<OrchestrationWorkerOutput>) => {
      const payload = message.data;
      if (payload.type === 'PHASE_UPDATE') {
        if (payload.phase === 'started') {
          setExecutorState({
            phase: 'assembling',
            executorId: 'sandpack-renderer',
            message: 'Orchestration started',
            error: null,
          });
          return;
        }
        if (payload.phase === 'stopped') {
          setExecutorState(current => ({
            phase: 'idle',
            message: 'Orchestration stopped',
            executorId: current.executorId,
            error: null,
          }));
          return;
        }
      }

      if (payload.type === 'BUDGET_UPDATE') {
        if (payload.unit && typeof payload.remaining === 'number' && typeof payload.limit === 'number') {
          addLog(`[budget] ${payload.unit}: ${payload.remaining}/${payload.limit} remaining`);
        }
        return;
      }

      if (payload.type === 'RESEARCH_DIGEST') {
        addLog(`[context7] ${payload.digest.summary}`);
        return;
      }

      if (payload.type === 'RESEARCH_FAILED') {
        addLog(`[context7:error] ${payload.error}`);
        return;
      }

      if (payload.type === 'PARSER_READY') {
        addLog(
          `[oxc] parser ready (${payload.cached ? 'cached' : 'cold'}) in ${payload.durationMs}ms`
        );
        return;
      }

      if (payload.type === 'PARSER_FAILED') {
        setExecutorState({
          phase: 'error',
          executorId: 'sandpack-renderer',
          message: 'Parser initialization failed',
          error: payload.error,
        });
        addLog(`[oxc:error] ${payload.error}`);
        return;
      }

      if (payload.type !== 'PATCH_BATCH_READY') {
        return;
      }

      const sessionId = backendSessionIdRef.current;
      if (!sessionId) {
        return;
      }

      const state = useProjectStore.getState();
      const currentFileMap = toFileMap(state.files);
      const applyResult = applyPatchBatchEnvelope(currentFileMap, payload.envelope, {
        expectedRevision: state.revision,
        previousDependencySignature: state.dependencySignature,
      });

      if (applyResult.ok) {
        let nextFileMap = applyResult.value.files;
        const removedDependencies = applyResult.value.dependencyDiff?.removed || [];
        if (applyResult.value.dependencyReloadRequired && removedDependencies.length > 0) {
          const cleanup = purgeStaleVfsFiles(applyResult.value.files, removedDependencies);
          nextFileMap = cleanup.files;
          if (cleanup.purgedFiles.length > 0) {
            addLog(
              `[vfs:cleanup] purged ${cleanup.purgedFiles.length} stale files (${cleanup.purgedFiles
                .slice(0, 5)
                .join(', ')})`
            );
          }
        }

        setFiles(fromFileMap(nextFileMap));
        setRevision(payload.envelope.revision);
        setPatchQueueDepth(current => Math.max(0, current - 1));
        setPreviewMode('code');
        setExecutorState({
          phase: applyResult.value.dependencyReloadRequired ? 'disposing' : 'rendering-code',
          executorId: 'sandpack-renderer',
          message: applyResult.value.dependencyReloadRequired
            ? 'Dependency map changed, disposing sandbox instance for hard reload'
            : 'Patch batch committed',
          error: null,
        });
        if (applyResult.dependencySignature) {
          setDependencyMap(applyResult.value.dependencyMap, applyResult.dependencySignature);
        }
        if (applyResult.value.dependencyReloadRequired) {
          const checklist = buildDependencyChecklist(applyResult.value.dependencyMap);
          if (checklist.length > 0) {
            workerRef.current?.postMessage({
              type: 'RESEARCH_REQUEST',
              endpoint: buildContext7ApiUrl(normalizedApiBaseUrl),
              runId: payload.envelope.runId,
              dependencies: checklist,
            });
          }
        }
        await ackPatch(sessionId, payload.envelope);
        return;
      }

      setPatchQueueDepth(current => Math.max(0, current - 1));
      try {
        const rollback = await rollbackPatch(
          sessionId,
          payload.envelope,
          state.revision,
          applyResult.error.detail,
          applyResult.error.causeCode
        );
        if (rollback.snapshot && typeof rollback.snapshot.revision === 'number') {
          setRevision(rollback.snapshot.revision);
        }
        addLog(
          `[patch:rollback] revision=${payload.envelope.revision} cause=${applyResult.error.causeCode || applyResult.error.code}`
        );
      } catch (error) {
        addLog(
          `[patch:rollback:error] ${error instanceof Error ? error.message : String(error)}`
        );
      }

      setExecutorState({
        phase: 'error',
        executorId: 'sandpack-renderer',
        message: 'Patch batch rolled back',
        error: applyResult.error.detail,
      });
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [
    ackPatch,
    addLog,
    normalizedApiBaseUrl,
    rollbackPatch,
    setDependencyMap,
    setExecutorState,
    setFiles,
    setPatchQueueDepth,
    setPreviewMode,
    setRevision,
  ]);

  const clearRunState = useCallback(
    (executorMessage: string = 'Waiting for task') => {
      setCurrentContent('');
      setCurrentRuntimeEvents([]);
      setCurrentToolCalls([]);
      setCurrentAutonomy({});
      clearRuntimeEvents();
      setPatchQueueDepth(0);
      setPreviewMode('code');
      setExecutorState(current => ({
        phase: 'idle',
        executorId: current.executorId,
        message: executorMessage,
        error: null,
      }));
    },
    [clearRuntimeEvents, setExecutorState, setPatchQueueDepth, setPreviewMode]
  );

  const streamMessage = useCallback(
    async (content: string) => {
      if (!tryAcquireStreamMessageLock(streamMessageLockRef)) {
        return;
      }

      const requestLocalSessionId = currentSessionId;
      const userMessage: StreamMessage = {
        id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, userMessage]);

      setIsStreaming(true);
      clearRunState();
      activeRunIdRef.current = null;
      const requestSessionId = backendSessionIdRef.current;

      if (endpoint === 'assemble') {
        setPreviewMode('code');
        setPreviewUrl(null);
        setExecutorState({
          phase: 'assembling',
          executorId: null,
          message: 'Connecting to assembly stream...',
          error: null,
        });
      }

      abortControllerRef.current = new AbortController();
      let textRevealTimer: ReturnType<typeof setTimeout> | null = null;
      let runtimeRevealTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        const runtimeApiUrl = buildRuntimeApiUrl(normalizedApiBaseUrl, requestSessionId, endpoint);
        const response = await fetch(runtimeApiUrl, {
          method: 'POST',
          headers: withApiAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            message: content,
            sessionId: requestSessionId || undefined,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let fullText = '';
        const toolCalls: ToolCall[] = [];
        const runtimeEvents: RuntimeEvent[] = [];
        let autonomyState: CurrentAutonomyState = {};
        let activeRunId: string | null = null;
        let displayedText = '';
        let pendingText = '';
        textRevealTimer = null;
        const runtimeRevealQueue: RuntimeEvent[] = [];
        const displayedRuntimeEvents: RuntimeEvent[] = [];
        runtimeRevealTimer = null;

        const wait = (ms: number) =>
          new Promise<void>(resolve => {
            setTimeout(resolve, ms);
          });

        const flushTextReveal = () => {
          if (textRevealTimer) {
            return;
          }
          const step = () => {
            if (pendingText.length === 0) {
              textRevealTimer = null;
              return;
            }
            const chunkSize = Math.max(1, Math.min(24, pendingText.length));
            const chunk = pendingText.slice(0, chunkSize);
            pendingText = pendingText.slice(chunkSize);
            displayedText += chunk;
            setCurrentContent(displayedText);
            onChunk?.(chunk);
            textRevealTimer = setTimeout(step, 24);
          };
          textRevealTimer = setTimeout(step, 0);
        };

        const enqueueRuntimeReveal = (event: RuntimeEvent) => {
          runtimeRevealQueue.push(event);
          if (runtimeRevealTimer) {
            return;
          }
          const step = () => {
            const nextEvent = runtimeRevealQueue.shift();
            if (!nextEvent) {
              runtimeRevealTimer = null;
              return;
            }
            displayedRuntimeEvents.push(nextEvent);
            setCurrentRuntimeEvents([...displayedRuntimeEvents]);
            pushRuntimeEvent(nextEvent);
            runtimeRevealTimer = setTimeout(step, 100);
          };
          runtimeRevealTimer = setTimeout(step, 0);
        };

        const drainRevealQueue = async () => {
          while (
            pendingText.length > 0 ||
            textRevealTimer !== null ||
            runtimeRevealQueue.length > 0 ||
            runtimeRevealTimer !== null
          ) {
            if (pendingText.length > 0 && !textRevealTimer) {
              flushTextReveal();
            }
            await wait(20);
          }
          if (displayedText !== fullText) {
            displayedText = fullText;
            setCurrentContent(displayedText);
          }
        };

        let buffer = '';
        let filesCount = 0;
        let sessionId: string | undefined;

        const applyBackendSessionUpdate = (nextSessionId: string) => {
          backendSessionIdRef.current = nextSessionId;
          if (requestLocalSessionId && bindBackendSessionId) {
            bindBackendSessionId(requestLocalSessionId, nextSessionId);
            return;
          }
          setBackendSessionId?.(nextSessionId);
        };

        const upsertToolCall = (
          callID: string,
          updater: (existing: ToolCall | undefined) => ToolCall
        ) => {
          const idx = toolCalls.findIndex(tc => tc.callID === callID);
          const updated = updater(idx >= 0 ? toolCalls[idx] : undefined);
          if (idx >= 0) {
            toolCalls[idx] = updated;
          } else {
            toolCalls.push(updated);
          }
        };

        let streamError: Error | null = null;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);

            if (!line.trim() || !line.startsWith('data: ')) {
              continue;
            }

            const payload = line.slice(6).trim();
            if (!payload || payload === '[DONE]') {
              continue;
            }

            let parsed: unknown;
            try {
              parsed = JSON.parse(payload);
            } catch (parseError) {
              console.warn('Failed to parse SSE chunk:', parseError, payload);
              continue;
            }

            if (!isRecord(parsed)) {
              continue;
            }

            const parsedError = parsed['error'];
            if (typeof parsedError === 'string') {
              streamError = new Error(parsedError);
              break outer;
            }

            const rawEvent = parsed['event'];
            if (!isRecord(rawEvent)) {
              continue;
            }

            const event = rawEvent as unknown as RuntimeEvent;
            const eventRunId = typeof event.runId === 'string' ? event.runId : null;
            if (!eventRunId) {
              continue;
            }

            if (!activeRunId) {
              activeRunId = eventRunId;
              activeRunIdRef.current = eventRunId;
              workerRef.current?.postMessage({
                type: 'RUN_START',
                runId: eventRunId,
              });
            }
            if (eventRunId !== activeRunId) {
              continue;
            }

            const eventSessionId =
              typeof event.sessionId === 'string' && event.sessionId.trim().length > 0
                ? event.sessionId
                : null;
            if (eventSessionId) {
              sessionId = eventSessionId;
              applyBackendSessionUpdate(eventSessionId);
            }

            workerRef.current?.postMessage({
              type: 'RUNTIME_EVENT',
              event,
            });

            if (isRuntimeEventRelevant(event)) {
              runtimeEvents.push(event);
              enqueueRuntimeReveal(event);
            }

            switch (event.type) {
              case 'assembly.graph.ready': {
                setRevision(event.revision);
                setPatchQueueDepth(event.pendingPatches);
                const nextMode = resolvePreviewModeFromExecutor();
                setPreviewMode(nextMode);
                setExecutorState({
                  phase: 'assembling',
                  executorId: event.executor,
                  message: event.message || 'Assembly graph is ready.',
                  error: null,
                });
                break;
              }
              case 'assembly.patch':
                setPatchQueueDepth(depth => (event.acked ? Math.max(0, depth - 1) : depth + 1));
                break;
              case 'assembly.executor.switch': {
                setRevision(event.revision);
                setPreviewMode(resolvePreviewModeFromExecutor());
                setExecutorState({
                  phase: resolveExecutorPhaseByMode(),
                  executorId: event.executor,
                  message: event.message || 'Executor switched.',
                  error: null,
                });
                break;
              }
              case 'assistant.delta':
                fullText += event.delta;
                pendingText += event.delta;
                flushTextReveal();
                break;
              case 'tool.call.started':
                upsertToolCall(event.callId, existing => ({
                  toolName: event.toolName,
                  callID: event.callId,
                  args: event.args || existing?.args || {},
                  state: event.state,
                  result: existing?.result,
                  progressText: existing?.progressText,
                }));
                setCurrentToolCalls([...toolCalls]);
                break;
              case 'tool.call.progress':
                upsertToolCall(event.callId, existing => ({
                  toolName: event.toolName,
                  callID: event.callId,
                  args: existing?.args || {},
                  state: event.state,
                  result: existing?.result,
                  progressText: event.progressText || existing?.progressText,
                }));
                setCurrentToolCalls([...toolCalls]);
                break;
              case 'tool.call.completed':
                upsertToolCall(event.callId, existing => ({
                  toolName: event.toolName,
                  callID: event.callId,
                  args: existing?.args || {},
                  state: event.state,
                  result: event.output || existing?.result || '',
                  progressText: existing?.progressText,
                }));
                setCurrentToolCalls([...toolCalls]);
                onToolResult?.({
                  toolName: event.toolName,
                  callID: event.callId,
                  title: event.title || '',
                  output: event.output || '',
                  metadata: event.metadata,
                });
                break;
              case 'tool.call.failed':
                upsertToolCall(event.callId, existing => ({
                  toolName: event.toolName,
                  callID: event.callId,
                  args: existing?.args || {},
                  state: event.state,
                  result: event.error || existing?.result || '',
                  progressText: existing?.progressText,
                }));
                setCurrentToolCalls([...toolCalls]);
                break;
              case 'run.completed':
                filesCount = event.filesCount || filesCount;
                sessionId = event.sessionId;
                if (event.sessionId) {
                  applyBackendSessionUpdate(event.sessionId);
                }
                if (endpoint === 'assemble') {
                  setPatchQueueDepth(0);
                }
                setExecutorState(current => ({
                  phase: 'idle',
                  executorId: current.executorId,
                  message: 'Run completed.',
                  error: null,
                }));
                workerRef.current?.postMessage({
                  type: 'RUN_STOP',
                  runId: activeRunId,
                });
                break;
              case 'run.error':
                streamError = new Error(event.error);
                setExecutorState({
                  phase: 'error',
                  executorId: 'sandpack-renderer',
                  message: 'Run failed.',
                  error: event.error,
                });
                workerRef.current?.postMessage({
                  type: 'RUN_STOP',
                  runId: activeRunId,
                });
                break outer;
              case 'autonomy.iteration':
                autonomyState = { ...autonomyState, iteration: event };
                setCurrentAutonomy({ ...autonomyState });
                break;
              case 'autonomy.budget':
                autonomyState = { ...autonomyState, budget: event };
                setCurrentAutonomy({ ...autonomyState });
                break;
              case 'autonomy.decision':
                autonomyState = { ...autonomyState, decision: event };
                setCurrentAutonomy({ ...autonomyState });
                break;
              default:
                break;
            }
          }
        }

        if (streamError) {
          throw streamError;
        }

        await drainRevealQueue();

        if (fullText.trim() || toolCalls.length > 0 || runtimeEvents.length > 0) {
          const assistantMessage: StreamMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: fullText,
            timestamp: Date.now(),
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            runtimeEvents: runtimeEvents.length > 0 ? runtimeEvents : undefined,
          };
          setMessages(prev => [...prev, assistantMessage]);
        }

        onComplete?.({ sessionId, filesCount });
      } catch (error) {
        if (!shouldReportStreamError(error)) {
          clearRunState(endpoint === 'assemble' ? 'Assembly stream interrupted.' : 'Stream interrupted.');
          workerRef.current?.postMessage({
            type: 'RUN_STOP',
            runId: activeRunIdRef.current || undefined,
          });
          return;
        }

        const normalizedError = error instanceof Error ? error : new Error(String(error));
        if (endpoint === 'assemble') {
          setExecutorState({
            phase: 'error',
            message: 'Assembly request failed.',
            executorId: 'sandpack-renderer',
            error: normalizedError.message,
          });
        }
        onError?.(normalizedError);
      } finally {
        if (textRevealTimer) {
          clearTimeout(textRevealTimer);
        }
        if (runtimeRevealTimer) {
          clearTimeout(runtimeRevealTimer);
        }
        setIsStreaming(false);
        setCurrentContent('');
        setCurrentRuntimeEvents([]);
        setCurrentToolCalls([]);
        abortControllerRef.current = null;
        activeRunIdRef.current = null;
        releaseStreamMessageLock(streamMessageLockRef);
        backendSessionIdRef.current = latestContextBackendSessionIdRef.current;
      }
    },
    [
      bindBackendSessionId,
      currentSessionId,
      normalizedApiBaseUrl,
      clearRunState,
      endpoint,
      onChunk,
      onComplete,
      onError,
      onToolResult,
      pushRuntimeEvent,
      setBackendSessionId,
      setExecutorState,
      setMessages,
      setPatchQueueDepth,
      setPreviewMode,
      setPreviewUrl,
      setRevision,
    ]
  );

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();

    if (currentContent) {
      const partialMessage: StreamMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `${currentContent}\n\n[stopped by user]`,
        timestamp: Date.now(),
        interrupted: true,
      };
      setMessages(prev => [...prev, partialMessage]);
    }

    setIsStreaming(false);
    clearRunState(endpoint === 'assemble' ? 'Assembly stream interrupted.' : 'Stream interrupted.');
    workerRef.current?.postMessage({
      type: 'RUN_STOP',
      runId: activeRunIdRef.current || undefined,
    });
    abortControllerRef.current = null;
    activeRunIdRef.current = null;
  }, [clearRunState, currentContent, endpoint, setMessages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    clearRunState();
  }, [clearRunState, setMessages]);

  return {
    messages,
    isStreaming,
    currentContent,
    currentRuntimeEvents,
    currentToolCalls,
    currentAutonomy,
    streamMessage,
    stopStreaming,
    clearMessages,
  };
}
