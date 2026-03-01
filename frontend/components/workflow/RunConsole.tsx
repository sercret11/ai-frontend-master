import React, { useMemo } from 'react';
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

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

function shortId(value?: string): string {
  if (!value) return '';
  return value.length <= 20 ? value : `${value.slice(0, 16)}...`;
}

function eventToLine(event: RuntimeEvent): Omit<TimelineEventItem, 'id'> {
  switch (event.type) {
    case 'tool.call.started': return { sequence: event.sequence, timestamp: event.timestamp, level: 'progress', text: `Starting ${event.toolName}`, durationMs: event.durationMs };
    case 'tool.call.progress': return { sequence: event.sequence, timestamp: event.timestamp, level: 'progress', text: `${event.toolName}: ${event.progressText || 'In progress'}`, durationMs: event.durationMs };
    case 'tool.call.completed': return { sequence: event.sequence, timestamp: event.timestamp, level: 'success', text: `Completed ${event.toolName}`, durationMs: event.durationMs };
    case 'tool.call.failed': return { sequence: event.sequence, timestamp: event.timestamp, level: 'error', text: `Failed ${event.toolName}: ${event.error}`, durationMs: event.durationMs };
    case 'agent.task.started': return { sequence: event.sequence, timestamp: event.timestamp, level: 'progress', text: `Agent: ${event.title}`, durationMs: event.durationMs };
    case 'agent.task.progress': return { sequence: event.sequence, timestamp: event.timestamp, level: 'progress', text: event.progressText || `Agent progress: ${event.agentId}`, durationMs: event.durationMs };
    case 'agent.task.completed': return { sequence: event.sequence, timestamp: event.timestamp, level: event.success ? 'success' : 'error', text: `Task Done: ${event.agentId}`, durationMs: event.durationMs };
    case 'patch.batch.merged': return { sequence: event.sequence, timestamp: event.timestamp, level: 'success', text: `Applied ${event.patchCount} changes`, durationMs: event.durationMs };
    case 'run.completed': return { sequence: event.sequence, timestamp: event.timestamp, level: event.success ? 'success' : 'error', text: `Execution Finished`, durationMs: event.durationMs };
    default: return { sequence: event.sequence, timestamp: event.timestamp, level: 'info', text: `Event: ${event.type}`, durationMs: event.durationMs };
  }
}

function normalizeConsoleData(events: RuntimeEvent[], toolCalls: RunConsoleToolCall[], maxLines: number) {
  const timelineItems: TimelineEventItem[] = [];
  const toolCards: ToolCardItem[] = [];

  events.forEach((event, index) => {
    // Filter logic for a clean autonomous feel
    const importantTypes = ['tool.call.started', 'tool.call.completed', 'tool.call.failed', 'agent.task.started', 'agent.task.progress', 'agent.task.completed', 'patch.batch.merged'];
    if (!importantTypes.includes(event.type)) return;

    const line = eventToLine(event);
    timelineItems.push({ id: `ev-${event.sequence}-${index}`, ...line });
  });

  toolCalls.forEach((call, index) => {
    toolCards.push({
      id: `tool-${call.callID || index}`,
      callId: call.callID,
      toolName: call.toolName,
      status: call.state === 'completed' ? 'completed' : call.state === 'failed' ? 'failed' : 'running',
      sequence: 999,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      progressText: call.progressText,
      output: call.result,
      relatedEvents: []
    });
  });

  return { toolCards, timelineItems: timelineItems.slice(-maxLines) };
}

export const RunConsole: React.FC<RunConsoleProps> = ({ events, toolCalls = [], maxLines = 10 }) => {
  const normalized = useMemo(() => normalizeConsoleData(events, toolCalls, maxLines), [events, toolCalls, maxLines]);
  const allItems = [...normalized.toolCards.map(d => ({type:'tool', data:d})), ...normalized.timelineItems.map(d => ({type:'timeline', data:d}))];

  if (allItems.length === 0) return null;

  return (
    <div className="space-y-3 w-full">
      {allItems.map((item, idx) => (
        <div 
          key={idx}
          className="w-full bg-white border border-gray-100 rounded-2xl p-4 shadow-sm animate-in slide-in-from-left-2 duration-300"
        >
          {item.type === 'tool' ? (
            <ToolEventCard card={item.data as ToolCardItem} expanded={false} onToggle={()=>{}} formatTime={formatTime} shortId={shortId} />
          ) : (
            <TimelineEventRow item={item.data as TimelineEventItem} formatTime={formatTime} shortId={shortId} />
          )}
        </div>
      ))}
    </div>
  );
};
