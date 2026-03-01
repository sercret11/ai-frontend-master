import { describe, expect, it } from 'vitest';
import type { StoredFile } from '@ai-frontend/shared-types';
import {
  evaluateRuntimeArtifactPath,
  filterRuntimeArtifactFiles,
  normalizeGeneratedArtifactPaths,
} from './runtime-artifact-policy';

function createStoredFile(path: string): StoredFile {
  return {
    id: `id-${path}`,
    sessionID: 'session-test',
    path,
    content: '',
    language: 'text',
    size: 0,
    createdAt: Date.now(),
  };
}

describe('runtime-artifact-policy', () => {
  it('strips synthetic common root when session already has root package', () => {
    const existingFiles = [createStoredFile('package.json'), createStoredFile('src/main.tsx')];
    const normalized = normalizeGeneratedArtifactPaths(
      [
        { path: 'generated-web-app/package.json' },
        { path: 'generated-web-app/src/App.tsx' },
      ],
      existingFiles
    );

    expect(normalized.map(file => file.path)).toEqual(['package.json', 'src/App.tsx']);
  });

  it('does not strip non-synthetic common roots such as src', () => {
    const existingFiles = [createStoredFile('package.json')];
    const normalized = normalizeGeneratedArtifactPaths(
      [
        { path: 'src/main.tsx' },
        { path: 'src/router.tsx' },
        { path: 'src/stores/authStore.ts' },
      ],
      existingFiles
    );

    expect(normalized.map(file => file.path)).toEqual([
      'src/main.tsx',
      'src/router.tsx',
      'src/stores/authStore.ts',
    ]);
  });

  it('keeps allowed frontend paths and filters only invalid workspace-relative files', () => {
    const existingFiles = [createStoredFile('package.json'), createStoredFile('src/App.tsx')];
    const result = filterRuntimeArtifactFiles(
      [
        { path: 'src/main.tsx', content: 'ok-root-file' },
        { path: 'src/ui/AppShell.tsx', content: 'ok-ui-file' },
        { path: 'src/components/OrderList.tsx', content: 'ok' },
        { path: '../outside.ts', content: 'blocked' },
      ],
      existingFiles
    );

    expect(result.accepted).toHaveLength(3);
    expect(result.accepted[0]?.path).toBe('src/main.tsx');
    expect(result.accepted[1]?.path).toBe('src/ui/AppShell.tsx');
    expect(result.accepted[2]?.path).toBe('src/components/OrderList.tsx');
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]?.path).toBe('../outside.ts');
  });

  it('allows emergent src segments that are outside reserved backend namespaces', () => {
    const existingFiles = [createStoredFile('package.json'), createStoredFile('src/App.tsx')];
    const existingSessionPath = evaluateRuntimeArtifactPath(
      'src/runtime/layout/RootShell.tsx',
      existingFiles
    );
    expect(existingSessionPath.allowed).toBe(true);
    expect(existingSessionPath.normalizedPath).toBe('src/runtime/layout/RootShell.tsx');

    const bootstrapPath = evaluateRuntimeArtifactPath('src/prototype/state/types.ts', []);
    expect(bootstrapPath.allowed).toBe(true);
    expect(bootstrapPath.normalizedPath).toBe('src/prototype/state/types.ts');
  });

  it('allows unknown frontend root files when bootstrapping an empty session', () => {
    const rootFile = evaluateRuntimeArtifactPath('web-delivery-admin.html', []);
    expect(rootFile.allowed).toBe(true);
    expect(rootFile.normalizedPath).toBe('web-delivery-admin.html');

    const allowedApp = evaluateRuntimeArtifactPath('src/App.tsx', []);
    expect(allowedApp.allowed).toBe(true);
    expect(allowedApp.normalizedPath).toBe('src/App.tsx');
  });

  it('unwraps one synthetic root folder for bootstrap writes', () => {
    const wrappedPackage = evaluateRuntimeArtifactPath('web-prototype/package.json', []);
    expect(wrappedPackage.allowed).toBe(true);
    expect(wrappedPackage.normalizedPath).toBe('package.json');

    const wrappedApp = evaluateRuntimeArtifactPath('web-prototype/src/App.tsx', []);
    expect(wrappedApp.allowed).toBe(true);
    expect(wrappedApp.normalizedPath).toBe('src/App.tsx');

    const wrappedResearchDoc = evaluateRuntimeArtifactPath(
      'web-prototype/docs/research/waimai-admin-framework-constraints.md',
      []
    );
    expect(wrappedResearchDoc.allowed).toBe(true);
    expect(wrappedResearchDoc.normalizedPath).toBe(
      'docs/research/waimai-admin-framework-constraints.md'
    );

    const wrappedResearch = evaluateRuntimeArtifactPath(
      'web-prototype/research/waimai-admin-framework-constraints.md',
      []
    );
    expect(wrappedResearch.allowed).toBe(true);
    expect(wrappedResearch.normalizedPath).toBe(
      'research/waimai-admin-framework-constraints.md'
    );
  });

  it('blocks invalid workspace-relative paths', () => {
    const traversal = evaluateRuntimeArtifactPath('../outside.ts', []);
    expect(traversal.allowed).toBe(false);
    expect(traversal.reason).toContain('RUNTIME_ARTIFACT_PATH_BLOCKED');

    const absoluteUnix = evaluateRuntimeArtifactPath('/absolute/path.ts', []);
    expect(absoluteUnix.allowed).toBe(false);
    expect(absoluteUnix.reason).toContain('RUNTIME_ARTIFACT_PATH_BLOCKED');

    const absoluteWindows = evaluateRuntimeArtifactPath('C:/absolute/path.ts', []);
    expect(absoluteWindows.allowed).toBe(false);
    expect(absoluteWindows.reason).toContain('RUNTIME_ARTIFACT_PATH_BLOCKED');
  });
});
