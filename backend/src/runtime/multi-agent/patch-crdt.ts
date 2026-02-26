import { createHash } from 'node:crypto';
import type {
  ConflictRecord,
  MergedPatch,
  MergedPatchBatch,
  PatchIntent,
} from './types';

function createMergedPatch(
  waveId: string,
  filePath: string,
  content: string,
  sources: PatchIntent[]
): MergedPatch {
  return {
    waveId,
    filePath,
    content,
    sources,
  };
}

function createConflict(waveId: string, filePath: string, intents: PatchIntent[]): ConflictRecord {
  const digest = createHash('sha1')
    .update(`${waveId}:${filePath}:${intents.map(item => item.id).join(',')}`)
    .digest('hex')
    .slice(0, 16);

  return {
    id: `conflict-${digest}`,
    waveId,
    filePath,
    intents,
    reason: 'multiple agents updated the same file in one wave',
    status: 'open',
  };
}

export function mergePatchIntents(waveId: string, intents: PatchIntent[]): MergedPatchBatch {
  const grouped = new Map<string, PatchIntent[]>();
  intents.forEach(intent => {
    const list = grouped.get(intent.filePath) || [];
    list.push(intent);
    grouped.set(intent.filePath, list);
  });

  const merged: MergedPatch[] = [];
  const conflicts: ConflictRecord[] = [];

  grouped.forEach((items, filePath) => {
    const ordered = [...items].sort((left, right) => left.createdAt - right.createdAt);
    if (ordered.length === 1) {
      const [only] = ordered;
      if (!only) return;
      merged.push(createMergedPatch(waveId, filePath, only.content, [only]));
      return;
    }

    const winner = ordered[ordered.length - 1];
    if (!winner) return;
    conflicts.push(createConflict(waveId, filePath, ordered));
    merged.push(createMergedPatch(waveId, filePath, winner.content, ordered));
  });

  return {
    id: `patch-batch-${waveId}`,
    waveId,
    merged,
    conflicts,
    touchedFiles: merged.map(item => item.filePath),
  };
}

