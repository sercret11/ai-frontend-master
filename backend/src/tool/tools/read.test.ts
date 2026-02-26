import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ReadTool } from './read';
import { FileStorage } from '../../storage/file-storage';

describe('read tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers session file storage when session file exists', async () => {
    vi.spyOn(FileStorage, 'getFile').mockReturnValue({
      id: 'f1',
      sessionID: 's1',
      path: 'src/App.tsx',
      content: 'export default function App() { return <div>ok</div>; }',
      language: 'typescript',
      size: 1,
      createdAt: Date.now(),
    });
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([]);

    const tool = await ReadTool.init();
    const result = await tool.execute(
      {
        filePath: 'missing-from-filesystem.tsx',
      },
      {
        sessionID: 's1',
        messageID: 'm1',
        agent: 'frontend-implementer',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    );

    expect(result.output).toContain('export default function App()');
    expect(result.metadata?.filePath).toBe('src/App.tsx');
  });

  it('falls back to filesystem when session file is missing', async () => {
    vi.spyOn(FileStorage, 'getFile').mockReturnValue(null);
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([]);

    const tmpFile = path.join(os.tmpdir(), `read-tool-test-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, 'line1\nline2', 'utf-8');

    const tool = await ReadTool.init();
    try {
      const result = await tool.execute(
        {
          filePath: tmpFile,
        },
        {
          sessionID: 's2',
          messageID: 'm2',
          agent: 'backend-agent',
          abort: new AbortController().signal,
          metadata: () => undefined,
          ask: async () => undefined,
        }
      );

      expect(result.output).toContain('line1');
      expect(result.metadata?.filePath).toContain('read-tool-test-');
    } finally {
      await fs.unlink(tmpFile).catch(() => undefined);
    }
  });

  it('requires write-first flow for frontend agent when session artifacts are empty', async () => {
    vi.spyOn(FileStorage, 'getFile').mockReturnValue(null);
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([]);

    const tool = await ReadTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/App.tsx',
      },
      {
        sessionID: 's-write-first',
        messageID: 'm-write-first',
        agent: 'frontend-creator',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    );

    expect(result.output).toContain('WRITE_FIRST_REQUIRED');
    expect(result.metadata?.error).toContain('WRITE_FIRST_REQUIRED');
  });

  it('returns session directory listing when reading project root path', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f-dir-1',
        sessionID: 's-root',
        path: 'package.json',
        content: '{\"name\":\"demo\"}',
        language: 'json',
        size: 10,
        createdAt: Date.now(),
      },
      {
        id: 'f-dir-2',
        sessionID: 's-root',
        path: 'src/App.tsx',
        content: 'export default function App() { return null; }',
        language: 'typescript',
        size: 20,
        createdAt: Date.now(),
      },
    ]);
    vi.spyOn(FileStorage, 'getFile').mockReturnValue(null);

    const tool = await ReadTool.init();
    const result = await tool.execute(
      {
        filePath: '.',
      },
      {
        sessionID: 's-root',
        messageID: 'm-root',
        agent: 'frontend-implementer',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    );

    expect(result.output).toContain('<files>');
    expect(result.output).toContain('package.json');
    expect(result.output).toContain('src/App.tsx');
    expect(result.metadata?.filePath).toBe('.');
  });

  it('limits excessive read calls in one iteration when session artifacts exist', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f2',
        sessionID: 's3',
        path: 'src/App.tsx',
        content: 'app',
        language: 'typescript',
        size: 3,
        createdAt: Date.now(),
      },
    ]);
    vi.spyOn(FileStorage, 'getFile').mockReturnValue({
      id: 'f2',
      sessionID: 's3',
      path: 'src/App.tsx',
      content: 'app',
      language: 'typescript',
      size: 3,
      createdAt: Date.now(),
    });

    const tool = await ReadTool.init();
    let lastResult: Awaited<ReturnType<typeof tool.execute>> | null = null;
    for (let i = 0; i < 25; i += 1) {
      lastResult = await tool.execute(
        {
          filePath: 'src/App.tsx',
        },
        {
          sessionID: 's3',
          messageID: 'm3',
          agent: 'frontend-implementer',
          abort: new AbortController().signal,
          metadata: () => undefined,
          ask: async () => undefined,
        }
      );
    }

    expect(lastResult?.output).toContain('READ_BUDGET_EXCEEDED');
  });

  it('limits excessive unique read targets in one iteration when session artifacts exist', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f3',
        sessionID: 's4',
        path: 'src/App.tsx',
        content: 'app',
        language: 'typescript',
        size: 3,
        createdAt: Date.now(),
      },
    ]);
    vi.spyOn(FileStorage, 'getFile').mockImplementation((_sessionID, filePath) => ({
      id: 'f3',
      sessionID: 's4',
      path: filePath,
      content: 'app',
      language: 'typescript',
      size: 3,
      createdAt: Date.now(),
    }));

    const tool = await ReadTool.init();
    let lastResult: Awaited<ReturnType<typeof tool.execute>> | null = null;
    for (let i = 0; i < 13; i += 1) {
      lastResult = await tool.execute(
        {
          filePath: `src/File-${i}.tsx`,
        },
        {
          sessionID: 's4',
          messageID: 'm4',
          agent: 'frontend-implementer',
          abort: new AbortController().signal,
          metadata: () => undefined,
          ask: async () => undefined,
        }
      );
    }

    expect(lastResult?.output).toContain('READ_BUDGET_EXCEEDED');
    expect(lastResult?.metadata?.error).toContain('unique paths');
  });
});
