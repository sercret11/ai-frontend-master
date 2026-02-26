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
    expect(rollback.snapshot.pendingPatches).toHaveLength(1);
    expect(rollback.snapshot.pendingPatches[0]?.id).toBe('patch-1');
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
});
