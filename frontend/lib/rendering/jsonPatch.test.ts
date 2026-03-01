import { describe, expect, it } from 'vitest';
import type { JsonPatchOperation } from '@ai-frontend/shared-types';
import { applyJsonPatch, JsonPatchApplyError } from './jsonPatch';

describe('applyJsonPatch safety guards', () => {
  it('applies safe patches without mutating the original input', () => {
    const input = {
      user: {
        name: 'alice',
      },
    };

    const operations: JsonPatchOperation[] = [
      {
        op: 'replace',
        path: '/user/name',
        value: 'bob',
      },
    ];

    const next = applyJsonPatch(input, operations);

    expect(next.user.name).toBe('bob');
    expect(input.user.name).toBe('alice');
  });

  it('rejects __proto__ pointer tokens to prevent prototype pollution', () => {
    const operations: JsonPatchOperation[] = [
      {
        op: 'add',
        path: '/__proto__/polluted',
        value: true,
      },
    ];

    expect(() => applyJsonPatch({}, operations)).toThrow(JsonPatchApplyError);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects constructor/prototype token chains', () => {
    const operations: JsonPatchOperation[] = [
      {
        op: 'add',
        path: '/safe/constructor/prototype/hacked',
        value: 'x',
      },
    ];

    expect(() => applyJsonPatch({ safe: {} }, operations)).toThrow(JsonPatchApplyError);
    expect(({} as { hacked?: string }).hacked).toBeUndefined();
  });
});
