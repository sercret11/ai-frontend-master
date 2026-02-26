import React, { useMemo } from 'react';
import type { AgentRuntimeID, RuntimeEvent } from '@ai-frontend/shared-types';

interface AgentBoardProps {
  events: RuntimeEvent[];
}

type AgentStatus = 'idle' | 'running' | 'blocked' | 'failed' | 'completed';

interface AgentViewState {
  id: AgentRuntimeID;
  title: string;
  status: AgentStatus;
  detail: string;
}

const AGENT_ORDER: Array<{ id: AgentRuntimeID; title: string }> = [
  { id: 'planner-agent', title: 'Planner' },
  { id: 'architect-agent', title: 'Architect' },
  { id: 'research-agent', title: 'Research' },
  { id: 'page-agent', title: 'Page' },
  { id: 'interaction-agent', title: 'Interaction' },
  { id: 'state-agent', title: 'State' },
  { id: 'quality-agent', title: 'Quality' },
  { id: 'repair-agent', title: 'Repair' },
];

function createDefaultState(): AgentViewState[] {
  return AGENT_ORDER.map(agent => ({
    id: agent.id,
    title: agent.title,
    status: 'idle',
    detail: 'waiting',
  }));
}

function mapStatusClass(status: AgentStatus): string {
  switch (status) {
    case 'running':
      return 'border-blue-500/60 bg-blue-500/10 text-blue-100';
    case 'blocked':
      return 'border-amber-500/60 bg-amber-500/10 text-amber-100';
    case 'failed':
      return 'border-red-500/60 bg-red-500/10 text-red-100';
    case 'completed':
      return 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100';
    default:
      return 'border-neutral-700 bg-neutral-900 text-neutral-300';
  }
}

function resolveStatusText(status: AgentStatus): string {
  switch (status) {
    case 'running':
      return 'running';
    case 'blocked':
      return 'blocked';
    case 'failed':
      return 'failed';
    case 'completed':
      return 'completed';
    default:
      return 'idle';
  }
}

function buildAgentBoardState(events: RuntimeEvent[]): AgentViewState[] {
  const states = createDefaultState();
  const indexMap = new Map<AgentRuntimeID, number>();
  states.forEach((state, index) => indexMap.set(state.id, index));

  events.forEach(event => {
    if (!event.agentId) return;
    const index = indexMap.get(event.agentId);
    if (index === undefined) return;
    const state = states[index];
    if (!state) return;

    switch (event.type) {
      case 'agent.task.started':
        state.status = 'running';
        state.detail = event.title || 'task started';
        break;
      case 'agent.task.progress':
        state.status = 'running';
        state.detail = event.progressText || 'in progress';
        break;
      case 'agent.task.completed':
        state.status = event.success ? 'completed' : 'failed';
        state.detail = event.summary || (event.success ? 'completed' : 'failed');
        break;
      case 'agent.task.blocked':
        state.status = 'blocked';
        state.detail = event.reason || 'blocked';
        break;
      default:
        break;
    }
  });

  return states;
}

export const AgentBoard: React.FC<AgentBoardProps> = ({ events }) => {
  const agents = useMemo(() => buildAgentBoardState(events), [events]);

  return (
    <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 p-2">
      <div className="px-1 pb-2 text-[10px] uppercase tracking-wide text-neutral-400">Agent Board</div>
      <div className="grid grid-cols-2 gap-2">
        {agents.map(agent => (
          <div
            key={agent.id}
            className={`rounded-md border px-2 py-1.5 transition-colors ${mapStatusClass(agent.status)}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium">{agent.title}</span>
              <span className="text-[10px] uppercase">{resolveStatusText(agent.status)}</span>
            </div>
            <div className="mt-1 truncate text-[10px] opacity-90">{agent.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

