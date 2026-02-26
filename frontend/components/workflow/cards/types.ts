export type ConsoleLevel = 'info' | 'progress' | 'success' | 'error';

export type ToolCardStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ToolRelatedEvent {
  id: string;
  sequence: number;
  timestamp: number;
  level: ConsoleLevel;
  text: string;
  durationMs?: number;
  groupId?: string;
  parentId?: string;
}

export interface ToolCardItem {
  id: string;
  callId: string;
  toolName: string;
  status: ToolCardStatus;
  sequence: number;
  startedAt: number;
  updatedAt: number;
  durationMs?: number;
  progressText?: string;
  output?: string;
  error?: string;
  groupId?: string;
  parentId?: string;
  relatedEvents: ToolRelatedEvent[];
}

export interface TimelineEventItem {
  id: string;
  sequence: number;
  timestamp: number;
  level: ConsoleLevel;
  text: string;
  durationMs?: number;
  groupId?: string;
  parentId?: string;
}
