/**
 * Network Manager Utility
 *
 * Monitors network status and manages offline request queue
 */

export interface NetworkStatus {
  isOnline: boolean;
  since?: Date;
}

export interface QueuedRequest {
  url: string;
  options: RequestInit;
  timestamp: Date;
  retryCount: number;
}

class NetworkManager {
  private status: NetworkStatus = { isOnline: navigator.onLine };
  private listeners: Set<(status: NetworkStatus) => void> = new Set();
  private offlineQueue: QueuedRequest[] = [];
  private maxQueueSize = 50;
  private retryDelay = 5000;
  private retryTimer?: NodeJS.Timeout;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  private handleOnline = () => {
    this.status = { isOnline: true, since: new Date() };
    this.notifyListeners();
    this.processQueue();
  };

  private handleOffline = () => {
    this.status = { isOnline: false, since: new Date() };
    this.notifyListeners();
  };

  private notifyListeners() {
    this.listeners.forEach(listener => listener({ ...this.status }));
  }

  getStatus(): NetworkStatus {
    return { ...this.status };
  }

  subscribe(listener: (status: NetworkStatus) => void): () => void {
    this.listeners.add(listener);
    // Immediately call with current status
    listener({ ...this.status });

    // Return unsubscribe function
    return () => this.listeners.delete(listener);
  }

  async queueRequest(url: string, options: RequestInit): Promise<Response> {
    if (this.status.isOnline) {
      return fetch(url, options);
    }

    // Add to offline queue
    if (this.offlineQueue.length >= this.maxQueueSize) {
      throw new Error('离线队列已满，请求未保存');
    }

    const queuedRequest: QueuedRequest = {
      url,
      options,
      timestamp: new Date(),
      retryCount: 0,
    };

    this.offlineQueue.push(queuedRequest);

    console.log(
      `[NetworkManager] Request queued (${this.offlineQueue.length}/${this.maxQueueSize})`
    );

    return Promise.reject(new Error('网络离线，请求已加入队列'));
  }

  private async processQueue() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    if (this.offlineQueue.length === 0) {
      return;
    }

    console.log(`[NetworkManager] Processing queue (${this.offlineQueue.length} requests)`);

    while (this.offlineQueue.length > 0 && this.status.isOnline) {
      const request = this.offlineQueue.shift();
      if (!request) break;

      try {
        await fetch(request.url, request.options);
        console.log(`[NetworkManager] Queued request succeeded: ${request.url}`);
      } catch (error) {
        console.error(`[NetworkManager] Queued request failed: ${request.url}`, error);

        // Retry failed requests
        request.retryCount++;
        if (request.retryCount < 3) {
          this.offlineQueue.unshift(request);
        }
      }
    }

    if (this.offlineQueue.length > 0) {
      // Retry remaining requests after delay
      this.retryTimer = setTimeout(() => {
        this.processQueue();
      }, this.retryDelay);
    }
  }

  getQueueSize(): number {
    return this.offlineQueue.length;
  }

  getQueue(): QueuedRequest[] {
    return [...this.offlineQueue];
  }

  clearQueue() {
    this.offlineQueue = [];
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
  }

  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.listeners.clear();
  }
}

// Singleton instance
export const networkManager = new NetworkManager();
