/**
 * Session Manager - High-level Session Management
 * Ported from OpenCode with modifications for ai-frontend-master
 *
 * Provides convenient API for session lifecycle management
 */

import { SessionStorage } from './storage';
import { ModeRouter } from '../prompt/router';
import { Agent } from '../agent/agent';
import { config } from '../config';
import type { SessionInfo, Message, CreateSessionParams } from '@ai-frontend/shared-types';

/**
 * Session Manager namespace
 */
export namespace SessionManager {
  /**
   * Create a new session with automatic mode detection
   *
   * @param input - Session creation parameters
   * @returns Created session
   */
  export async function create(input: CreateSessionParams = {}): Promise<SessionInfo> {
    let mode: 'creator' | 'implementer' = 'creator';
    let agentId = input.agentId || 'frontend-creator';

    // Detect mode based on user message if provided
    if (input.userMessage) {
      const detected = ModeRouter.detectAgent({
        userQuery: input.userMessage,
        hasPRD: false,
        hasTechStack: false,
        hasFigma: false,
        hasDetailedRequirements: false,
        hasBusinessContext: false,
      });

      if (detected.mode === 'implementer') {
        mode = 'implementer';
        agentId = input.agentId || 'frontend-implementer';
      }

      console.log(
        `[SessionManager] Detected mode: ${mode} (confidence: ${detected.confidence}%, version=${detected.version || ModeRouter.version})`
      );
    }

    // Create session
    const session = SessionStorage.createSession({
      title: input.title || 'New Session',
      ownerId: input.ownerId,
      mode,
      agentId,
      modelProvider: input.modelProvider ?? config.ai.defaultProvider,
      modelId: input.modelId ?? config.ai.defaultModel,
    });

    // Add initial user message if provided
    if (input.userMessage) {
      SessionStorage.addMessage({
        sessionID: session.id,
        role: 'user',
        content: input.userMessage,
      });
    }

    return session;
  }

  /**
   * Get a session by ID
   *
   * @param id - Session ID
   * @returns Session or undefined
   */
  export function get(id: string): SessionInfo | undefined {
    return SessionStorage.getSession(id);
  }

  /**
   * Get messages for a session
   *
   * @param sessionID - Session ID
   * @returns Array of messages
   */
  export function getMessages(sessionID: string): Message[] {
    return SessionStorage.getMessages(sessionID);
  }

  /**
   * Update a message
   *
   * @param id - Message ID
   * @param updates - Updates
   */
  export function updateMessage(
    id: string,
    updates: Partial<Omit<Message, 'id' | 'createdAt'>>
  ): void {
    SessionStorage.updateMessage(id, updates);
  }

  /**
   * Update a tool result in a message
   *
   * @param sessionID - Session ID
   * @param callID - Tool call ID
   * @param output - Tool output
   */
  export function updateToolResult(sessionID: string, callID: string, output: string): void {
    const messages = getMessages(sessionID);

    // Find message with the tool call
    const message = messages.find(m =>
      m.parts?.some(p => p.type === 'tool-call' && p.callID === callID)
    );

    if (!message || !message.parts) return;

    // Update the part
    const newParts = message.parts.map(p => {
      if (p.type === 'tool-call' && p.callID === callID) {
        return {
          ...p,
          state: 'completed' as const,
          output,
        };
      }
      return p;
    });

    // Save update
    updateMessage(message.id, { parts: newParts });
  }

  /**
   * Add a user message
   *
   * @param sessionID - Session ID
   * @param content - Message content
   * @returns Created message
   */
  export function addUserMessage(sessionID: string, content: string): Message {
    return SessionStorage.addMessage({
      sessionID,
      role: 'user',
      content,
    });
  }

  /**
   * Add an assistant message
   *
   * @param sessionID - Session ID
   * @param content - Message content
   * @param parts - Optional message parts
   * @returns Created message
   */
  export function addAssistantMessage(sessionID: string, content: string, parts?: any[]): Message {
    return SessionStorage.addMessage({
      sessionID,
      role: 'assistant',
      content,
      parts,
    });
  }

  /**
   * Update session title
   *
   * @param sessionID - Session ID
   * @param title - New title
   */
  export function updateTitle(sessionID: string, title: string): void {
    SessionStorage.updateSession(sessionID, { title });
  }

  /**
   * Update session
   *
   * @param sessionID - Session ID
   * @param updates - Updates
   */
  export function update(sessionID: string, updates: Partial<Omit<SessionInfo, 'id' | 'createdAt'>>): void {
    SessionStorage.updateSession(sessionID, updates);
  }

  /**
   * List all sessions
   *
   * @param limit - Optional limit
   * @returns Array of sessions
   */
  export function listAll(limit?: number, ownerId?: string): SessionInfo[] {
    return SessionStorage.listSessions(limit, ownerId);
  }

  /**
   * Delete a session
   *
   * @param sessionID - Session ID
   */
  export function deleteSession(sessionID: string): void {
    SessionStorage.deleteSession(sessionID);
  }

  /**
   * Get session statistics
   *
   * @param sessionID - Session ID
   * @returns Statistics or null
   */
  export function getStats(sessionID: string) {
    return SessionStorage.getSessionStats(sessionID);
  }
}
