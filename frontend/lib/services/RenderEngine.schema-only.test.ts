import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderEngine } from './RenderEngine';
import { readExecutionMetadata } from '../rendering';
import type { RenderingExecutor } from '../rendering';
import type { RenderingRequest } from '@ai-frontend/shared-types';

const SAMPLE_FILES = [
  {
    path: 'src/App.tsx',
    content: 'export default function App() { return <div>Hello</div>; }',
  },
];

describe('RenderEngine schema-only routing', () => {
  let engine: RenderEngine | null = null;

  afterEach(async () => {
    if (engine) {
      await engine.disposeAll();
      engine = null;
    }
  });

  it('renders react-vite projects with schema renderer only', async () => {
    engine = new RenderEngine();

    const result = await engine.render(SAMPLE_FILES, 'react-vite');

    expect(result.success).toBe(true);
    expect(result.adapter).toBe('schema-renderer');
    expect(result.mode).toBe('schema');
    expect(typeof result.previewUrl).toBe('string');
  });

  it('keeps all supported project types on schema mode', async () => {
    engine = new RenderEngine();
    const projectTypes: Array<'next-js' | 'react-vite' | 'react-native' | 'uniapp'> = [
      'next-js',
      'react-vite',
      'react-native',
      'uniapp',
    ];

    for (const projectType of projectTypes) {
      const result = await engine.render(SAMPLE_FILES, projectType);
      expect(result.success).toBe(true);
      expect(result.adapter).toBe('schema-renderer');
      expect(result.mode).toBe('schema');
    }
  });

  it('normalizes render metadata files and prevents duplicate canonical paths on diff', async () => {
    engine = new RenderEngine();

    const result = await engine.render(
      [
        { path: '/src/App.tsx', content: 'v1' },
        { path: '.\\src\\App.tsx', content: 'v2' },
        { path: 'src/main.tsx', content: 'main' },
      ],
      'react-vite'
    );
    expect(result.success).toBe(true);

    const sessions = (engine as unknown as { sessions: Map<string, { request: RenderingRequest }> }).sessions;
    const initialSession = sessions.get('react-vite');
    expect(initialSession).toBeDefined();
    const initialMetadata = readExecutionMetadata(initialSession!.request);
    expect(initialMetadata?.files).toEqual([
      { path: 'src/App.tsx', content: 'v2' },
      { path: 'src/main.tsx', content: 'main' },
    ]);

    await engine.applyFileDiff('react-vite', '.\\src\\App.tsx', 'v3');

    const updatedSession = sessions.get('react-vite');
    expect(updatedSession).toBeDefined();
    const updatedMetadata = readExecutionMetadata(updatedSession!.request);
    expect(updatedMetadata?.files).toEqual([
      { path: 'src/App.tsx', content: 'v3' },
      { path: 'src/main.tsx', content: 'main' },
    ]);
  });

  it('falls back to full execute when applyFileDiff fails', async () => {
    engine = new RenderEngine();
    const result = await engine.render(SAMPLE_FILES, 'react-vite');
    expect(result.success).toBe(true);

    const applyFileDiff = vi.fn(async () => {
      throw new Error('simulated diff failure');
    });

    const execute = vi.fn(async (request: RenderingRequest) => ({
      success: true,
      mode: 'schema' as const,
      stack: 'schema' as const,
      graphVersion: request.graph.version,
      artifact: {
        kind: 'url' as const,
        payload: 'data:text/html;charset=utf-8,test',
      },
      durationMs: 1,
    }));

    const executor: RenderingExecutor = {
      descriptor: {
        id: 'test-fallback-executor',
        displayName: 'Test Fallback Executor',
        mode: 'schema',
        stack: 'schema',
        priority: 999,
        capabilities: ['schema-render', 'hot-patch'],
      },
      canExecute: () => true,
      execute,
      applyFileDiff,
    };

    const anyEngine = engine as unknown as {
      sessions: Map<string, { executorId: string; request: RenderingRequest }>;
      executors: Map<string, RenderingExecutor>;
    };
    const session = anyEngine.sessions.get('react-vite');
    expect(session).toBeDefined();
    if (!session) {
      return;
    }

    session.executorId = executor.descriptor.id;
    anyEngine.executors.set(executor.descriptor.id, executor);

    await expect(engine.applyFileDiff('react-vite', '.\\src\\App.tsx', 'updated')).resolves.toBeUndefined();

    expect(applyFileDiff).toHaveBeenCalledTimes(1);
    expect(applyFileDiff).toHaveBeenCalledWith('src/App.tsx', 'updated', expect.any(Object));
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
