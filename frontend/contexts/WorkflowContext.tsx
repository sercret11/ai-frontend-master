/**
 * WorkflowContext manages chat messages and session lifecycle state.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, ReactNode } from 'react';
import { StreamMessage } from '../hooks/useWorkflowChat';

/**
 * Session metadata without message payload.
 */
export interface SessionMetadata {
  id: string;
  title: string;
  mode?: 'creator' | 'implementer';
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/**
 * Session with in-memory messages.
 */
export interface Session extends SessionMetadata {
  messages: StreamMessage[];
}

interface WorkflowContextType {
  // Message state
  messages: StreamMessage[];
  setMessages: React.Dispatch<React.SetStateAction<StreamMessage[]>>;
  addMessage: (message: StreamMessage) => void;
  updateMessage: (id: string, updates: Partial<StreamMessage>) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;

  // Session state
  sessions: SessionMetadata[];
  currentSessionId: string | null;
  backendSessionId: string | null;
  bindBackendSessionId: (localSessionId: string, backendSessionId: string | null) => void;
  setBackendSessionId: (sessionId: string | null) => void;
  createSession: (title?: string) => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  updateSessionTitle: (id: string, title: string) => void;
  getCurrentSession: () => Session | null;

  // Persistence controls
  saveToStorage: () => void;
  loadFromStorage: () => void;
  clearStorage: () => void;
}

const WorkflowContext = createContext<WorkflowContextType | undefined>(undefined);

interface WorkflowProviderProps {
  children: ReactNode;
}

const STORAGE_KEY_SESSIONS = 'workflow_sessions';
const STORAGE_KEY_MESSAGES = 'workflow_messages';
const STORAGE_KEY_CURRENT = 'workflow_current_session';
const STORAGE_KEY_BACKEND_ID = 'workflow_backend_session'; // Legacy single-value key
const STORAGE_KEY_BACKEND_ID_MAP = 'workflow_backend_session_map';
const DEFAULT_SESSION_TITLE = 'Default Session';
const MESSAGE_KEY_PREFIX = `${STORAGE_KEY_MESSAGES}_`;

const getMessageStorageKey = (sessionId: string): string => `${MESSAGE_KEY_PREFIX}${sessionId}`;

const isSessionMetadata = (value: unknown): value is SessionMetadata => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SessionMetadata>;
  const modeValid =
    candidate.mode === undefined || candidate.mode === 'creator' || candidate.mode === 'implementer';

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    modeValid &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.updatedAt === 'number' &&
    typeof candidate.messageCount === 'number'
  );
};

const parseSessionsFromStorage = (rawValue: string | null): SessionMetadata[] => {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isSessionMetadata);
  } catch (error) {
    console.warn('Failed to parse stored sessions:', error);
    return [];
  }
};

const parseBackendSessionMap = (rawValue: string | null): Record<string, string> => {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const backendMap: Record<string, string> = {};
    for (const [sessionId, backendId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof sessionId === 'string' && typeof backendId === 'string' && backendId.length > 0) {
        backendMap[sessionId] = backendId;
      }
    }

    return backendMap;
  } catch (error) {
    console.warn('Failed to parse backend session map:', error);
    return {};
  }
};

export const bindBackendSessionIdToLocalSession = (
  bindings: Record<string, string>,
  localSessionId: string,
  backendSessionId: string | null
): Record<string, string> => {
  if (!localSessionId) {
    return bindings;
  }

  if (backendSessionId) {
    return { ...bindings, [localSessionId]: backendSessionId };
  }

  const { [localSessionId]: _removed, ...rest } = bindings;
  return rest;
};

const createSessionMetadata = (id: string, title: string, timestamp: number): SessionMetadata => ({
  id,
  title,
  createdAt: timestamp,
  updatedAt: timestamp,
  messageCount: 0,
});

export const WorkflowProvider: React.FC<WorkflowProviderProps> = ({ children }) => {
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionBackendIds, setSessionBackendIds] = useState<Record<string, string>>({});
  const [isInitialized, setIsInitialized] = useState(false);

  const backendSessionId = useMemo(() => {
    if (!currentSessionId) {
      return null;
    }
    return sessionBackendIds[currentSessionId] ?? null;
  }, [currentSessionId, sessionBackendIds]);

  const loadSessionMessages = useCallback((sessionId: string): StreamMessage[] => {
    const rawMessages = localStorage.getItem(getMessageStorageKey(sessionId));
    if (!rawMessages) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawMessages) as unknown;
      return Array.isArray(parsed) ? (parsed as StreamMessage[]) : [];
    } catch (error) {
      console.warn('Failed to parse stored messages:', error);
      return [];
    }
  }, []);

  const persistSessionMessages = useCallback((sessionId: string, sessionMessages: StreamMessage[]) => {
    localStorage.setItem(getMessageStorageKey(sessionId), JSON.stringify(sessionMessages));
  }, []);

  const createDefaultSessionState = useCallback(() => {
    const timestamp = Date.now();
    const defaultSessionId = `session-${timestamp}`;
    const defaultSession = createSessionMetadata(defaultSessionId, DEFAULT_SESSION_TITLE, timestamp);
    return {
      defaultSession,
      defaultSessionId,
    };
  }, []);

  const addMessage = useCallback(
    (message: StreamMessage) => {
      setMessages(prev => {
        const updated = [...prev, message];

        if (currentSessionId) {
          setSessions(prevSessions =>
            prevSessions.map(session =>
              session.id === currentSessionId
                ? { ...session, messageCount: updated.length, updatedAt: Date.now() }
                : session
            )
          );
        }

        return updated;
      });
    },
    [currentSessionId]
  );

  const updateMessage = useCallback((id: string, updates: Partial<StreamMessage>) => {
    setMessages(prev => prev.map(msg => (msg.id === id ? { ...msg, ...updates } : msg)));
  }, []);

  const removeMessage = useCallback(
    (id: string) => {
      setMessages(prev => {
        const updated = prev.filter(msg => msg.id !== id);

        if (currentSessionId) {
          setSessions(prevSessions =>
            prevSessions.map(session =>
              session.id === currentSessionId
                ? { ...session, messageCount: updated.length, updatedAt: Date.now() }
                : session
            )
          );
        }

        return updated;
      });
    },
    [currentSessionId]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);

    if (currentSessionId) {
      setSessions(prevSessions =>
        prevSessions.map(session =>
          session.id === currentSessionId ? { ...session, messageCount: 0, updatedAt: Date.now() } : session
        )
      );
    }
  }, [currentSessionId]);

  const createSession = useCallback(
    (title?: string) => {
      if (currentSessionId) {
        persistSessionMessages(currentSessionId, messages);
      }

      const timestamp = Date.now();
      const newSessionId = `session-${timestamp}`;

      setSessions(prev => [
        ...prev,
        createSessionMetadata(newSessionId, title ?? `New Session ${prev.length + 1}`, timestamp),
      ]);
      setCurrentSessionId(newSessionId);
      setMessages([]);

      return newSessionId;
    },
    [currentSessionId, messages, persistSessionMessages]
  );

  const switchSession = useCallback(
    (id: string) => {
      if (id === currentSessionId) {
        return;
      }

      if (!sessions.some(session => session.id === id)) {
        return;
      }

      if (currentSessionId) {
        persistSessionMessages(currentSessionId, messages);
      }

      setCurrentSessionId(id);
      setMessages(loadSessionMessages(id));
    },
    [currentSessionId, loadSessionMessages, messages, persistSessionMessages, sessions]
  );

  const deleteSession = useCallback(
    (id: string) => {
      if (!sessions.some(session => session.id === id)) {
        return;
      }

      setSessions(prev => prev.filter(session => session.id !== id));
      setSessionBackendIds(prev => {
        const { [id]: _deleted, ...rest } = prev;
        return rest;
      });
      localStorage.removeItem(getMessageStorageKey(id));

      if (id !== currentSessionId) {
        return;
      }

      const remaining = sessions.filter(session => session.id !== id);
      if (remaining.length === 0) {
        setCurrentSessionId(null);
        setMessages([]);
        return;
      }

      const nextSession = remaining[0];
      if (!nextSession) {
        setCurrentSessionId(null);
        setMessages([]);
        return;
      }

      const nextSessionId = nextSession.id;
      setCurrentSessionId(nextSessionId);
      setMessages(loadSessionMessages(nextSessionId));
    },
    [currentSessionId, loadSessionMessages, sessions]
  );

  const updateSessionTitle = useCallback((id: string, title: string) => {
    setSessions(prev =>
      prev.map(session => (session.id === id ? { ...session, title, updatedAt: Date.now() } : session))
    );
  }, []);

  const getCurrentSession = useCallback((): Session | null => {
    if (!currentSessionId) {
      return null;
    }

    const sessionMeta = sessions.find(session => session.id === currentSessionId);
    if (!sessionMeta) {
      return null;
    }

    return {
      ...sessionMeta,
      messages,
    };
  }, [currentSessionId, messages, sessions]);

  const bindBackendSessionId = useCallback(
    (localSessionId: string, nextBackendSessionId: string | null) => {
      setSessionBackendIds(prev =>
        bindBackendSessionIdToLocalSession(prev, localSessionId, nextBackendSessionId)
      );
    },
    []
  );

  const setBackendSessionId = useCallback(
    (nextBackendSessionId: string | null) => {
      if (!currentSessionId) {
        return;
      }

      bindBackendSessionId(currentSessionId, nextBackendSessionId);
    },
    [bindBackendSessionId, currentSessionId]
  );

  const saveToStorage = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));

      if (currentSessionId) {
        localStorage.setItem(STORAGE_KEY_CURRENT, currentSessionId);
        persistSessionMessages(currentSessionId, messages);
      } else {
        localStorage.removeItem(STORAGE_KEY_CURRENT);
      }

      localStorage.setItem(STORAGE_KEY_BACKEND_ID_MAP, JSON.stringify(sessionBackendIds));
      localStorage.removeItem(STORAGE_KEY_BACKEND_ID);
    } catch (error) {
      console.warn('Failed to save workflow context to storage:', error);
    }
  }, [currentSessionId, messages, persistSessionMessages, sessionBackendIds, sessions]);

  const loadFromStorage = useCallback(() => {
    try {
      const storedSessions = parseSessionsFromStorage(localStorage.getItem(STORAGE_KEY_SESSIONS));
      const storedCurrentSessionId = localStorage.getItem(STORAGE_KEY_CURRENT);
      const storedBackendIdMap = parseBackendSessionMap(localStorage.getItem(STORAGE_KEY_BACKEND_ID_MAP));
      const legacyBackendId = localStorage.getItem(STORAGE_KEY_BACKEND_ID);

      const nextSessions =
        storedSessions.length > 0
          ? storedSessions
          : (() => {
              const { defaultSession } = createDefaultSessionState();
              return [defaultSession];
            })();

      const hasValidCurrentSession =
        storedCurrentSessionId !== null &&
        nextSessions.some(session => session.id === storedCurrentSessionId);
      const firstSession = nextSessions[0];
      if (!firstSession) {
        throw new Error('No session found after loading storage');
      }
      const nextCurrentSessionId =
        hasValidCurrentSession && storedCurrentSessionId ? storedCurrentSessionId : firstSession.id;

      const validSessionIds = new Set(nextSessions.map(session => session.id));
      const nextSessionBackendIds: Record<string, string> = Object.fromEntries(
        Object.entries(storedBackendIdMap).filter(([sessionId]) => validSessionIds.has(sessionId))
      );

      if (legacyBackendId && !nextSessionBackendIds[nextCurrentSessionId]) {
        nextSessionBackendIds[nextCurrentSessionId] = legacyBackendId;
      }

      setSessions(nextSessions);
      setCurrentSessionId(nextCurrentSessionId);
      setMessages(loadSessionMessages(nextCurrentSessionId));
      setSessionBackendIds(nextSessionBackendIds);
    } catch (error) {
      console.warn('Failed to load workflow context from storage:', error);

      const { defaultSession, defaultSessionId } = createDefaultSessionState();
      setSessions([defaultSession]);
      setCurrentSessionId(defaultSessionId);
      setMessages([]);
      setSessionBackendIds({});
    }
  }, [createDefaultSessionState, loadSessionMessages]);

  const clearStorage = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY_SESSIONS);
    localStorage.removeItem(STORAGE_KEY_CURRENT);
    localStorage.removeItem(STORAGE_KEY_BACKEND_ID);
    localStorage.removeItem(STORAGE_KEY_BACKEND_ID_MAP);

    Object.keys(localStorage)
      .filter(key => key.startsWith(MESSAGE_KEY_PREFIX))
      .forEach(key => localStorage.removeItem(key));

    const { defaultSession, defaultSessionId } = createDefaultSessionState();
    setSessions([defaultSession]);
    setCurrentSessionId(defaultSessionId);
    setMessages([]);
    setSessionBackendIds({});
  }, [createDefaultSessionState]);

  useEffect(() => {
    if (!isInitialized) {
      loadFromStorage();
      setIsInitialized(true);
    }
  }, [isInitialized, loadFromStorage]);

  useEffect(() => {
    if (isInitialized) {
      saveToStorage();
    }
  }, [isInitialized, saveToStorage]);

  const value: WorkflowContextType = useMemo(
    () => ({
      messages,
      setMessages,
      addMessage,
      updateMessage,
      removeMessage,
      clearMessages,
      sessions,
      currentSessionId,
      backendSessionId,
      bindBackendSessionId,
      setBackendSessionId,
      createSession,
      switchSession,
      deleteSession,
      updateSessionTitle,
      getCurrentSession,
      saveToStorage,
      loadFromStorage,
      clearStorage,
    }),
    [
      messages,
      addMessage,
      updateMessage,
      removeMessage,
      clearMessages,
      sessions,
      currentSessionId,
      backendSessionId,
      bindBackendSessionId,
      setBackendSessionId,
      createSession,
      switchSession,
      deleteSession,
      updateSessionTitle,
      getCurrentSession,
      saveToStorage,
      loadFromStorage,
      clearStorage,
    ]
  );

  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
};

export function useWorkflowContext(): WorkflowContextType {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error('useWorkflowContext must be used within WorkflowProvider');
  }
  return context;
}

export default WorkflowContext;
