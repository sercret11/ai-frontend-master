/**
 * Parallel Executor - 并行执行器
 *
 * 提供并行执行能力，修复竞态条件
 */

export interface ParallelOptions {
  concurrency?: number;
}

export class ParallelExecutor {
  /**
   * 并行执行多个异步函数（修复竞态条件）
   */
  async execute<T>(fns: (() => Promise<T>)[], options?: ParallelOptions): Promise<T[]> {
    if (!options?.concurrency) {
      return Promise.all(fns.map(fn => fn()));
    }

    // 限制并发数
    const results: Map<number, T> = new Map();
    const executing: Set<Promise<T>> = new Set();

    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i];
      const index = i;

      const promise = fn().then(result => {
        results.set(index, result);
        executing.delete(promise);
        return result;
      });

      executing.add(promise);

      if (executing.size >= options.concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);

    // 按原始顺序返回结果，并检查完整性
    const resultArray: T[] = [];
    for (let i = 0; i < fns.length; i++) {
      const result = results.get(i);
      if (result === undefined) {
        throw new Error(
          `Missing result for function at index ${i}. ` +
            `This may indicate an async task failed silently.`
        );
      }
      resultArray.push(result);
    }
    return resultArray;
  }

  /**
   * 带并发限制的并行执行
   */
  async executeWithLimit<T>(fns: (() => Promise<T>)[], limit: number): Promise<T[]> {
    return this.execute(fns, { concurrency: limit });
  }

  /**
   * 批量执行
   */
  async executeBatch<T>(
    items: T[],
    handler: (item: T) => Promise<void>,
    options?: ParallelOptions
  ): Promise<void> {
    const fns = items.map(item => () => handler(item));
    await this.execute(fns, options);
  }

  /**
   * Map 操作（带并发控制）
   */
  async map<T, R>(
    items: T[],
    mapper: (item: T) => Promise<R>,
    options?: ParallelOptions
  ): Promise<R[]> {
    const fns = items.map(item => () => mapper(item));
    return this.execute(fns, options);
  }
}
