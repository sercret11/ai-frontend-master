import { describe, expect, it } from 'vitest';
import {
  createRunTerminalEventTracker,
  emitRunCompletedOnce,
  emitRunErrorOnce,
  withRunTerminalEventTracking,
} from './run-terminal-events';

type TestRuntimeEvent =
  | { type: 'artifact.file.changed'; path: string }
  | { type: 'run.completed'; success: boolean }
  | { type: 'run.error'; error: string };

type TestRunCompletedEvent = Extract<TestRuntimeEvent, { type: 'run.completed' }>;
type TestRunErrorEvent = Extract<TestRuntimeEvent, { type: 'run.error' }>;

describe('run-terminal-events', () => {
  it('records terminal state from tracked emitter and blocks later terminal events', () => {
    const tracker = createRunTerminalEventTracker();
    const events: TestRuntimeEvent[] = [];
    const emitEvent = withRunTerminalEventTracking((event: TestRuntimeEvent) => {
      events.push(event);
      return event;
    }, tracker);

    emitEvent({ type: 'artifact.file.changed', path: 'src/App.tsx' });
    emitEvent({ type: 'run.error', error: 'execution failed' });

    const result = emitRunCompletedOnce<TestRunCompletedEvent, TestRuntimeEvent>(
      emitEvent,
      tracker,
      {
        success: true,
      },
    );

    expect(result).toBeNull();
    expect(tracker.getTerminalEventType()).toBe('run.error');
    expect(events).toEqual([
      { type: 'artifact.file.changed', path: 'src/App.tsx' },
      { type: 'run.error', error: 'execution failed' },
    ]);
  });

  it('emits only the first terminal event through helper methods', () => {
    const tracker = createRunTerminalEventTracker();
    const events: TestRuntimeEvent[] = [];
    const emitEvent = withRunTerminalEventTracking((event: TestRuntimeEvent) => {
      events.push(event);
      return event;
    }, tracker);

    const completed = emitRunCompletedOnce<TestRunCompletedEvent, TestRuntimeEvent>(
      emitEvent,
      tracker,
      {
        success: true,
      },
    );
    const errored = emitRunErrorOnce<TestRunErrorEvent, TestRuntimeEvent>(emitEvent, tracker, {
      error: 'should be ignored',
    });

    expect(completed).toEqual({ type: 'run.completed', success: true });
    expect(errored).toBeNull();
    expect(tracker.getTerminalEventType()).toBe('run.completed');
    expect(events).toEqual([{ type: 'run.completed', success: true }]);
  });
});
