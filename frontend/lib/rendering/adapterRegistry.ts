import type { PreviewMode, RenderingCapability, RenderingRequest } from '@ai-frontend/shared-types';
import type { AdapterLookup, RenderingExecutor } from './types';

function sortByPriorityDesc(left: RenderingExecutor, right: RenderingExecutor): number {
  return right.descriptor.priority - left.descriptor.priority;
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, RenderingExecutor>();

  register(executor: RenderingExecutor): void {
    this.adapters.set(executor.descriptor.id, executor);
  }

  unregister(adapterId: string): boolean {
    return this.adapters.delete(adapterId);
  }

  get(adapterId: string): RenderingExecutor | undefined {
    return this.adapters.get(adapterId);
  }

  list(): RenderingExecutor[] {
    return [...this.adapters.values()].sort(sortByPriorityDesc);
  }

  findByMode(mode: PreviewMode): RenderingExecutor[] {
    return this.list().filter(executor => executor.descriptor.mode === mode);
  }

  findByCapability(capability: RenderingCapability): RenderingExecutor[] {
    return this.list().filter(executor => executor.descriptor.capabilities.includes(capability));
  }

  async resolveBest(lookup: AdapterLookup, request: RenderingRequest): Promise<RenderingExecutor | null> {
    const candidates = this.list().filter(executor => {
      if (lookup.mode && executor.descriptor.mode !== lookup.mode) {
        return false;
      }
      if (lookup.capability && !executor.descriptor.capabilities.includes(lookup.capability)) {
        return false;
      }
      return true;
    });

    for (const candidate of candidates) {
      const available = await candidate.canExecute(request);
      if (available) {
        return candidate;
      }
    }

    return null;
  }
}
