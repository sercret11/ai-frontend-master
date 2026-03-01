export type RunTerminalEventType = 'run.completed' | 'run.error';

export interface RunTerminalEventTracker {
  getTerminalEventType: () => RunTerminalEventType | null;
  hasTerminalEvent: () => boolean;
  record: (eventType: string) => void;
}

export function isRunTerminalEventType(eventType: string): eventType is RunTerminalEventType {
  return eventType === 'run.completed' || eventType === 'run.error';
}

export function createRunTerminalEventTracker(): RunTerminalEventTracker {
  let terminalEventType: RunTerminalEventType | null = null;

  return {
    getTerminalEventType: () => terminalEventType,
    hasTerminalEvent: () => terminalEventType !== null,
    record: (eventType: string) => {
      if (!terminalEventType && isRunTerminalEventType(eventType)) {
        terminalEventType = eventType;
      }
    },
  };
}

type EventWithType = {
  type: string;
};

type EventPayloadWithoutType<TEvent extends EventWithType> = Omit<TEvent, 'type'>;

export function withRunTerminalEventTracking<TEvent extends EventWithType, TResult>(
  emitEvent: (event: TEvent) => TResult,
  tracker: RunTerminalEventTracker,
): (event: TEvent) => TResult {
  return (event: TEvent): TResult => {
    const result = emitEvent(event);
    tracker.record(event.type);
    return result;
  };
}

export function emitRunCompletedOnce<TEvent extends { type: 'run.completed' }, TResult>(
  emitEvent: (event: TEvent) => TResult,
  tracker: RunTerminalEventTracker,
  payload: EventPayloadWithoutType<TEvent>,
): TResult | null {
  if (tracker.hasTerminalEvent()) {
    return null;
  }

  return emitEvent({
    type: 'run.completed',
    ...payload,
  } as TEvent);
}

export function emitRunErrorOnce<TEvent extends { type: 'run.error' }, TResult>(
  emitEvent: (event: TEvent) => TResult,
  tracker: RunTerminalEventTracker,
  payload: EventPayloadWithoutType<TEvent>,
): TResult | null {
  if (tracker.hasTerminalEvent()) {
    return null;
  }

  return emitEvent({
    type: 'run.error',
    ...payload,
  } as TEvent);
}
