/**
 * File Storage - persistent storage for generated project files.
 * Uses SQLite to store files by session.
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { normalizeWorkspaceRelativePath } from '../security/path-safety';
import type {
  StoredFile,
  CreateFileOptions,
  FileBatchResponse,
  FileStorageStats,
  FileQueryParams,
  ParsedFile,
  FileParseResult,
} from '@ai-frontend/shared-types';

/**
 * Get a shared database instance.
 * Note: SessionStorage must be initialized before use.
 */
function getDatabase(): Database.Database {
  // Access internal db instance through a private getter
  // Since SessionStorage doesn't export db, we'll use the same pattern
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'ai-frontend-master.db');
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');

  return db;
}

export const ALLOWED_FILE_SORT_FIELDS = ['createdAt', 'path', 'size', 'language'] as const;
export type AllowedFileSortField = (typeof ALLOWED_FILE_SORT_FIELDS)[number];
const FILE_SORT_FIELD_SET = new Set<string>(ALLOWED_FILE_SORT_FIELDS);

export const ALLOWED_FILE_SORT_ORDERS = ['asc', 'desc'] as const;
export type AllowedFileSortOrder = (typeof ALLOWED_FILE_SORT_ORDERS)[number];
const FILE_SORT_ORDER_SET = new Set<string>(ALLOWED_FILE_SORT_ORDERS);

export function isAllowedFileSortField(value: unknown): value is AllowedFileSortField {
  return typeof value === 'string' && FILE_SORT_FIELD_SET.has(value);
}

export function isAllowedFileSortOrder(value: unknown): value is AllowedFileSortOrder {
  return typeof value === 'string' && FILE_SORT_ORDER_SET.has(value.toLowerCase());
}

export class InvalidFileQueryParamsError extends Error {
  readonly code = 'INVALID_FILE_QUERY_PARAMS';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidFileQueryParamsError';
  }
}

/**
 * File Storage namespace
 */
export namespace FileStorage {
  /**
   * Database instance (shared with SessionStorage)
   */
  let db: Database.Database | null = null;

  /**
   * Prepared statements cache
   */
  const preparedStatements = new Map<string, Database.Statement>();

  /**
   * Query limits
   */
  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 500;

  function resolveOrderClause(params: FileQueryParams): string {
    const defaultSortField: AllowedFileSortField = 'createdAt';
    const defaultSortOrder: AllowedFileSortOrder = 'asc';

    if (params.sortBy !== undefined && !isAllowedFileSortField(params.sortBy)) {
      throw new InvalidFileQueryParamsError(
        `Invalid sortBy "${params.sortBy}". Allowed values: ${ALLOWED_FILE_SORT_FIELDS.join(', ')}`
      );
    }

    if (params.sortOrder !== undefined && !isAllowedFileSortOrder(params.sortOrder)) {
      throw new InvalidFileQueryParamsError(
        `Invalid sortOrder "${params.sortOrder}". Allowed values: ${ALLOWED_FILE_SORT_ORDERS.join(', ')}`
      );
    }

    const sortField = params.sortBy ?? defaultSortField;
    const sortOrder = (params.sortOrder ?? defaultSortOrder).toUpperCase();

    return `${sortField} ${sortOrder}`;
  }

  /**
   * Initialize file storage (create tables)
   */
  export function initialize(database?: Database.Database): void {
    db = database || getDatabase();

    // Create files table
    db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        sessionID TEXT NOT NULL,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        language TEXT NOT NULL,
        size INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (sessionID) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_files_session ON files(sessionID);
      CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
      CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
      CREATE INDEX IF NOT EXISTS idx_files_created ON files(createdAt);
    `);

    console.log('[FileStorage] Initialized file storage');
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
   * Get or create prepared statement
   */
  function prepare(query: string): Database.Statement {
    if (!preparedStatements.has(query)) {
      const stmt = ensureDb().prepare(query);
      preparedStatements.set(query, stmt);
    }
    return preparedStatements.get(query)!;
  }

  /**
   * Parse files from a tool output payload.
   * Supports Markdown code block format.
   */
  export function parseFilesFromToolResult(output: string): FileParseResult {
    if (!output) {
      return {
        files: [],
        count: 0,
        success: true,
      };
    }

    const files: ParsedFile[] = [];
    const codeBlockRegex = /```(\w+)(?:\s+([^\s\n]+))?\n([\s\S]*?)\n```/g;

    let match;
    let fileIndex = 0;

    try {
      while ((match = codeBlockRegex.exec(output)) !== null) {
        const language = match[1];
        const providedPath = match[2];
        const content = match[3].trim();

        // Use provided path, or generate a default path.
        const rawPath = providedPath || `unknown.${language}`;
        let safePath: string;
        try {
          safePath = normalizeWorkspaceRelativePath(rawPath);
        } catch (error) {
          console.warn('[FileStorage] Skip invalid parsed file path:', {
            rawPath,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        files.push({
          path: safePath,
          content,
          language,
        });

        fileIndex++;
      }

      return {
        files,
        count: files.length,
        success: true,
      };
    } catch (error) {
      return {
        files: [],
        count: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Save files in batch.
   */
  export function saveFiles(
    sessionID: string,
    files: ParsedFile[]
  ): { saved: number; errors: string[] } {
    const database = ensureDb();
    const now = Date.now();
    const normalizedFiles = files.map(file => ({
      ...file,
      path: normalizeWorkspaceRelativePath(file.path),
    }));

    // Use transaction for better performance
    const insertMany = database.transaction((files: ParsedFile[]) => {
      for (const file of files) {
        const id = uuidv4();
        const size = Buffer.byteLength(file.content, 'utf8');

        database
          .prepare(
            `INSERT INTO files (id, sessionID, path, content, language, size, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, sessionID, file.path, file.content, file.language, size, now);
      }
    });

    try {
      insertMany(normalizedFiles);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[FileStorage] Failed to save files for session ${sessionID}:`, error);
      throw new Error(`Failed to save files for session ${sessionID}: ${errorMsg}`);
    }

    console.log(`[FileStorage] Saved ${normalizedFiles.length}/${normalizedFiles.length} files for session ${sessionID}`);

    return { saved: normalizedFiles.length, errors: [] };
  }

  /**
   * Get session files with pagination.
   */
  export function getFiles(
    sessionID: string,
    params: FileQueryParams = {}
  ): FileBatchResponse {
    const database = ensureDb();

    const page = params.page || 1;
    const limit = Math.min(params.limit || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (page - 1) * limit;

    // Build WHERE clause
    const conditions: string[] = ['sessionID = ?'];
    const values: any[] = [sessionID];

    if (params.search) {
      conditions.push('path LIKE ?');
      values.push(`%${params.search}%`);
    }

    if (params.language) {
      conditions.push('language = ?');
      values.push(params.language);
    }

    const whereClause = conditions.join(' AND ');

    // Build ORDER BY clause
    const orderClause = resolveOrderClause(params);

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM files WHERE ${whereClause}`;
    const countResult = database.prepare(countQuery).get(...values) as { total: number };
    const total = countResult.total;

    // Get files
    const filesQuery = `
      SELECT * FROM files
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ? OFFSET ?
    `;
    const rows = database.prepare(filesQuery).all(...values, limit, offset) as any[];

    const files: StoredFile[] = rows.map(row => ({
      id: row.id,
      sessionID: row.sessionID,
      path: row.path,
      content: row.content,
      language: row.language,
      size: row.size,
      createdAt: row.createdAt,
    }));

    const totalPages = Math.ceil(total / limit);

    return {
      sessionID,
      files,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get all files for one session (without pagination), used for export.
   */
  export function getAllFiles(sessionID: string): StoredFile[] {
    const database = ensureDb();
    const rows = database
      .prepare('SELECT * FROM files WHERE sessionID = ? ORDER BY path ASC')
      .all(sessionID) as any[];

    return rows.map(row => ({
      id: row.id,
      sessionID: row.sessionID,
      path: row.path,
      content: row.content,
      language: row.language,
      size: row.size,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Get file storage statistics for a session.
   */
  export function getStats(sessionID: string): FileStorageStats | null {
    const database = ensureDb();

    const files = getAllFiles(sessionID);

    if (files.length === 0) {
      return null;
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const filesByLanguage: Record<string, number> = {};

    for (const file of files) {
      filesByLanguage[file.language] = (filesByLanguage[file.language] || 0) + 1;
    }

    const createdAtTimes = files.map(f => f.createdAt).sort((a, b) => a - b);

    return {
      sessionID,
      fileCount: files.length,
      totalSize,
      filesByLanguage,
      oldestFileCreatedAt: createdAtTimes[0],
      newestFileCreatedAt: createdAtTimes[createdAtTimes.length - 1],
    };
  }

  /**
   * Delete all files in a session.
   */
  export function deleteFiles(sessionID: string): number {
    const database = ensureDb();
    const result = database.prepare('DELETE FROM files WHERE sessionID = ?').run(sessionID);
    console.log(`[FileStorage] Deleted ${result.changes} files for session ${sessionID}`);
    return result.changes;
  }

  /**
   * Get one file by session and path.
   */
  export function getFile(sessionID: string, path: string): StoredFile | null {
    const database = ensureDb();
    const row = database
      .prepare('SELECT * FROM files WHERE sessionID = ? AND path = ?')
      .get(sessionID, path) as any;

    if (!row) return null;

    return {
      id: row.id,
      sessionID: row.sessionID,
      path: row.path,
      content: row.content,
      language: row.language,
      size: row.size,
      createdAt: row.createdAt,
    };
  }

  /**
   * Close database connection.
   */
  export function close(): void {
    preparedStatements.clear();
    db = null;
    console.log('[FileStorage] File storage closed');
  }
}

