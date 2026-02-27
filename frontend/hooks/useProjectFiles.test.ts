import { describe, expect, it } from 'vitest';
import { pruneRecentPollingStarts, shouldDebouncePollingStart } from './useProjectFiles';

describe('useProjectFiles polling debounce isolation', () => {
  it('does not debounce across independent registries', () => {
    const signature = 'session-1:{}';
    const now = 1_000;

    const registryA = new Map<string, number>([[signature, now]]);
    const registryB = new Map<string, number>();

    expect(shouldDebouncePollingStart(registryA, signature, now + 100)).toBe(true);
    expect(shouldDebouncePollingStart(registryB, signature, now + 100)).toBe(false);
  });

  it('prunes stale registry entries outside debounce window', () => {
    const signature = 'session-1:{}';
    const now = 2_000;
    const registry = new Map<string, number>([[signature, now - 800]]);

    pruneRecentPollingStarts(registry, now, 500);

    expect(registry.has(signature)).toBe(false);
  });
});
