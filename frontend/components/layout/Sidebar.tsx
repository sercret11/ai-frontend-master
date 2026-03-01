import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Wand2,
  Mic,
  PlusCircle,
  ArrowUp,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  useWorkflowChat,
  StreamMessage,
  type CurrentAutonomyState,
} from '../../hooks/useWorkflowChat';
import { useProjectStore } from '../../lib/stores/projectStore';
import { useProjectFiles } from '../../hooks/useProjectFiles';
import { useWorkflowContext } from '../../contexts/WorkflowContext';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { RunConsole } from '../workflow/RunConsole';
import { logger } from '../../utils/logger';
import { messageDeduplicator } from '../../utils/request-dedup';
import { withApiAuthHeaders } from '../../utils/api-auth';
import { normalizeApiBaseUrl } from '../../utils/api-base';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('ErrorBoundary caught error:', { error: error.message, errorInfo });
  }

  override render() {
    if (this.state.hasError) {
      return <p className="text-sm text-gray-500 italic">Failed to render content</p>;
    }
    return this.props.children;
  }
}

const MAX_CHARS = 10000;
const WARNING_THRESHOLD = MAX_CHARS * 0.9;
const POLLING_REQUEST_DEBOUNCE_MS = 500;
type ProjectTemplate = 'next-js' | 'react-vite' | 'react-native' | 'uniapp';

function readProjectTemplate(metadata: unknown): ProjectTemplate | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  const maybeTemplate = (metadata as { template?: unknown }).template;
  if (
    maybeTemplate === 'next-js' ||
    maybeTemplate === 'react-vite' ||
    maybeTemplate === 'react-native' ||
    maybeTemplate === 'uniapp'
  ) {
    return maybeTemplate;
  }
  return null;
}

const MessageItem = React.memo<{
  message: StreamMessage;
  isStreaming?: boolean;
}>(
  ({ message, isStreaming = false }) => {
    return (
      <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`max-w-[85%] rounded-2xl px-4 py-3 ${
            message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
          }`}
        >
          {message.role === 'assistant' ? (
            <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
              <ErrorBoundary>
                <MarkdownRenderer content={message.content} />
              </ErrorBoundary>
            </div>
          ) : (
            <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
          )}
          {isStreaming && (
            <div className="flex items-center gap-1 mt-2">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
          )}
          {message.interrupted && (
            <div className="mt-1 text-xs text-gray-500 italic">[Response interrupted by user]</div>
          )}

          {((message.toolCalls && message.toolCalls.length > 0) ||
            (message.runtimeEvents && message.runtimeEvents.length > 0)) && (
            <RunConsole events={message.runtimeEvents || []} toolCalls={message.toolCalls || []} />
          )}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.content === nextProps.message.content &&
      prevProps.isStreaming === nextProps.isStreaming
    );
  }
);

MessageItem.displayName = 'MessageItem';

const RenderStageBadge: React.FC<{
  stage?: string;
  status?: 'started' | 'completed' | 'failed';
  message?: string;
  durationMs?: number;
  groupId?: string;
  parentId?: string;
  sequence?: number;
}> = ({ stage, status, message, durationMs, groupId, parentId, sequence }) => {
  if (!stage || !status) return null;

  const metaParts = [
    typeof durationMs === 'number' ? `${durationMs}ms` : null,
    typeof sequence === 'number' ? `#${sequence}` : null,
    groupId ? `group=${groupId}` : null,
    parentId ? `parent=${parentId}` : null,
  ].filter(Boolean);

  return (
    <div className="mx-4 mt-3 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 flex items-center gap-2">
      {status === 'started' ? (
        <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
      ) : status === 'completed' ? (
        <CheckCircle2 className="w-4 h-4 text-green-600" />
      ) : (
        <AlertCircle className="w-4 h-4 text-red-600" />
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-700">
          Render pipeline: {stage} ({status})
        </div>
        {message && <div className="text-[11px] text-gray-500 truncate">{message}</div>}
        {metaParts.length > 0 && (
          <div className="text-[10px] text-gray-400 truncate font-mono">{metaParts.join(' | ')}</div>
        )}
      </div>
    </div>
  );
};

const AutonomyBadge: React.FC<{
  state: CurrentAutonomyState;
  isStreaming: boolean;
  isRunConsoleStreaming: boolean;
  wasInterrupted: boolean;
}> = ({ state, isStreaming, isRunConsoleStreaming, wasInterrupted }) => {
  const { iteration, budget, decision } = state;
  if (!iteration && !budget && !decision && !isStreaming && !wasInterrupted) return null;

  const streamStatusText = isRunConsoleStreaming
    ? 'Streaming tool/runtime events'
    : isStreaming
      ? 'Generating response'
      : wasInterrupted
        ? 'Interrupted, showing last autonomy state'
        : 'Waiting for next step';

  const streamStatusTone = isRunConsoleStreaming
    ? 'text-blue-600 bg-blue-50 border-blue-100'
    : isStreaming
      ? 'text-indigo-600 bg-indigo-50 border-indigo-100'
      : wasInterrupted
        ? 'text-amber-700 bg-amber-50 border-amber-100'
        : 'text-gray-600 bg-gray-50 border-gray-100';

  const iterationValue = iteration
    ? `${typeof iteration.iteration === 'number' ? `#${iteration.iteration}` : '--'}${
        typeof iteration.maxIterations === 'number' ? `/${iteration.maxIterations}` : ''
      }`
    : '--';
  const iterationMeta = iteration
    ? [
        iteration.stage,
        typeof iteration.reflectionScore === 'number' ? `score ${iteration.reflectionScore}` : null,
      ]
        .filter(Boolean)
        .join(' | ')
    : '';
  const iterationMessage = iteration?.message;
  const iterationTone =
    iteration?.stage === 'complete'
      ? 'text-green-700'
      : iteration?.stage === 'repair' || iteration?.stage === 'reflect'
        ? 'text-blue-700'
        : 'text-gray-700';

  const budgetValue = budget
    ? `${budget.scope || 'run'} | ${typeof budget.used === 'number' ? budget.used : '--'}${
        typeof budget.limit === 'number' ? `/${budget.limit}` : ''
      }${budget.unit ? ` ${budget.unit}` : ''}`
    : '--';
  const budgetMeta = budget
    ? [typeof budget.remaining === 'number' ? `remaining ${budget.remaining}` : null, budget.status]
        .filter(Boolean)
        .join(' | ')
    : '';
  const budgetMessage = budget?.message;
  const budgetTone =
    budget?.status === 'exhausted'
      ? 'text-red-700'
      : budget?.status === 'warning'
        ? 'text-amber-700'
        : budget?.status === 'ok'
          ? 'text-green-700'
          : 'text-gray-700';

  const decisionValue = decision?.decision || '--';
  const decisionMeta = decision
    ? [
        typeof decision.iteration === 'number' ? `iter ${decision.iteration}` : null,
        typeof decision.nextIteration === 'number' ? `next ${decision.nextIteration}` : null,
        typeof decision.nextTaskCount === 'number' ? `tasks ${decision.nextTaskCount}` : null,
      ]
        .filter(Boolean)
        .join(' | ')
    : '';
  const decisionReason = decision?.reason;
  const decisionTone =
    decision?.decision === 'abort'
      ? 'text-red-700'
      : decision?.decision === 'iterate'
        ? 'text-blue-700'
        : decision?.decision === 'accept'
          ? 'text-green-700'
          : 'text-gray-700';

  return (
    <div className="mx-4 mt-2 rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-gray-700">Autonomy Summary</div>
        <div className={`text-[10px] px-2 py-0.5 rounded-full border ${streamStatusTone}`}>
          {streamStatusText}
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">iteration</div>
          <div className={`mt-0.5 text-xs font-medium ${iterationTone}`}>{iterationValue}</div>
          {iterationMeta && <div className="text-[11px] text-gray-600 mt-0.5">{iterationMeta}</div>}
          {iterationMessage && <div className="text-[11px] text-gray-500 truncate mt-0.5">{iterationMessage}</div>}
        </div>

        <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">budget</div>
          <div className={`mt-0.5 text-xs font-medium ${budgetTone}`}>{budgetValue}</div>
          {budgetMeta && <div className="text-[11px] text-gray-600 mt-0.5">{budgetMeta}</div>}
          {budgetMessage && <div className="text-[11px] text-gray-500 truncate mt-0.5">{budgetMessage}</div>}
        </div>

        <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">decision</div>
          <div className={`mt-0.5 text-xs font-medium ${decisionTone}`}>{decisionValue}</div>
          {decisionMeta && <div className="text-[11px] text-gray-600 mt-0.5">{decisionMeta}</div>}
          {decisionReason && <div className="text-[11px] text-gray-500 truncate mt-0.5">{decisionReason}</div>}
        </div>
      </div>
    </div>
  );
};

const SidebarComponent: React.FC = () => {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { backendSessionId, setBackendSessionId, createSession } = useWorkflowContext();
  const { setFiles, setProjectType, reset: resetProjectStore, latestRenderStage } = useProjectStore();
  const storeFileCount = useProjectStore(state => state.files.length);
  const apiBaseUrl = normalizeApiBaseUrl(import.meta.env['VITE_API_URL'] || 'http://localhost:3001');
  const latestBackendSessionIdRef = useRef<string | null>(backendSessionId);
  const lastPollingRequestRef = useRef<{ key: string; at: number } | null>(null);

  const { startPolling, stopPolling, reset: resetProjectFiles } = useProjectFiles({
    maxRetries: 180,
    onFilesLoaded: async loadedFiles => {
      logger.info('[Sidebar] Files loaded from storage:', { count: loadedFiles.length });

      const projectFiles = loadedFiles.map(file => ({
        path: file.path,
        content: file.content,
      }));

      setFiles(projectFiles);

      try {
        const firstFile = loadedFiles[0];
        if (firstFile) {
          const encodedSessionId = encodeURIComponent(firstFile.sessionID);
          const sessionResponse = await fetch(`${apiBaseUrl}/api/sessions/${encodedSessionId}`, {
            headers: withApiAuthHeaders(),
          });
          if (sessionResponse.ok) {
            const session = await sessionResponse.json();
            if (session.projectType) {
              logger.info('[Sidebar] Setting projectType from session:', { projectType: session.projectType });
              setProjectType(session.projectType);
            }
          }
        }
      } catch (err) {
        logger.error('[Sidebar] Failed to load session info:', { error: err });
      }
    },
    onError: err => {
      logger.error('[Sidebar] Failed to load files:', { error: err.message });
    },
  });

  const requestPolling = useCallback((sessionId: string, trigger: string) => {
    const pollingKey = `${sessionId}:${trigger}`;
    const now = Date.now();
    const lastRequest = lastPollingRequestRef.current;

    if (
      lastRequest &&
      lastRequest.key === pollingKey &&
      now - lastRequest.at < POLLING_REQUEST_DEBOUNCE_MS
    ) {
      console.log('[Sidebar] Skip duplicated polling request:', { pollingKey });
      return;
    }

    lastPollingRequestRef.current = { key: pollingKey, at: now };
    startPolling(sessionId);
  }, [startPolling]);

  const {
    messages,
    isStreaming,
    currentContent,
    currentRuntimeEvents,
    currentToolCalls,
    currentAutonomy,
    streamMessage,
    stopStreaming,
    clearMessages,
  } = useWorkflowChat({
    onError: err => {
      logger.error('Workflow error:', { error: err.message });
      setError(err.message || 'Request failed, please try again.');
      setTimeout(() => setError(null), 3000);
    },
    onToolResult: result => {
      logger.info('Tool result received:', { toolName: result.toolName, callID: result.callID });

      const template = readProjectTemplate(result.metadata);
      if (result.toolName === 'project_scaffold' && template) {
        logger.info('[Sidebar] Setting projectType from project_scaffold metadata:', { template });
        setProjectType(template);
      }
    },
    onComplete: data => {
      console.log('[Sidebar] onComplete callback triggered:', data);

      const resolvedSessionId = data.sessionId || latestBackendSessionIdRef.current;

      if (data.sessionId && data.sessionId !== latestBackendSessionIdRef.current) {
        console.log('[Sidebar] Updating backend session ID:', data.sessionId);
        latestBackendSessionIdRef.current = data.sessionId;
        setBackendSessionId(data.sessionId);
      }

      if (resolvedSessionId) {
        console.log('[Sidebar] Starting file polling:', {
          filesCount: data.filesCount,
          sessionId: resolvedSessionId,
        });
        requestPolling(resolvedSessionId, `complete:${data.filesCount ?? 0}`);
      } else {
        console.warn('[Sidebar] Cannot start polling - missing sessionId:', {
          hasFilesCount: !!data.filesCount,
          hasSessionId: !!data.sessionId,
          filesCount: data.filesCount,
          sessionId: data.sessionId,
          backendSessionId: latestBackendSessionIdRef.current,
        });
      }
    },
  });

  useEffect(() => {
    latestBackendSessionIdRef.current = backendSessionId;

    if (!backendSessionId) {
      lastPollingRequestRef.current = null;
    }
  }, [backendSessionId]);

  useEffect(() => {
    if (!backendSessionId || storeFileCount > 0 || isStreaming) {
      return;
    }
    requestPolling(backendSessionId, `${backendSessionId}:session-ready`);
  }, [backendSessionId, isStreaming, requestPolling, storeFileCount]);

  const isRunConsoleStreaming =
    isStreaming && (currentToolCalls.length > 0 || currentRuntimeEvents.length > 0);
  const wasInterrupted = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (!message) {
        continue;
      }
      if (message.role === 'assistant') {
        return Boolean(message.interrupted);
      }
    }
    return false;
  })();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentContent]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();

    if (userMessage.length > MAX_CHARS) {
      setError(
        `Input too long: max ${MAX_CHARS.toLocaleString()} chars (current ${userMessage.length.toLocaleString()})`
      );
      setTimeout(() => setError(null), 5000);
      return;
    }

    const messageKey = `message:${userMessage.slice(0, 100)}`;

    try {
      await messageDeduplicator.dedupe(
        messageKey,
        async () => {
          setInput('');
          return streamMessage(userMessage);
        },
        { throttle: true }
      );
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.toLowerCase().includes('too many') || err.message.includes('too frequent'))
      ) {
        setError(err.message);
        setTimeout(() => setError(null), 2000);
      } else {
        const fallbackMessage = 'Send failed, please try again later.';
        const errorMessage = err instanceof Error && err.message ? err.message : fallbackMessage;
        logger.error('[Sidebar] Failed to send message', {
          error: errorMessage,
          isStreaming,
          messageLength: userMessage.length,
        });
        setError(errorMessage);
        setTimeout(() => setError(null), 5000);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStopStreaming = () => {
    stopStreaming();
    stopPolling();
    lastPollingRequestRef.current = null;
  };

  const handleNewChat = () => {
    console.log('[Sidebar] handleNewChat: reset all state');

    if (isStreaming) {
      stopStreaming();
    }

    clearMessages();
    setInput('');
    setError(null);
    messageDeduplicator.clear();

    stopPolling();
    resetProjectFiles();
    resetProjectStore();

    lastPollingRequestRef.current = null;
    latestBackendSessionIdRef.current = null;
    setBackendSessionId(null);
    createSession();
  };

  return (
    <div className="w-[400px] flex flex-col h-full bg-white flex-shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <button
          onClick={handleNewChat}
          className="flex items-center text-sm text-gray-600 hover:text-gray-900 font-medium"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to start
        </button>
        <button
          onClick={handleNewChat}
          className="text-sm text-gray-600 hover:text-gray-900 font-medium"
        >
          New chat
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">Error</p>
            <p className="text-sm text-red-700 mt-0.5">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <RenderStageBadge
        stage={latestRenderStage?.stage}
        status={latestRenderStage?.status}
        message={latestRenderStage?.message}
        durationMs={latestRenderStage?.durationMs}
        groupId={latestRenderStage?.groupId}
        parentId={latestRenderStage?.parentId}
        sequence={latestRenderStage?.sequence}
      />
      <AutonomyBadge
        state={currentAutonomy}
        isStreaming={isStreaming}
        isRunConsoleStreaming={isRunConsoleStreaming}
        wasInterrupted={wasInterrupted}
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(message => (
          <MessageItem key={message.id} message={message} isStreaming={false} />
        ))}

        {isStreaming && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-4">
            {/* Thinking / Content Card */}
            <div className="w-full bg-white border border-blue-100 rounded-3xl shadow-sm overflow-hidden ring-1 ring-blue-50/50">
              <div className="px-5 py-3 border-b border-blue-50 bg-blue-50/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                  <span className="text-[10px] font-bold text-blue-700 uppercase tracking-tight">AI Thinking...</span>
                </div>
              </div>
              
              <div className="p-5">
                {currentContent ? (
                  <div className="text-sm prose prose-sm max-w-none prose-slate">
                    <ErrorBoundary>
                      <MarkdownRenderer content={currentContent} />
                    </ErrorBoundary>
                    <span className="inline-block w-1.5 h-4 ml-1 bg-blue-600 animate-pulse align-middle rounded-full" />
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-4 bg-blue-600 animate-pulse rounded-full" />
                    <span className="text-xs text-gray-400 italic">Formulating plan...</span>
                  </div>
                )}
              </div>
            </div>

            {/* LIVE TOOL ACTIONS: Rendered as independent bubbles during streaming */}
            {(currentToolCalls.length > 0 || currentRuntimeEvents.length > 0) && (
              <div className="animate-in slide-in-from-top-2 duration-300">
                <RunConsole events={currentRuntimeEvents} toolCalls={currentToolCalls} />
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-100">
        <div className="bg-gray-50 rounded-2xl p-3 border border-gray-200 focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
          <textarea
            ref={textareaRef}
            placeholder="Type your request..."
            className="w-full bg-transparent border-none resize-none focus:ring-0 text-sm text-gray-700 placeholder-gray-400 min-h-[40px] max-h-[120px]"
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          <div className="flex items-center justify-between mt-2">
            <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-md transition-colors">
              <Wand2 className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2">
              <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-md transition-colors">
                <Mic className="w-4 h-4" />
              </button>
              <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-md transition-colors">
                <PlusCircle className="w-4 h-4" />
              </button>
              {isStreaming ? (
                <button
                  onClick={handleStopStreaming}
                  className="p-1.5 bg-red-100 text-red-600 rounded-md hover:bg-red-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className={`p-1.5 rounded-md transition-colors ${
                    input.trim()
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="text-center mt-2">
          <div
            className={`text-xs transition-colors ${
              input.length > MAX_CHARS
                ? 'text-red-500 font-medium'
                : input.length > WARNING_THRESHOLD
                  ? 'text-yellow-600'
                  : 'text-gray-400'
            }`}
          >
            {input.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} chars
            {input.length > WARNING_THRESHOLD && input.length <= MAX_CHARS && (
              <span className="ml-1">approaching limit</span>
            )}
            {input.length > MAX_CHARS && <span className="ml-1 font-medium">exceeded limit</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

export const Sidebar = React.memo(SidebarComponent);

Sidebar.displayName = 'Sidebar';
