import { afterEach, describe, expect, it } from 'vitest';
import { RenderEngine } from './RenderEngine';

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
});

