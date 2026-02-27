import { describe, expect, it } from 'vitest';
import { bindBackendSessionIdToLocalSession } from './WorkflowContext';

describe('WorkflowContext backend session binding', () => {
  it('updates only the bound local session entry', () => {
    const current = {
      'local-a': 'backend-a',
      'local-b': 'backend-b',
    };

    const next = bindBackendSessionIdToLocalSession(current, 'local-a', 'backend-new');

    expect(next).toEqual({
      'local-a': 'backend-new',
      'local-b': 'backend-b',
    });
  });

  it('removes only the target local session when backend id is null', () => {
    const current = {
      'local-a': 'backend-a',
      'local-b': 'backend-b',
    };

    const next = bindBackendSessionIdToLocalSession(current, 'local-b', null);

    expect(next).toEqual({
      'local-a': 'backend-a',
    });
  });
});
