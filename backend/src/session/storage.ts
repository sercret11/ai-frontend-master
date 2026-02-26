/**
 * Session Storage - Persistent Session Management with SQLite
 * Ported from OpenCode with modifications for ai-frontend-master
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import type { SessionInfo, Message, MessagePart } from '@ai-frontend/shared-types';

/**
 * Session Storage namespace
 */
export namespace SessionStorage {
  /**
   * Database instance
   */
  let db: Database.Database | null = null;

  /**
   * Prepared statements cache
   */
  const preparedStatements = new Map<string, Database.Statement>();

  /**
   * Checkpoint interval
   */
  let checkpointInterval: NodeJS.Timeout | undefined;

  /**
   * Query limits
   */
  const DEFAULT_LIMIT = 100;
  const MAX_LIMIT = 1000;

  function ensureSessionOwnerColumn(database: Database.Database): void {
    const columns = database.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
    const hasOwnerId = columns.some(column => column.name === 'ownerId');
    if (!hasOwnerId) {
      database.exec(`ALTER TABLE sessions ADD COLUMN ownerId TEXT;`);
      database.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(ownerId);`);
    }
  }

  /**
   * Initialize database and create tables
   */
  export function initialize(dbPath?: string): void {
    const dbFilePath =
      dbPath || process.env.DATABASE_PATH || path.join(process.cwd(), 'ai-frontend-master.db');
    db = new Database(dbFilePath);

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Optimize performance
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000'); // 64MB
    db.pragma('temp_store = MEMORY');

    // Start periodic checkpointing
    startCheckpointScheduler();

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        ownerId TEXT,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        agentId TEXT NOT NULL,
        modelProvider TEXT NOT NULL,
        modelId TEXT NOT NULL,
        projectType TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sessionID TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        parts TEXT,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (sessionID) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionID);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(createdAt);
    `);
    ensureSessionOwnerColumn(db);

    console.log(`[SessionStorage] Initialized database: ${dbFilePath}`);
  }

  /**
   * Get or create prepared statement
   */
  function prepare(query: string): Database.Statement {
    if (!preparedStatements.has(query)) {
      const stmt = db!.prepare(query);
      preparedStatements.set(query, stmt);
    }
    return preparedStatements.get(query)!;
  }

  /**
   * Start WAL checkpoint scheduler
   */
  function startCheckpointScheduler() {
    // Checkpoint every hour
    checkpointInterval = setInterval(
      () => {
        if (db) {
          try {
            db.pragma('wal_checkpoint(PASSIVE)');
          } catch (error) {
            console.error('[SessionStorage] WAL checkpoint failed:', error);
          }
        }
      },
      60 * 60 * 1000
    ); // 1 hour

    console.log('[SessionStorage] Checkpoint scheduler started');
  }

  /**
   * Ensure database is initialized
   */
  function ensureDb(): Database.Database {
    if (!db) {
      initialize();
    }
    return db!;
  }

  /**
   * Create a new session
   */
  export function createSession(
    input: Omit<SessionInfo, 'id' | 'createdAt' | 'updatedAt'>
  ): SessionInfo {
    const database = ensureDb();
    const id = uuidv4();
    const now = Date.now();

    const session: SessionInfo = {
      id,
      ...input,
      createdAt: now,
      updatedAt: now,
    };

    database
      .prepare(
        `INSERT INTO sessions (id, ownerId, title, mode, agentId, modelProvider, modelId, projectType, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.ownerId || null,
        session.title,
        session.mode,
        session.agentId,
        session.modelProvider,
        session.modelId,
        session.projectType || null,
        session.createdAt,
        session.updatedAt
      );

    return session;
  }

  /**
   * Get a session by ID
   */
  export function getSession(id: string): SessionInfo | undefined {
    const database = ensureDb();
    const row = database.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      ownerId: row.ownerId ?? undefined,
      title: row.title,
      mode: row.mode,
      agentId: row.agentId,
      modelProvider: row.modelProvider,
      modelId: row.modelId,
      projectType: row.projectType,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Update a session
   */
  export function updateSession(
    id: string,
    updates: Partial<Omit<SessionInfo, 'id' | 'createdAt'>>
  ): void {
    const database = ensureDb();
    const now = Date.now();

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.ownerId !== undefined) {
      fields.push('ownerId = ?');
      values.push(updates.ownerId);
    }
    if (updates.mode !== undefined) {
      fields.push('mode = ?');
      values.push(updates.mode);
    }
    if (updates.agentId !== undefined) {
      fields.push('agentId = ?');
      values.push(updates.agentId);
    }
    if (updates.modelProvider !== undefined) {
      fields.push('modelProvider = ?');
      values.push(updates.modelProvider);
    }
    if (updates.modelId !== undefined) {
      fields.push('modelId = ?');
      values.push(updates.modelId);
    }
    if (updates.projectType !== undefined) {
      fields.push('projectType = ?');
      values.push(updates.projectType);
    }

    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);

    database.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  /**
   * Delete a session
   */
  export function deleteSession(id: string): void {
    const database = ensureDb();
    database.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /**
   * List all sessions
   */
  export function listSessions(limit?: number, ownerId?: string): SessionInfo[] {
    const database = ensureDb();

    // Apply default and max limits
    const actualLimit = Math.min(limit || DEFAULT_LIMIT, MAX_LIMIT);

    const query = ownerId
      ? `SELECT * FROM sessions WHERE ownerId = ? ORDER BY updatedAt DESC LIMIT ?`
      : `SELECT * FROM sessions ORDER BY updatedAt DESC LIMIT ?`;
    const rows = ownerId
      ? (database.prepare(query).all(ownerId, actualLimit) as any[])
      : (database.prepare(query).all(actualLimit) as any[]);

    return rows.map(row => ({
      id: row.id,
      ownerId: row.ownerId ?? undefined,
      title: row.title,
      mode: row.mode,
      agentId: row.agentId,
      modelProvider: row.modelProvider,
      modelId: row.modelId,
      projectType: row.projectType,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Add a message to a session
   */
  export function addMessage(message: Omit<Message, 'id' | 'createdAt'>): Message {
    const database = ensureDb();
    const id = uuidv4();
    const now = Date.now();

    const msg: Message = {
      id,
      ...message,
      createdAt: now,
    };

    database
      .prepare(
        `INSERT INTO messages (id, sessionID, role, content, parts, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        msg.id,
        msg.sessionID,
        msg.role,
        msg.content,
        JSON.stringify(msg.parts || []),
        msg.createdAt
      );

    // Update session timestamp
    updateSession(msg.sessionID, {});

    return msg;
  }

  /**
   * Update a message
   */
  export function updateMessage(
    id: string,
    updates: Partial<Omit<Message, 'id' | 'createdAt'>>
  ): void {
    const database = ensureDb();

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.sessionID !== undefined) {
      fields.push('sessionID = ?');
      values.push(updates.sessionID);
    }
    if (updates.role !== undefined) {
      fields.push('role = ?');
      values.push(updates.role);
    }
    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.parts !== undefined) {
      fields.push('parts = ?');
      values.push(JSON.stringify(updates.parts));
    }

    if (fields.length === 0) return;

    values.push(id);

    database.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  /**
   * Get messages for a session
   */
  export function getMessages(sessionID: string): Message[] {
    const database = ensureDb();
    const rows = database
      .prepare('SELECT * FROM messages WHERE sessionID = ? ORDER BY createdAt ASC')
      .all(sessionID) as any[];

    return rows.map(row => ({
      id: row.id,
      sessionID: row.sessionID,
      role: row.role,
      content: row.content,
      parts: row.parts ? JSON.parse(row.parts) : undefined,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Delete messages for a session
   */
  export function deleteMessages(sessionID: string): void {
    const database = ensureDb();
    database.prepare('DELETE FROM messages WHERE sessionID = ?').run(sessionID);
  }

  /**
   * Get session statistics
   */
  export function getSessionStats(sessionID: string): {
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
  } | null {
    const database = ensureDb();
    const messages = getMessages(sessionID);

    if (messages.length === 0) return null;

    return {
      messageCount: messages.length,
      userMessageCount: messages.filter(m => m.role === 'user').length,
      assistantMessageCount: messages.filter(m => m.role === 'assistant').length,
    };
  }

  /**
   * Close database connection
   */
  export function close(): void {
    // Stop checkpoint interval
    if (checkpointInterval) {
      clearInterval(checkpointInterval);
    }

    // Clear prepared statements
    preparedStatements.clear();

    if (db) {
      // Final checkpoint before closing
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (error) {
        console.error('[SessionStorage] Final checkpoint failed:', error);
      }

      db.close();
      db = null;
    }

    console.log('[SessionStorage] Database closed');
  }
}
