import { describe, expect, it } from 'vitest';
import type {
  AssemblyGraphReadyEvent,
  RenderPipelineStageEvent,
  RunCompletedEvent,
  RuntimeEvent,
  RuntimeEventPayload,
  ToolCallStartedEvent,
} from '@ai-frontend/shared-types';

function wrapRuntimeEvent<TEvent extends RuntimeEvent>(
  payload: RuntimeEventPayload<TEvent>,
  sequence: number
): TEvent {
  return {
    ...payload,
    sessionId: 'session-contract',
    runId: 'run-contract',
    sequence,
    timestamp: 1_700_000_000_000 + sequence,
  } as TEvent;
}

describe('runtime event contract', () => {
  it('keeps payload fields separated from runtime envelope fields', () => {
    const payload: RuntimeEventPayload<ToolCallStartedEvent> = {
      type: 'tool.call.started',
      callId: 'call-1',
      toolName: 'bash',
      args: { command: 'echo hello' },
      state: 'started',
    };

    const payloadKeys = Object.keys(payload);
    expect(payloadKeys).not.toContain('sessionId');
    expect(payloadKeys).not.toContain('runId');
    expect(payloadKeys).not.toContain('sequence');
    expect(payloadKeys).not.toContain('timestamp');

    const event = wrapRuntimeEvent(payload, 1);
    expect(event).toMatchObject({
      type: 'tool.call.started',
      sessionId: 'session-contract',
      runId: 'run-contract',
      sequence: 1,
      callId: 'call-1',
      toolName: 'bash',
      state: 'started',
    });
    expect(event.timestamp).toBeGreaterThan(0);
  });

  it('preserves required fields for assembly graph ready events', () => {
    const payload: RuntimeEventPayload<AssemblyGraphReadyEvent> = {
      type: 'assembly.graph.ready',
      revision: 7,
      graph: {
        nodes: [{ id: 'root' }],
        edges: [],
      },
      executor: 'sandpack-renderer',
      pendingPatches: 2,
      message: 'assembly graph is ready',
    };

    const event = wrapRuntimeEvent(payload, 2);
    expect(event.type).toBe('assembly.graph.ready');
    expect(event.revision).toBe(7);
    expect(event.executor).toBe('sandpack-renderer');
    expect(event.pendingPatches).toBe(2);
    expect(event.graph).toEqual({
      nodes: [{ id: 'root' }],
      edges: [],
    });
  });

  it('preserves run completion and render pipeline stage fields', () => {
    const completedPayload: RuntimeEventPayload<RunCompletedEvent> = {
      type: 'run.completed',
      success: true,
      filesCount: 3,
      terminationReason: 'single_iteration',
      iterations: 1,
      budgetSummary: {
        maxIterations: 3,
        usedIterations: 1,
        maxToolCalls: 12,
        usedToolCalls: 4,
        maxDurationMs: 120_000,
        elapsedMs: 2_000,
        targetScore: 90,
        finalScore: 95,
      },
    };
    const pipelinePayload: RuntimeEventPayload<RenderPipelineStageEvent> = {
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'publish',
      status: 'completed',
      message: 'schema preview published',
    };

    const completedEvent = wrapRuntimeEvent(completedPayload, 3);
    const pipelineEvent = wrapRuntimeEvent(pipelinePayload, 4);

    expect(completedEvent.type).toBe('run.completed');
    expect(completedEvent.terminationReason).toBe('single_iteration');
    expect(completedEvent.budgetSummary?.finalScore).toBe(95);

    expect(pipelineEvent.type).toBe('render.pipeline.stage');
    expect(pipelineEvent.adapter).toBe('sandpack-renderer');
    expect(pipelineEvent.stage).toBe('publish');
    expect(pipelineEvent.status).toBe('completed');
  });
});

