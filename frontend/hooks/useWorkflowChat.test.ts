import { describe, expect, it } from 'vitest';
import {
  isExpectedStreamAbortError,
  releaseStreamMessageLock,
  shouldReportStreamError,
  tryAcquireStreamMessageLock,
} from './useWorkflowChat';

describe('useWorkflowChat stream lock', () => {
  it('prevents reentry until lock is released', () => {
    const lockRef = { current: false };

    expect(tryAcquireStreamMessageLock(lockRef)).toBe(true);
    expect(tryAcquireStreamMessageLock(lockRef)).toBe(false);

    releaseStreamMessageLock(lockRef);

    expect(tryAcquireStreamMessageLock(lockRef)).toBe(true);
  });
});

describe('useWorkflowChat stream error classification', () => {
  it('treats AbortError as expected cancellation', () => {
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';

    expect(isExpectedStreamAbortError(abortError)).toBe(true);
    expect(shouldReportStreamError(abortError)).toBe(false);
  });

  it('treats AbortError-shaped objects as expected cancellation', () => {
    const abortLikeError = { name: 'AbortError' };

    expect(isExpectedStreamAbortError(abortLikeError)).toBe(true);
    expect(shouldReportStreamError(abortLikeError)).toBe(false);
  });

  it('keeps non-abort errors on the true error reporting path', () => {
    const networkError = new Error('HTTP error: 500');

    expect(isExpectedStreamAbortError(networkError)).toBe(false);
    expect(shouldReportStreamError(networkError)).toBe(true);
  });
});
