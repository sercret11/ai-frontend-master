/**
 * 属性 P3：重试延迟单调递增
 *
 * 验证对于任意 attempt n，calculateDelay(n+1) >= calculateDelay(n)（不含抖动部分）。
 * 通过将 Math.random 固定为 0 来隔离指数退避的基础延迟，确保单调递增性质成立。
 *
 * **Validates: Requirements R8.1**
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { RetryEngine } from '../retry.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('P3: Retry delay monotonically increasing (without jitter)', () => {
  it('for any baseDelayMs > 0 and attempt n >= 0, baseDelay(n+1) >= baseDelay(n)', () => {
    // Remove jitter by mocking Math.random to always return 0
    vi.spyOn(Math, 'random').mockReturnValue(0);

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),  // baseDelayMs
        fc.integer({ min: 0, max: 20 }),       // attempt n
        (baseDelayMs, n) => {
          const engine = new RetryEngine({ baseDelayMs, maxJitterMs: 0 });

          const delayN = engine.calculateDelay(n);
          const delayN1 = engine.calculateDelay(n + 1);

          expect(delayN1).toBeGreaterThanOrEqual(delayN);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('for any config with jitter, the exponential base component is still monotonic', () => {
    // Fix jitter to a constant value so it cancels out in the comparison
    vi.spyOn(Math, 'random').mockReturnValue(0);

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),   // baseDelayMs
        fc.integer({ min: 0, max: 500 }),       // maxJitterMs
        fc.integer({ min: 0, max: 20 }),        // attempt n
        (baseDelayMs, maxJitterMs, n) => {
          const engine = new RetryEngine({ baseDelayMs, maxJitterMs });

          // With Math.random fixed to 0, jitter contribution is 0
          // so we're testing pure exponential: baseDelayMs * 2^n
          const delayN = engine.calculateDelay(n);
          const delayN1 = engine.calculateDelay(n + 1);

          expect(delayN1).toBeGreaterThanOrEqual(delayN);
        },
      ),
      { numRuns: 20 },
    );
  });
});
