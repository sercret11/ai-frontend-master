import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorage, InvalidFileQueryParamsError } from './file-storage';

describe('file storage sorting validation', () => {
  let db: Database.Database | null = null;
  const sessionID = 'test-session';

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        agentId TEXT NOT NULL,
        modelProvider TEXT NOT NULL,
        modelId TEXT NOT NULL,
        projectType TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);

    const now = Date.now();
    db.prepare(
      `INSERT INTO sessions (id, title, mode, agentId, modelProvider, modelId, projectType, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionID, 'test', 'creator', 'frontend-creator', 'openai', 'gpt-4o', 'react-vite', now, now);

    FileStorage.initialize(db);
    FileStorage.saveFiles(sessionID, [
      { path: 'src/main.tsx', content: 'export const main = true;', language: 'tsx' },
      { path: 'src/App.vue', content: '<template></template>', language: 'vue' },
    ]);
  });

  afterEach(() => {
    FileStorage.close();
    db?.close();
    db = null;
  });

  it('throws when sortBy is not in whitelist', () => {
    expect(() =>
      FileStorage.getFiles(sessionID, { sortBy: 'createdAt; DROP TABLE files; --' as any })
    ).toThrow(InvalidFileQueryParamsError);
  });

  it('throws when sortOrder is not in whitelist', () => {
    expect(() =>
      FileStorage.getFiles(sessionID, { sortBy: 'createdAt', sortOrder: 'desc; VACUUM;' as any })
    ).toThrow(InvalidFileQueryParamsError);
  });

  it('supports sorting by language safely', () => {
    const result = FileStorage.getFiles(sessionID, {
      sortBy: 'language',
      sortOrder: 'asc',
    });

    expect(result.files).toHaveLength(2);
    expect(result.files[0]?.language).toBe('tsx');
    expect(result.files[1]?.language).toBe('vue');
  });
});
