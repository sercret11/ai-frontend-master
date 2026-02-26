/**
 * Request Deduplicator Utility
 *
 * Prevents duplicate requests and implements rate limiting
 */

export class RequestDeduplicator {
  private pendingRequests = new Map<string, Promise<any>>();
  private timestamps = new Map<string, number>();
  private readonly throttleMs: number;

  constructor(throttleMs = 1000) {
    this.throttleMs = throttleMs;
  }

  async dedupe<T>(
    key: string,
    fn: () => Promise<T>,
    options?: { debounce?: boolean; throttle?: boolean }
  ): Promise<T> {
    // Check if same request is already pending
    if (this.pendingRequests.has(key)) {
      console.log(`[RequestDeduplicator] Returning pending request: ${key}`);
      return this.pendingRequests.get(key)!;
    }

    // Throttle check
    if (options?.throttle) {
      const lastTime = this.timestamps.get(key) || 0;
      const now = Date.now();
      if (now - lastTime < this.throttleMs) {
        throw new Error('请求过于频繁，请稍后再试');
      }
    }

    // Create new request
    const promise = fn().finally(() => {
      this.pendingRequests.delete(key);
      this.timestamps.set(key, Date.now());
    });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  /**
   * Check if request is pending
   */
  isPending(key: string): boolean {
    return this.pendingRequests.has(key);
  }

  /**
   * Get number of pending requests
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Clear all deduplication state
   */
  clear() {
    this.pendingRequests.clear();
    this.timestamps.clear();
  }

  /**
   * Cancel specific pending request
   */
  cancel(key: string) {
    this.pendingRequests.delete(key);
    this.timestamps.delete(key);
  }
}

// Singleton instance for message deduplication
export const messageDeduplicator = new RequestDeduplicator(300);
