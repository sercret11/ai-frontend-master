import type { RuntimeEvent } from '@ai-frontend/shared-types';

export class MultiAgentEventBus {
  private readonly events: RuntimeEvent[] = [];

  publish(event: RuntimeEvent): void {
    this.events.push(event);
  }

  list(): RuntimeEvent[] {
    return [...this.events];
  }
}

