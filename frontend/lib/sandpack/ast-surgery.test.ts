import { describe, expect, it } from 'vitest';
import { applyAstReplacePatch, applyAstSurgery, parseSandpackErrorSignal } from './ast-surgery';

describe('ast-surgery', () => {
  it('parses file, line and snippet from Sandpack-like error text', () => {
    const signal = parseSandpackErrorSignal(
      `SyntaxError: /src/App.tsx:12:9\n> const broken = (\n|   <div>`
    );
    expect(signal).not.toBeNull();
    expect(signal?.filePath).toBe('/src/App.tsx');
    expect(signal?.line).toBe(12);
    expect(signal?.snippet).toContain('const broken');
  });

  it('amputates a matched statement and keeps syntax valid', () => {
    const files = {
      '/src/App.tsx': [
        'export default function App() {',
        '  const value = 1;',
        '  const removable = value + 1;',
        '  return <div>{value}</div>;',
        '}',
      ].join('\n'),
    };

    const outcome = applyAstSurgery(files, {
      filePath: '/src/App.tsx',
      line: 3,
      snippet: 'const removable = value + 1;',
      rawMessage: 'Compile failed',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.files['/src/App.tsx']).not.toContain('const removable = value + 1;');
    expect(['semantic-dual-check', 'lca-amputation']).toContain(outcome.report?.strategy);
  });

  it('rejects surgery when dual-check cannot locate a target', () => {
    const files = {
      '/src/App.tsx': [
        'export default function App() {',
        '  const value = 1;',
        '  return <div>{value}</div>;',
        '}',
      ].join('\n'),
    };

    const outcome = applyAstSurgery(files, {
      filePath: '/src/App.tsx',
      line: 80,
      snippet: 'totally_missing_snippet',
      rawMessage: 'Compile failed',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('dual-check');
  });

  it('applies ast_replace using semantic selector', () => {
    const files = {
      '/src/App.tsx': [
        'export default function App() {',
        '  return <main><h1>Old</h1></main>;',
        '}',
      ].join('\n'),
    };

    const outcome = applyAstReplacePatch(files, {
      kind: 'ast_replace_v2',
      filePath: '/src/App.tsx',
      selector: {
        type: 'ReturnStatement',
        contains: '<h1>Old</h1>',
      },
      replacement: 'return <main><h1>New</h1></main>;',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.files['/src/App.tsx']).toContain('<h1>New</h1>');
  });

  it('keeps utf-16 offsets correct for chinese and emoji spans', () => {
    const files = {
      '/src/App.tsx': [
        'export default function App() {',
        '  const greeting = "你好🙂";',
        '  return <div>{greeting}</div>;',
        '}',
      ].join('\n'),
    };

    const outcome = applyAstReplacePatch(files, {
      kind: 'ast_replace_v2',
      filePath: '/src/App.tsx',
      selector: {
        type: 'VariableDeclaration',
        contains: '你好🙂',
      },
      replacement: 'const greeting = "你好🙂世界";',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.files['/src/App.tsx']).toContain('const greeting = "你好🙂世界";');
    expect(outcome.files['/src/App.tsx']).toContain('return <div>{greeting}</div>;');
    expect(outcome.files['/src/App.tsx']).not.toContain('const greeting = "你好🙂";');
  });

  it('supports replacement wrapper fallback for pure jsx fragment', () => {
    const files = {
      '/src/App.tsx': [
        'export default function App() {',
        '  return <div>Old</div>;',
        '}',
      ].join('\n'),
    };

    const outcome = applyAstReplacePatch(files, {
      kind: 'ast_replace_v2',
      filePath: '/src/App.tsx',
      selector: {
        type: 'ReturnStatement',
      },
      replacement: '<section>Wrapped</section>',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.files['/src/App.tsx']).toContain('Wrapped');
  });

  it('rejects replacement fragment when parsing still fails after wrapper', () => {
    const files = {
      '/src/App.tsx': [
        'export default function App() {',
        '  return <div>Old</div>;',
        '}',
      ].join('\n'),
    };

    const outcome = applyAstReplacePatch(files, {
      kind: 'ast_replace_v2',
      filePath: '/src/App.tsx',
      selector: {
        type: 'ReturnStatement',
      },
      replacement: '<section',
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('AST_REPLACEMENT_INVALID');
  });

  it('rejects ast_replace when selector is empty', () => {
    const files = {
      '/src/App.tsx': [
        'export default function App() {',
        '  return <div>Old</div>;',
        '}',
      ].join('\n'),
    };

    const outcome = applyAstReplacePatch(files, {
      kind: 'ast_replace_v2',
      filePath: '/src/App.tsx',
      selector: {},
      replacement: 'return <section>New</section>;',
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('AST_SELECTOR_NOT_FOUND');
  });
});
