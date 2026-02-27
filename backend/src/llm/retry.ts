/**
 * RetryEngine - 指数退避重试引擎
 *
 * 对可重试的 LLM 错误（429, 5xx）执行指数退避 + 随机抖动重试。
 * 全部重试失败时抛出包含最后一次错误详情的 LLMError。
 *
 * 需求: R8.1, R8.2, R8.3, R8.5
 */

import type { LLMError } from './types.js';

// ============================================================================
// Config
// ============================================================================

export interface RetryConfig {
  /** 最大重试次数（默认 3） */
  maxRetries: number;
  /** 基础延迟毫秒数（默认 2000） */
  baseDelayMs: number;
  /** 最大随机抖动毫秒数（默认 500） */
  maxJitterMs: number;
  /** 可重试的 HTTP 状态码 */
  retryableStatuses: number[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxJitterMs: 500,
  retryableStatuses: [429, 500, 502, 503, 504],
};

// ============================================================================
// RetryEngine
// ============================================================================

export class RetryEngine {
  private config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * 执行带重试的异步操作。
   *
   * 首次调用 + 最多 maxRetries 次重试。
   * 仅对 isRetryable 判定为可重试的错误进行重试。
   * 支持通过 AbortSignal 取消。
   */
  async execute<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    abortSignal?: AbortSignal,
  ): Promise<T> {
    const internalController = new AbortController();

    // 如果外部 signal 已取消，立即中止
    if (abortSignal?.aborted) {
      throw abortSignal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    // 监听外部取消
    const onAbort = () => internalController.abort(abortSignal!.reason);
    abortSignal?.addEventListener('abort', onAbort, { once: true });

    let lastError: unknown;

    try {
      for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
        // 检查是否已取消
        if (abortSignal?.aborted) {
          throw abortSignal.reason ?? new DOMException('Aborted', 'AbortError');
        }

        try {
          return await fn(internalController.signal);
        } catch (error: unknown) {
          lastError = error;

          // 如果是取消错误，直接抛出不重试
          if (this.isAbortError(error)) {
            throw error;
          }

          // 如果不可重试或已用完重试次数，跳出循环
          if (!this.isRetryable(error) || attempt >= this.config.maxRetries) {
            break;
          }

          // 指数退避等待
          const delay = this.calculateDelay(attempt);
          await this.sleep(delay, abortSignal);
        }
      }
    } finally {
      abortSignal?.removeEventListener('abort', onAbort);
    }

    // 全部重试失败，抛出 LLMError
    throw this.wrapAsLLMError(lastError);
  }

  /**
   * 计算第 attempt 次重试的延迟：baseDelayMs * 2^attempt + random(0, maxJitterMs)
   */
  calculateDelay(attempt: number): number {
    const exponential = this.config.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * this.config.maxJitterMs;
    return exponential + jitter;
  }

  /**
   * 判断错误是否可重试：检查 HTTP 状态码是否在 retryableStatuses 中
   */
  isRetryable(error: unknown): boolean {
    if (error == null || typeof error !== 'object') {
      return false;
    }

    // 检查 statusCode 属性（LLMError 格式）
    const statusCode = (error as Record<string, unknown>).statusCode;
    if (typeof statusCode === 'number') {
      return this.config.retryableStatuses.includes(statusCode);
    }

    // 检查 status 属性（fetch Response 错误等）
    const status = (error as Record<string, unknown>).status;
    if (typeof status === 'number') {
      return this.config.retryableStatuses.includes(status);
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private isAbortError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true;
    }
    if (error != null && typeof error === 'object' && 'name' in error) {
      return (error as { name: string }).name === 'AbortError';
    }
    return false;
  }

  private wrapAsLLMError(error: unknown): LLMError {
    // 如果已经是 LLMError 格式，直接返回
    if (this.isLLMError(error)) {
      return error;
    }

    const llmError = new Error(
      error instanceof Error ? error.message : 'LLM request failed after retries',
    ) as LLMError;

    llmError.provider = 'openai'; // 默认值，实际使用时由上层覆盖
    llmError.statusCode =
      (error as any)?.statusCode ?? (error as any)?.status ?? 0;
    llmError.retryable = false;
    llmError.raw = error;

    return llmError;
  }

  private isLLMError(error: unknown): error is LLMError {
    return (
      error instanceof Error &&
      'provider' in error &&
      'statusCode' in error &&
      'retryable' in error
    );
  }

  private sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (abortSignal?.aborted) {
        reject(abortSignal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }

      const timer = setTimeout(resolve, ms);

      const onAbort = () => {
        clearTimeout(timer);
        reject(abortSignal!.reason ?? new DOMException('Aborted', 'AbortError'));
      };

      abortSignal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
