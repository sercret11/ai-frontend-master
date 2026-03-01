import { afterEach, describe, expect, it, vi } from 'vitest';
import { WriteTool } from './write';
import { FileStorage } from '../../storage/file-storage';
import { SessionStorage } from '../../session/storage';

describe('write tool policy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows overwrite by default for frontend-implementer agent', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f1',
        sessionID: 's1',
        path: 'src/App.tsx',
        content: 'old',
        language: 'typescript',
        size: 3,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await WriteTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/App.tsx',
        content: 'new',
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

    expect(result.output).toContain('File saved successfully');
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('allows overwrite when mode=allow_full_overwrite', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f2',
        sessionID: 's2',
        path: 'src/App.tsx',
        content: 'old',
        language: 'typescript',
        size: 3,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await WriteTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/App.tsx',
        content: 'new',
        mode: 'allow_full_overwrite',
      },
      {
        sessionID: 's2',
        messageID: 'm2',
        agent: 'frontend-implementer',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    );

    expect(result.output).toContain('File saved successfully');
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('allows overwrite for execution-capable agents even when mode=scaffold_only is passed', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f2x',
        sessionID: 's2x',
        path: 'src/App.tsx',
        content: 'old',
        language: 'typescript',
        size: 3,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await WriteTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/App.tsx',
        content: 'new',
        mode: 'scaffold_only',
      },
      {
        sessionID: 's2x',
        messageID: 'm2x',
        agent: 'frontend-implementer',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    );

    expect(result.output).toContain('File saved successfully');
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('allows overwrite by default for frontend-creator agent', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f2a',
        sessionID: 's2b',
        path: 'package.json',
        content: '{}',
        language: 'json',
        size: 2,
        createdAt: Date.now(),
      },
      {
        id: 'f2b',
        sessionID: 's2b',
        path: 'src/App.tsx',
        content: 'old',
        language: 'typescript',
        size: 3,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await WriteTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/App.tsx',
        content: 'new',
      },
      {
        sessionID: 's2b',
        messageID: 'm2b',
        agent: 'frontend-creator',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    );

    expect(result.output).toContain('File saved successfully');
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('allows overwrite by default for execution agents', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f2d',
        sessionID: 's2d',
        path: 'src/pages/DashboardPage.tsx',
        content: 'old',
        language: 'typescript',
        size: 3,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await WriteTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/pages/DashboardPage.tsx',
        content: 'new',
      },
      {
        sessionID: 's2d',
        messageID: 'm2d',
        agent: 'page-agent',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    );

    expect(result.output).toContain('File saved successfully');
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('allows overwrite by default for creator sessions even with non-frontend agent id', async () => {
    vi.spyOn(SessionStorage, 'getSession').mockReturnValue({
      id: 's2c',
      title: 'test',
      mode: 'creator',
      agentId: 'frontend-creator',
      modelProvider: 'openai',
      modelId: 'gpt-5.3-codex',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f2c',
        sessionID: 's2c',
        path: 'src/main.tsx',
        content: 'old',
        language: 'typescript',
        size: 3,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await WriteTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/main.tsx',
        content: 'new',
      },
      {
        sessionID: 's2c',
        messageID: 'm2c',
        agent: 'RepairAgent',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    );

    expect(result.output).toContain('File saved successfully');
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('blocks runtime writes to reserved backend-like source paths', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f3',
        sessionID: 's3',
        path: 'package.json',
        content: '{}',
        language: 'json',
        size: 2,
        createdAt: Date.now(),
      },
      {
        id: 'f4',
        sessionID: 's3',
        path: 'src/App.tsx',
        content: 'export default function App(){ return null; }',
        language: 'typescript',
        size: 1,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await WriteTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/orchestration/contract-policy.ts',
        content: 'export const blocked = true;',
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

    expect(result.output).toContain('RUNTIME_ARTIFACT_PATH_BLOCKED');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('blocks overwrite by default for non-frontend agents', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f5',
        sessionID: 's5',
        path: 'src/App.tsx',
        content: 'old',
        language: 'typescript',
        size: 3,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await WriteTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/App.tsx',
        content: 'new',
      },
      {
        sessionID: 's5',
        messageID: 'm5',
        agent: 'quality-checker',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    );

    expect(result.output).toContain('Overwrite blocked');
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
