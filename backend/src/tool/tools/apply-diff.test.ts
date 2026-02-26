import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplyDiffTool } from './apply-diff';
import { FileStorage } from '../../storage/file-storage';

describe('apply_diff tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies a unique SEARCH/REPLACE block in strict mode', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f1',
        sessionID: 's1',
        path: 'src/App.tsx',
        content: 'const title = "Old";\nexport default function App(){\n  return <h1>{title}</h1>;\n}\n',
        language: 'typescript',
        size: 1,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await ApplyDiffTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/App.tsx',
        patch: `<<<<<<< SEARCH
const title = "Old";
=======
const title = "New";
>>>>>>> REPLACE`,
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

    expect(result.output).toContain('Applied 1 SEARCH/REPLACE block(s)');
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const savedContent = saveSpy.mock.calls[0]?.[1]?.[0]?.content || '';
    expect(savedContent).toContain('const title = "New";');
  });

  it('rejects ambiguous matches', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f2',
        sessionID: 's2',
        path: 'src/utils.ts',
        content: 'const value = 1;\nconst value = 1;\n',
        language: 'typescript',
        size: 1,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await ApplyDiffTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/utils.ts',
        patch: `<<<<<<< SEARCH
const value = 1;
=======
const value = 2;
>>>>>>> REPLACE`,
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

    expect(result.output).toContain('AMBIGUOUS_MATCH');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('supports normalized whitespace matching when strict matching fails', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f3',
        sessionID: 's3',
        path: 'src/demo.ts',
        content: 'function demo() {\n    return 1;\n}\n',
        language: 'typescript',
        size: 1,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await ApplyDiffTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/demo.ts',
        normalizeWhitespace: true,
        patch: `<<<<<<< SEARCH
function demo() {
  return 1;
}
=======
function demo() {
  return 2;
}
>>>>>>> REPLACE`,
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

    expect(result.output).toContain('Whitespace-normalized matching used');
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const savedContent = saveSpy.mock.calls[0]?.[1]?.[0]?.content || '';
    expect(savedContent).toContain('return 2;');
  });

  it('returns nearby line-number snippets when normalized matching cannot find SEARCH block', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f4',
        sessionID: 's4',
        path: 'src/no-match.ts',
        content: 'export const value = 1;\nfunction demo() {\n  return value;\n}\n',
        language: 'typescript',
        size: 1,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await ApplyDiffTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/no-match.ts',
        patch: `<<<<<<< SEARCH
const missing = true;
=======
const missing = false;
>>>>>>> REPLACE`,
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

    expect(result.output).toContain('NO_MATCH_NORMALIZED');
    expect(result.output).toContain('[DIAGNOSTICS]');
    expect(result.output).toContain('lines ');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('blocks apply_diff on reserved backend-like paths', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f5',
        sessionID: 's5',
        path: 'package.json',
        content: '{}',
        language: 'json',
        size: 1,
        createdAt: Date.now(),
      },
      {
        id: 'f6',
        sessionID: 's5',
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

    const tool = await ApplyDiffTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/orchestration/contract-policy.ts',
        patch: `<<<<<<< SEARCH
export const locked = false;
=======
export const locked = true;
>>>>>>> REPLACE`,
      },
      {
        sessionID: 's5',
        messageID: 'm5',
        agent: 'frontend-implementer',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    );

    expect(result.output).toContain('RUNTIME_ARTIFACT_PATH_BLOCKED');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('falls back to full-file replacement for fenced full-content patch', async () => {
    vi.spyOn(FileStorage, 'getAllFiles').mockReturnValue([
      {
        id: 'f7',
        sessionID: 's6',
        path: 'src/App.tsx',
        content: 'export default function App(){ return <div>old</div>; }\n',
        language: 'typescript',
        size: 1,
        createdAt: Date.now(),
      },
    ]);
    const saveSpy = vi.spyOn(FileStorage, 'saveFiles').mockReturnValue({
      saved: 1,
      errors: [],
    });

    const tool = await ApplyDiffTool.init();
    const result = await tool.execute(
      {
        filePath: 'src/App.tsx',
        patch: `\`\`\`tsx
import React from 'react';

export default function App() {
  return (
    <main style={{ padding: 24 }}>
      <header>Takeout Admin</header>
      <section>dashboard-ready replacement content</section>
    </main>
  );
}
\`\`\``,
      },
      {
        sessionID: 's6',
        messageID: 'm6',
        agent: 'frontend-implementer',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: async () => undefined,
      }
    );

    expect(result.output).toContain('Full-file fallback replacement was applied');
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const savedContent = saveSpy.mock.calls[0]?.[1]?.[0]?.content || '';
    expect(savedContent).toContain('Takeout Admin');
    expect(savedContent).toContain('dashboard-ready replacement content');
  });
});
