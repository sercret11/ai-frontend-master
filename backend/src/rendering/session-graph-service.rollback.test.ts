import { describe, expect, it } from 'vitest';
import { AssemblySessionGraphService } from './session-graph-service';

describe('assembly session graph rollback', () => {
  it('rolls back to target revision and rebuilds graph from base', () => {
    const service = new AssemblySessionGraphService();

    service.beginAssemble('session-1', {
      runId: 'run-1',
      graph: {
        marker: 'base',
        stable: true,
      },
    });

    service.appendPatch(
      'session-1',
      {
        graph: {
          marker: 'rev-1',
          patchOne: true,
        },
      },
      'patch-1',
      'run-1'
    );

    service.appendPatch(
      'session-1',
      {
        graph: {
          marker: 'rev-2',
          patchTwo: true,
        },
      },
      'patch-2',
      'run-1'
    );

    const ackResult = service.ackPatch('session-1', 2, 'patch-2', 'run-1');
    expect(ackResult.ok).toBe(true);
    if (!ackResult.ok) {
      return;
    }
    expect(ackResult.snapshot.acknowledgedRevision).toBe(2);
    expect(ackResult.snapshot.pendingPatches).toHaveLength(0);

    const rollback = service.rollbackPatch('session-1', 1, 'run-1');
    expect(rollback.ok).toBe(true);
    if (!rollback.ok) {
      return;
    }

    expect(rollback.rolledBackFrom).toBe(2);
    expect(rollback.rolledBackTo).toBe(1);
    expect(rollback.removedPatchCount).toBe(1);
    expect(rollback.snapshot.revision).toBe(1);
    expect(rollback.snapshot.acknowledgedRevision).toBe(1);
    expect(rollback.snapshot.pendingPatches).toHaveLength(0);
    expect(rollback.snapshot.graph).toMatchObject({
      marker: 'rev-1',
      stable: true,
      patchOne: true,
    });
    expect((rollback.snapshot.graph as Record<string, unknown>)['patchTwo']).toBeUndefined();
  });

  it('returns run id mismatch on rollback with a different run', () => {
    const service = new AssemblySessionGraphService();
    service.beginAssemble('session-2', { runId: 'run-2' });

    const rollback = service.rollbackPatch('session-2', 0, 'run-x');
    expect(rollback.ok).toBe(false);
    if (rollback.ok) {
      return;
    }

    expect(rollback.reason).toBe('SESSION_NOT_FOUND');
  });

  it('acknowledges all patches up to acknowledged revision when patchId is provided', () => {
    const service = new AssemblySessionGraphService();
    service.beginAssemble('session-ack', { runId: 'run-ack' });

    service.appendPatch('session-ack', { graph: { marker: 'rev-1' } }, 'patch-1', 'run-ack');
    service.appendPatch('session-ack', { graph: { marker: 'rev-2' } }, 'patch-2', 'run-ack');
    service.appendPatch('session-ack', { graph: { marker: 'rev-3' } }, 'patch-3', 'run-ack');

    const ackResult = service.ackPatch('session-ack', 3, 'patch-3', 'run-ack');
    expect(ackResult.ok).toBe(true);
    if (!ackResult.ok) {
      return;
    }

    expect(ackResult.acknowledgedPatchId).toBe('patch-3');
    expect(ackResult.snapshot.acknowledgedRevision).toBe(3);
    expect(ackResult.snapshot.pendingPatches).toHaveLength(0);
  });

  it('returns no-op rollback when target revision equals current revision', () => {
    const service = new AssemblySessionGraphService();
    service.beginAssemble('session-3', { runId: 'run-3' });
    service.appendPatch(
      'session-3',
      {
        graph: {
          marker: 'rev-1',
        },
      },
      'patch-1',
      'run-3'
    );

    const rollback = service.rollbackPatch('session-3', 1, 'run-3');
    expect(rollback.ok).toBe(true);
    if (!rollback.ok) {
      return;
    }
    expect(rollback.removedPatchCount).toBe(0);
    expect(rollback.rolledBackFrom).toBe(1);
    expect(rollback.rolledBackTo).toBe(1);
  });

  it('rejects rollback to non-replayable revision after patch trimming', () => {
    const service = new AssemblySessionGraphService();
    service.beginAssemble('session-4', {
      runId: 'run-4',
      graph: {
        marker: 'base',
      },
    });

    for (let revision = 1; revision <= 205; revision += 1) {
      service.appendPatch(
        'session-4',
        {
          graph: {
            marker: `rev-${revision}`,
          },
        },
        `patch-${revision}`,
        'run-4'
      );
    }

    const nonReplayable = service.rollbackPatch('session-4', 4, 'run-4');
    expect(nonReplayable.ok).toBe(false);
    if (nonReplayable.ok) {
      return;
    }

    expect(nonReplayable.reason).toBe('REVISION_NOT_FOUND');
    expect(nonReplayable.message).toContain('out of replayable range');
    expect(nonReplayable.snapshot?.revision).toBe(205);

    const replayable = service.rollbackPatch('session-4', 5, 'run-4');
    expect(replayable.ok).toBe(true);
    if (!replayable.ok) {
      return;
    }

    expect(replayable.rolledBackFrom).toBe(205);
    expect(replayable.rolledBackTo).toBe(5);
    expect(replayable.snapshot.revision).toBe(5);
    expect(replayable.snapshot.graph).toMatchObject({
      marker: 'rev-5',
    });
  });
});
