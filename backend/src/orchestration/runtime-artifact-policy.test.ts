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

  it('blocks backend and reserved source segments', () => {
    const existingFiles = [createStoredFile('package.json'), createStoredFile('src/App.tsx')];
    const backendPath = evaluateRuntimeArtifactPath('backend/src/server.ts', existingFiles);
    expect(backendPath.allowed).toBe(false);
    expect(backendPath.reason).toContain('RUNTIME_ARTIFACT_PATH_BLOCKED');

    const frontendPath = evaluateRuntimeArtifactPath('frontend/src/App.tsx', existingFiles);
    expect(frontendPath.allowed).toBe(true);
    expect(frontendPath.normalizedPath).toBe('src/App.tsx');

    const reservedSrcPath = evaluateRuntimeArtifactPath('src/orchestration/contract-policy.ts', existingFiles);
    expect(reservedSrcPath.allowed).toBe(false);
    expect(reservedSrcPath.reason).toContain('RUNTIME_ARTIFACT_PATH_BLOCKED');
  });

  it('keeps allowed frontend paths and filters blocked files', () => {
    const existingFiles = [createStoredFile('package.json'), createStoredFile('src/App.tsx')];
    const result = filterRuntimeArtifactFiles(
      [
        { path: 'src/main.tsx', content: 'ok-root-file' },
        { path: 'src/ui/AppShell.tsx', content: 'ok-ui-file' },
        { path: 'src/components/OrderList.tsx', content: 'ok' },
        { path: 'src/orchestration/contract-policy.ts', content: 'blocked' },
      ],
      existingFiles
    );

    expect(result.accepted).toHaveLength(3);
    expect(result.accepted[0]?.path).toBe('src/main.tsx');
    expect(result.accepted[1]?.path).toBe('src/ui/AppShell.tsx');
    expect(result.accepted[2]?.path).toBe('src/components/OrderList.tsx');
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]?.path).toBe('src/orchestration/contract-policy.ts');
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

  it('blocks standalone html path when bootstrapping an empty session', () => {
    const blocked = evaluateRuntimeArtifactPath('web-delivery-admin.html', []);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('RUNTIME_ARTIFACT_PATH_BLOCKED');

    const allowedIndex = evaluateRuntimeArtifactPath('index.html', []);
    expect(allowedIndex.allowed).toBe(true);
    expect(allowedIndex.normalizedPath).toBe('index.html');

    const allowedApp = evaluateRuntimeArtifactPath('src/App.tsx', []);
    expect(allowedApp.allowed).toBe(true);
    expect(allowedApp.normalizedPath).toBe('src/App.tsx');
  });

  it('unwraps one synthetic root folder for bootstrap writes while preserving runtime scope guards', () => {
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

    const blockedBackendPath = evaluateRuntimeArtifactPath('web-prototype/backend/src/server.ts', []);
    expect(blockedBackendPath.allowed).toBe(false);
    expect(blockedBackendPath.reason).toContain('RUNTIME_ARTIFACT_PATH_BLOCKED');
  });
});
