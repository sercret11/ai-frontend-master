import React, { useMemo, useState } from 'react';
import type { RuntimeEvent } from '@ai-frontend/shared-types';
import {
  TimelineEventRow,
  ToolEventCard,
  type ConsoleLevel,
  type TimelineEventItem,
  type ToolCardItem,
  type ToolCardStatus,
} from './cards';

export interface RunConsoleToolCall {
  toolName: string;
  callID: string;
  state?: 'started' | 'pending' | 'executing' | 'completed' | 'failed';
  progressText?: string;
  result?: string;
}

interface RunConsoleProps {
  events: RuntimeEvent[];
  toolCalls?: RunConsoleToolCall[];
  maxLines?: number;
}

type TimelineLine = Omit<TimelineEventItem, 'id'>;

interface ToolRelatedLine {
  sequence: number;
  timestamp: number;
  level: ConsoleLevel;
  text: string;
  groupId?: string;
  parentId?: string;
  durationMs?: number;
}

interface NormalizedConsoleData {
  toolCards: ToolCardItem[];
  timelineItems: TimelineEventItem[];
}

type ToolRuntimeEvent = Extract<
  RuntimeEvent,
  { type: 'tool.call.started' | 'tool.call.progress' | 'tool.call.completed' | 'tool.call.failed' }
>;

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

function shortId(value?: string): string {
  if (!value) return '';
  return value.length <= 28 ? value : `${value.slice(0, 24)}...`;
}

function eventToLine(event: RuntimeEvent): TimelineLine {
  switch (event.type) {
    case 'tool.call.started':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'progress',
        text: `tool.start ${event.toolName}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'tool.call.progress':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'progress',
        text: `tool.progress ${event.toolName}${event.progressText ? ` | ${event.progressText}` : ''}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'tool.call.completed':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'success',
        text: `tool.done ${event.toolName}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'tool.call.failed':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'error',
        text: `tool.fail ${event.toolName} | ${event.error}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'agent.task.started':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'progress',
        text: `agent.start ${event.agentId} | ${event.title}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'agent.task.progress':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'progress',
        text: `agent.progress ${event.agentId}${event.progressText ? ` | ${event.progressText}` : ''}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'agent.task.completed':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: event.success ? 'success' : 'error',
        text: `agent.done ${event.agentId}${event.summary ? ` | ${event.summary}` : ''}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'agent.task.blocked':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'error',
        text: `agent.blocked ${event.agentId} | ${event.reason}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'patch.intent.submitted':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'info',
        text: `patch.intent ${event.agentId} | ${event.filePath}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'patch.batch.merged':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'success',
        text: `patch.batch ${event.patchBatchId} | count=${event.patchCount}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'conflict.detected':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'error',
        text: `conflict.detected ${event.filePath} | ${event.involvedAgents.join(',')}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'conflict.resolved':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'success',
        text: `conflict.resolved ${event.filePath} | by=${event.resolvedBy}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'quality.gate.updated':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: event.status === 'failed' ? 'error' : event.status === 'passed' ? 'success' : 'progress',
        text: `quality.${event.gate} ${event.status}${typeof event.score === 'number' ? ` | score=${event.score}` : ''}${
          event.summary ? ` | ${event.summary}` : ''
        }`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'artifact.file.changed':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'info',
        text: `file.${event.action} ${event.path}`,
        durationMs: event.durationMs,
      };
    case 'render.pipeline.stage':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: event.status === 'failed' ? 'error' : event.status === 'started' ? 'progress' : 'success',
        text: `render.${event.stage}.${event.status}${event.message ? ` | ${event.message}` : ''}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'render.mode.switched':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'info',
        text: `render.mode ${event.fromMode} -> ${event.toMode}${event.reason ? ` | ${event.reason}` : ''}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'assembly.graph.ready':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'success',
        text: `assembly.graph.ready | rev=${event.revision} | pending=${event.pendingPatches}${event.message ? ` | ${event.message}` : ''}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'assembly.patch':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: event.acked ? 'success' : 'progress',
        text: `assembly.patch | rev=${event.revision} | patch=${event.patchId} | acked=${event.acked}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'assembly.executor.switch':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'info',
        text: `assembly.executor.switch | rev=${event.revision}${event.message ? ` | ${event.message}` : ''}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'autonomy.iteration':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'progress',
        text: `autonomy.iteration${typeof event.iteration === 'number' ? ` #${event.iteration}` : ''}${
          typeof event.maxIterations === 'number' ? `/${event.maxIterations}` : ''
        }${event.stage ? ` | stage=${event.stage}` : ''}${
          typeof event.reflectionScore === 'number' ? ` | score=${event.reflectionScore}` : ''
        }${event.message ? ` | ${event.message}` : ''}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'autonomy.budget':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level:
          event.status === 'exhausted'
            ? 'error'
            : event.status === 'warning'
              ? 'progress'
              : 'info',
        text: `autonomy.budget${event.scope ? ` | scope=${event.scope}` : ''}${
          typeof event.used === 'number' ? ` | used=${event.used}` : ''
        }${typeof event.limit === 'number' ? `/${event.limit}` : ''}${
          typeof event.remaining === 'number' ? ` | remaining=${event.remaining}` : ''
        }${event.unit ? ` ${event.unit}` : ''}${event.status ? ` | status=${event.status}` : ''}${
          event.message ? ` | ${event.message}` : ''
        }`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'autonomy.decision':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level:
          event.decision === 'abort'
            ? 'error'
            : event.decision === 'iterate'
              ? 'progress'
              : 'success',
        text: `autonomy.decision${event.decision ? ` | ${event.decision}` : ''}${
          typeof event.iteration === 'number' ? ` | iter=${event.iteration}` : ''
        }${typeof event.nextIteration === 'number' ? ` | next=${event.nextIteration}` : ''}${
          typeof event.nextTaskCount === 'number' ? ` | tasks=${event.nextTaskCount}` : ''
        }${event.reason ? ` | ${event.reason}` : ''}`,
        groupId: event.groupId,
        parentId: event.parentId,
        durationMs: event.durationMs,
      };
    case 'run.completed':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: event.success ? 'success' : 'error',
        text: `run.completed${typeof event.filesCount === 'number' ? ` | files=${event.filesCount}` : ''}${
          event.terminationReason ? ` | reason=${event.terminationReason}` : ''
        }${typeof event.iterations === 'number' ? ` | iterations=${event.iterations}` : ''}`,
        durationMs: event.durationMs,
      };
    case 'run.error':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'error',
        text: `run.error | ${event.error}`,
        durationMs: event.durationMs,
      };
    case 'assistant.delta':
      return {
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: 'info',
        text: `assistant.delta +${event.delta.length} chars`,
        durationMs: event.durationMs,
      };
    default: {
      const unknownEvent = event as RuntimeEvent;
      return {
        sequence: unknownEvent.sequence,
        timestamp: unknownEvent.timestamp,
        level: 'info',
        text: `event.${unknownEvent.type}`,
        durationMs: unknownEvent.durationMs,
      };
    }
  }
}

function normalizeLegacyToolStatus(state?: RunConsoleToolCall['state']): ToolCardStatus {
  if (state === 'failed') return 'failed';
  if (state === 'completed') return 'completed';
  if (state === 'started' || state === 'executing') return 'running';
  return 'pending';
}

function mergeToolStatus(current: ToolCardStatus, incoming: ToolCardStatus): ToolCardStatus {
  if (current === 'failed' || incoming === 'failed') return 'failed';
  if (incoming === 'completed') return 'completed';
  if (current === 'completed') return 'completed';
  if (current === 'running' || incoming === 'running') return 'running';
  return 'pending';
}

function isToolEvent(event: RuntimeEvent): event is ToolRuntimeEvent {
  return (
    event.type === 'tool.call.started' ||
    event.type === 'tool.call.progress' ||
    event.type === 'tool.call.completed' ||
    event.type === 'tool.call.failed'
  );
}

function isSchemaOnlyRuntimeEvent(event: RuntimeEvent): boolean {
  if (event.type.startsWith('sandbox.')) {
    return false;
  }

  if (
    event.type === 'render.mode.switched' &&
    (event.fromMode !== 'schema' || event.toMode !== 'schema')
  ) {
    return false;
  }

  return true;
}

function normalizeConsoleData(
  events: RuntimeEvent[],
  toolCalls: RunConsoleToolCall[],
  maxLines: number
): NormalizedConsoleData {
  const timelineItems: TimelineEventItem[] = [];
  const toolCards = new Map<string, ToolCardItem>();

  const ensureToolCard = (
    callId: string,
    toolName: string,
    sequence: number,
    timestamp: number
  ): ToolCardItem => {
    const existing = toolCards.get(callId);
    if (existing) return existing;

    const created: ToolCardItem = {
      id: `tool-card.${callId}`,
      callId,
      toolName,
      status: 'pending',
      sequence,
      startedAt: timestamp,
      updatedAt: timestamp,
      relatedEvents: [],
    };
    toolCards.set(callId, created);
    return created;
  };

  const appendToolRelatedEvent = (
    card: ToolCardItem,
    line: ToolRelatedLine,
    event: ToolRuntimeEvent,
    fallbackIndex: number
  ) => {
    card.relatedEvents.push({
      id: `${event.type}.${event.sequence}.${event.timestamp}.${fallbackIndex}`,
      sequence: line.sequence,
      timestamp: line.timestamp,
      level: line.level,
      text: line.text,
      durationMs: line.durationMs,
      groupId: line.groupId,
      parentId: line.parentId,
    });
  };

  let deltaCount = 0;
  let deltaChars = 0;
  let deltaTimestamp = 0;
  let deltaSequence = 0;
  let deltaFlushIndex = 0;

  const flushDelta = () => {
    if (deltaCount === 0) return;
    timelineItems.push({
      id: `assistant.delta.${deltaSequence}.${deltaTimestamp}.${deltaFlushIndex}`,
      sequence: deltaSequence,
      timestamp: deltaTimestamp,
      level: 'info',
      text: `assistant.delta x${deltaCount} (+${deltaChars} chars)`,
    });
    deltaCount = 0;
    deltaChars = 0;
    deltaTimestamp = 0;
    deltaSequence = 0;
    deltaFlushIndex += 1;
  };

  events.forEach((event, index) => {
    if (!isSchemaOnlyRuntimeEvent(event)) {
      return;
    }

    if (event.type === 'assistant.delta') {
      deltaCount += 1;
      deltaChars += event.delta.length;
      deltaTimestamp = event.timestamp;
      deltaSequence = event.sequence;
      return;
    }

    flushDelta();
    const line = eventToLine(event);

    if (isToolEvent(event)) {
      const card = ensureToolCard(
        event.callId || `call.${event.sequence}.${index}`,
        event.toolName,
        event.sequence,
        event.timestamp
      );

      card.sequence = Math.min(card.sequence, event.sequence);
      card.startedAt = Math.min(card.startedAt, event.timestamp);
      card.updatedAt = Math.max(card.updatedAt, event.timestamp);
      card.groupId = event.groupId ?? card.groupId;
      card.parentId = event.parentId ?? card.parentId;
      card.durationMs = event.durationMs ?? card.durationMs;

      if (event.type === 'tool.call.started') {
        card.status = mergeToolStatus(card.status, 'running');
      } else if (event.type === 'tool.call.progress') {
        card.status = mergeToolStatus(card.status, 'running');
        card.progressText = event.progressText ?? card.progressText;
      } else if (event.type === 'tool.call.completed') {
        card.status = mergeToolStatus(card.status, 'completed');
        card.output = event.output ?? card.output;
      } else {
        card.status = mergeToolStatus(card.status, 'failed');
        card.error = event.error ?? card.error;
      }

      appendToolRelatedEvent(card, line, event, index);
      return;
    }

    timelineItems.push({
      id: `${event.type}.${event.sequence}.${event.timestamp}.${index}`,
      sequence: line.sequence,
      timestamp: line.timestamp,
      level: line.level,
      text: line.text,
      durationMs: line.durationMs,
      groupId: line.groupId,
      parentId: line.parentId,
    });
  });

  flushDelta();

  toolCalls.forEach((call, index) => {
    const callId = call.callID || `legacy-call.${index}`;
    const status = normalizeLegacyToolStatus(call.state);
    const sequence = events.length + index + 1;
    const timestamp = Date.now() + index;
    const existing = toolCards.get(callId);

    if (existing) {
      existing.status = mergeToolStatus(existing.status, status);
      existing.progressText = call.progressText ?? existing.progressText;
      existing.output = call.result ?? existing.output;
      return;
    }

    toolCards.set(callId, {
      id: `tool-card.${callId}`,
      callId,
      toolName: call.toolName,
      status,
      sequence,
      startedAt: timestamp,
      updatedAt: timestamp,
      progressText: call.progressText,
      output: call.result,
      relatedEvents: [],
    });
  });

  const limit = Math.max(0, maxLines);
  const toolCardsList = Array.from(toolCards.values()).sort(
    (a, b) => a.sequence - b.sequence || a.updatedAt - b.updatedAt
  );
  const timelineList = limit > 0 ? timelineItems.slice(-limit) : [];

  return {
    toolCards: toolCardsList,
    timelineItems: timelineList,
  };
}

export const RunConsole: React.FC<RunConsoleProps> = ({ events, toolCalls = [], maxLines = 24 }) => {
  const [expandedByCallId, setExpandedByCallId] = useState<Record<string, boolean>>({});

  const normalized = useMemo(
    () => normalizeConsoleData(events, toolCalls, maxLines),
    [events, toolCalls, maxLines]
  );

  const isExpanded = (card: ToolCardItem): boolean => {
    if (expandedByCallId[card.callId] !== undefined) {
      return expandedByCallId[card.callId] as boolean;
    }
    return card.status === 'running' || card.status === 'pending';
  };

  const handleToggleCard = (callId: string) => {
    setExpandedByCallId(previous => {
      const card = normalized.toolCards.find(item => item.callId === callId);
      const fallbackExpanded = card ? card.status === 'running' || card.status === 'pending' : false;
      const current = previous[callId] ?? fallbackExpanded;
      return {
        ...previous,
        [callId]: !current,
      };
    });
  };

  if (normalized.toolCards.length === 0 && normalized.timelineItems.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 overflow-hidden">
      <div className="px-2 py-1 border-b border-neutral-800 text-[10px] uppercase tracking-wide text-neutral-400 font-mono">
        Runtime Console
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto p-2">
        {normalized.toolCards.length > 0 && (
          <div className="space-y-2">
            <div className="px-1 text-[10px] uppercase tracking-wide text-neutral-500">Tool Calls</div>
            {normalized.toolCards.map(card => (
              <ToolEventCard
                key={card.id}
                card={card}
                expanded={isExpanded(card)}
                onToggle={handleToggleCard}
                formatTime={formatTime}
                shortId={shortId}
              />
            ))}
          </div>
        )}

        {normalized.timelineItems.length > 0 && (
          <div className="space-y-1.5">
            <div className="px-1 text-[10px] uppercase tracking-wide text-neutral-500">Timeline</div>
            {normalized.timelineItems.map(item => (
              <TimelineEventRow
                key={item.id}
                item={item}
                formatTime={formatTime}
                shortId={shortId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
