import { describe, expect, it } from 'vitest';
import type { PatchIntent } from './types';
import { mergePatchIntents } from './patch-crdt';

function createIntent(
  id: string,
  filePath: string,
  agentId: PatchIntent['agentId'],
  createdAt: number,
  content: string
): PatchIntent {
  return {
    id,
    waveId: 'wave-3',
    taskId: `task-${id}`,
    agentId,
    filePath,
    content,
    contentHash: `${id}-hash`,
    createdAt,
  };
}

describe('patch-crdt', () => {
  it('merges independent file updates without conflict', () => {
    const result = mergePatchIntents('wave-3', [
      createIntent('a', 'src/App.tsx', 'page-agent', 1, 'app-v1'),
      createIntent('b', 'src/store.ts', 'state-agent', 2, 'store-v1'),
    ]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.merged).toHaveLength(2);
    expect(result.touchedFiles).toEqual(['src/App.tsx', 'src/store.ts']);
  });

  it('flags conflict when multiple agents update same file in one wave', () => {
    const result = mergePatchIntents('wave-3', [
      createIntent('a', 'src/App.tsx', 'page-agent', 1, 'app-v1'),
      createIntent('b', 'src/App.tsx', 'interaction-agent', 2, 'app-v2'),
      createIntent('c', 'src/App.tsx', 'state-agent', 3, 'app-v3'),
    ]);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.filePath).toBe('src/App.tsx');
    expect(result.merged[0]?.content).toBe('app-v3');
    expect(result.merged[0]?.sources.map(item => item.agentId)).toEqual([
      'page-agent',
      'interaction-agent',
      'state-agent',
    ]);
  });
});

