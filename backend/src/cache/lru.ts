// LRU 缓存实现
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxsize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxsize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 重新插入以更新顺序
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // 删除旧值（如果存在）
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // 如果达到最大容量，删除最旧的项
    else if (this.cache.size >= this.maxsize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  get keys(): K[] {
    return Array.from(this.cache.keys());
  }

  get values(): V[] {
    return Array.from(this.cache.values());
  }

  get entries(): [K, V][] {
    return Array.from(this.cache.entries());
  }
}
