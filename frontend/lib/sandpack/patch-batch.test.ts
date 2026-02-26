import { describe, expect, it } from 'vitest';
import { applyPatchBatchEnvelope } from './patch-batch';

describe('patch-batch', () => {
  it('applies ast_replace_v2 patch batch and updates revision', () => {
    const result = applyPatchBatchEnvelope(
      {
        'src/App.tsx': [
          'export default function App() {',
          '  return <main><h1>old</h1></main>;',
          '}',
        ].join('\n'),
      },
      {
        runId: 'run-1',
        patchId: 'patch-1',
        revision: 1,
        dependsOnRevision: 0,
        atomicGroupId: 'group-1',
        touchedFiles: ['src/App.tsx'],
        patches: [
          {
            kind: 'ast_replace_v2',
            filePath: 'src/App.tsx',
            selector: {
              type: 'ReturnStatement',
              contains: '<h1>old</h1>',
            },
            replacement: 'return <main><h1>new</h1></main>;',
          },
        ],
      },
      { expectedRevision: 0 }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(1);
    expect(result.value.files['src/App.tsx']).toContain('new');
  });

  it('detects package.json dependency changes and requests hard reload', () => {
    const previousPackage = JSON.stringify({
      dependencies: { react: '^18.3.1' },
    });
    const nextPackage = JSON.stringify({
      dependencies: { react: '^18.3.1', zustand: '^4.5.0' },
    });

    const result = applyPatchBatchEnvelope(
      {
        'package.json': previousPackage,
        'src/App.tsx': 'export default function App(){ return <div />; }',
      },
      {
        runId: 'run-2',
        patchId: 'patch-2',
        revision: 2,
        dependsOnRevision: 1,
        atomicGroupId: 'group-2',
        touchedFiles: ['package.json'],
        validationHints: {
          requiresDependencyReload: true,
        },
        patches: [
          {
            kind: 'ast_replace_v2',
            filePath: 'package.json',
            selector: {
              type: 'Program',
              contains: '"react"',
            },
            replacement: nextPackage,
          },
        ],
      },
      { expectedRevision: 1, previousDependencySignature: 'prev' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dependencyReloadRequired).toBe(true);
    expect(result.value.dependencyMap).toMatchObject({
      react: '^18.3.1',
      zustand: '^4.5.0',
    });
    expect(result.dependencySignature).toBeTruthy();
  });

  it('rejects revision mismatch early', () => {
    const result = applyPatchBatchEnvelope(
      { 'src/App.tsx': 'export default function App() { return null; }' },
      {
        runId: 'run-3',
        patchId: 'patch-3',
        revision: 3,
        dependsOnRevision: 1,
        atomicGroupId: 'group-3',
        touchedFiles: ['src/App.tsx'],
        patches: [],
      },
      { expectedRevision: 2 }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOW_CONFIDENCE');
  });

  it('rolls back entire batch on partial failure', () => {
    const result = applyPatchBatchEnvelope(
      {
        'src/App.tsx': [
          'export default function App() {',
          '  const count = 1;',
          '  return <div>{count}</div>;',
          '}',
        ].join('\n'),
      },
      {
        runId: 'run-4',
        patchId: 'patch-4',
        revision: 4,
        dependsOnRevision: 0,
        atomicGroupId: 'group-4',
        touchedFiles: ['src/App.tsx'],
        patches: [
          {
            kind: 'ast_replace_v2',
            filePath: 'src/App.tsx',
            selector: {
              type: 'VariableDeclaration',
              contains: 'count = 1',
            },
            replacement: 'const count = 2;',
          },
          {
            kind: 'ast_replace_v2',
            filePath: 'src/App.tsx',
            selector: {
              type: 'ReturnStatement',
              contains: 'missing_snippet',
            },
            replacement: 'return <div>broken</div>;',
          },
        ],
      },
      { expectedRevision: 0 }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PATCH_BATCH_ROLLED_BACK');
    expect(result.error.causeCode).toBe('AST_SELECTOR_NOT_FOUND');
  });
});
