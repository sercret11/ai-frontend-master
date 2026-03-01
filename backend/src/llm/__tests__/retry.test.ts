/**
 * RetryEngine Unit Tests
 *
 * Tests exponential backoff delay calculation, retryable status code detection,
 * AbortSignal cancellation, and max-retries exhaustion.
 *
 * 需求: R8.1, R8.2, R8.3, R8.5
 */

import { describe, it, expect, vi } from 'vitest';
import { RetryEngine, DEFAULT_RETRY_CONFIG } from '../retry.js';
import type { LLMError } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an error with a statusCode property (LLMError-like). */
function makeError(statusCode: number, message = 'error'): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

// ---------------------------------------------------------------------------
// DEFAULT_RETRY_CONFIG
// ---------------------------------------------------------------------------

describe('DEFAULT_RETRY_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_RETRY_CONFIG).toEqual({
      maxRetries: 3,
      baseDelayMs: 2000,
      maxJitterMs: 500,
      retryableStatuses: [429, 500, 502, 503, 504],
    });
  });
});

// ---------------------------------------------------------------------------
// calculateDelay
// ---------------------------------------------------------------------------

describe('RetryEngine.calculateDelay', () => {
  it('produces exponentially increasing base values', () => {
    // Use 0 jitter so we can assert exact exponential values
    const engine = new RetryEngine({ baseDelayMs: 100, maxJitterMs: 0 });

    // Mock Math.random to return 0 (no jitter contribution)
    vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(engine.calculateDelay(0)).toBe(100);  // 100 * 2^0 = 100
    expect(engine.calculateDelay(1)).toBe(200);  // 100 * 2^1 = 200
    expect(engine.calculateDelay(2)).toBe(400);  // 100 * 2^2 = 400
    expect(engine.calculateDelay(3)).toBe(800);  // 100 * 2^3 = 800

    vi.restoreAllMocks();
  });

  it('adds jitter bounded by maxJitterMs', () => {
    const engine = new RetryEngine({ baseDelayMs: 100, maxJitterMs: 50 });

    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    // 100 * 2^0 + 0.5 * 50 = 100 + 25 = 125
    expect(engine.calculateDelay(0)).toBe(125);

    vi.restoreAllMocks();
  });

  it('delay is always >= baseDelayMs * 2^attempt (jitter is non-negative)', () => {
    const engine = new RetryEngine({ baseDelayMs: 10, maxJitterMs: 100 });

    for (let attempt = 0; attempt < 5; attempt++) {
      const delay = engine.calculateDelay(attempt);
      const minExpected = 10 * Math.pow(2, attempt);
      expect(delay).toBeGreaterThanOrEqual(minExpected);
    }
  });
});

// ---------------------------------------------------------------------------
// isRetryable
// ---------------------------------------------------------------------------

describe('RetryEngine.isRetryable', () => {
  const engine = new RetryEngine();

  it('returns true for retryable status codes (429, 500, 502, 503, 504)', () => {
    for (const code of [429, 500, 502, 503, 504]) {
      expect(engine.isRetryable(makeError(code))).toBe(true);
    }
  });

  it('returns false for non-retryable status codes (400, 401, 403, 404)', () => {
    for (const code of [400, 401, 403, 404]) {
      expect(engine.isRetryable(makeError(code))).toBe(false);
    }
  });

  it('returns false for null / undefined / non-object', () => {
    expect(engine.isRetryable(null)).toBe(false);
    expect(engine.isRetryable(undefined)).toBe(false);
    expect(engine.isRetryable('string')).toBe(false);
    expect(engine.isRetryable(42)).toBe(false);
  });

  it('checks "status" property as fallback', () => {
    const err = { status: 503 };
    expect(engine.isRetryable(err)).toBe(true);

    const err2 = { status: 404 };
    expect(engine.isRetryable(err2)).toBe(false);
  });

  it('returns false for errors without status code properties', () => {
    expect(engine.isRetryable(new Error('generic'))).toBe(false);
    expect(engine.isRetryable({})).toBe(false);
  });

  it('handles numeric network error code without throwing', () => {
    expect(() =>
      engine.isRetryable({
        name: 'AbortError',
        message: 'This operation was aborted',
        code: 20,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// execute – AbortSignal cancellation
// ---------------------------------------------------------------------------

describe('RetryEngine.execute – AbortSignal', () => {
  // Use tiny delays so tests run fast
  const engine = new RetryEngine({ baseDelayMs: 1, maxJitterMs: 0, maxRetries: 3 });

  it('throws immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('pre-aborted'));

    await expect(
      engine.execute(() => Promise.resolve('ok'), controller.signal),
    ).rejects.toThrow('pre-aborted');
  });

  it('aborts during retry sleep and stops retrying', async () => {
    // Use a longer delay so we can abort during sleep
    const slowEngine = new RetryEngine({ baseDelayMs: 5000, maxJitterMs: 0, maxRetries: 3 });
    const controller = new AbortController();
    let callCount = 0;

    const fn = async () => {
      callCount++;
      throw makeError(429);
    };

    // Abort after a short delay (while sleeping between retries)
    setTimeout(() => controller.abort(new DOMException('Cancelled', 'AbortError')), 50);

    await expect(
      slowEngine.execute(fn, controller.signal),
    ).rejects.toThrow();

    // Should have been called once (initial attempt), then aborted during sleep
    expect(callCount).toBe(1);
  });

  it('passes internal signal to fn and respects external abort', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const fn = async (signal: AbortSignal) => {
      receivedSignal = signal;
      return 'result';
    };

    const result = await engine.execute(fn, controller.signal);

    expect(result).toBe('result');
    expect(receivedSignal).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// execute – max retries exhausted
// ---------------------------------------------------------------------------

describe('RetryEngine.execute – max retries', () => {
  const engine = new RetryEngine({ baseDelayMs: 1, maxJitterMs: 0, maxRetries: 2 });

  it('retries up to maxRetries times then throws LLMError', async () => {
    let callCount = 0;

    const fn = async () => {
      callCount++;
      throw makeError(500, 'server error');
    };

    try {
      await engine.execute(fn);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      // 1 initial + 2 retries = 3 total calls
      expect(callCount).toBe(3);
      // Should be wrapped as LLMError
      expect(err.message).toBe('server error');
      expect(err.retryable).toBe(true);
      expect(err.statusCode).toBe(500);
    }
  });

  it('does not retry non-retryable errors', async () => {
    let callCount = 0;

    const fn = async () => {
      callCount++;
      throw makeError(401, 'unauthorized');
    };

    try {
      await engine.execute(fn);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      // Only 1 call – no retries for 401
      expect(callCount).toBe(1);
      expect(err.statusCode).toBe(401);
    }
  });

  it('returns result on success without retrying', async () => {
    const result = await engine.execute(async () => 'hello');
    expect(result).toBe('hello');
  });

  it('succeeds if fn recovers before maxRetries exhausted', async () => {
    let callCount = 0;

    const fn = async () => {
      callCount++;
      if (callCount < 3) throw makeError(503, 'temporary');
      return 'recovered';
    };

    const result = await engine.execute(fn);
    expect(result).toBe('recovered');
    expect(callCount).toBe(3);
  });

  it('wraps non-LLMError exceptions into LLMError format', async () => {
    const fn = async () => {
      throw makeError(502, 'bad gateway');
    };

    const engine3 = new RetryEngine({ baseDelayMs: 1, maxJitterMs: 0, maxRetries: 0 });

    try {
      await engine3.execute(fn);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.provider).toBeDefined();
      expect(typeof err.statusCode).toBe('number');
      expect(typeof err.retryable).toBe('boolean');
    }
  });
});
