import type { AgentRuntimeID } from '@ai-frontend/shared-types';
import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { architectAgent } from './architect-agent';
import { interactionAgent } from './interaction-agent';
import { pageAgent } from './page-agent';
import { plannerAgent } from './planner-agent';
import { qualityAgent } from './quality-agent';
import { repairAgent } from './repair-agent';
import { researchAgent } from './research-agent';
import { stateAgent } from './state-agent';

const runtimeAgents: RuntimeAgent[] = [
  plannerAgent,
  architectAgent,
  pageAgent,
  interactionAgent,
  stateAgent,
  qualityAgent,
  repairAgent,
  researchAgent,
];

const runtimeAgentMap = new Map<AgentRuntimeID, RuntimeAgent>(
  runtimeAgents.map(agent => [agent.id, agent])
);

export function listRuntimeAgents(): RuntimeAgent[] {
  return runtimeAgents;
}

export function getRuntimeAgent(agentId: AgentRuntimeID): RuntimeAgent {
  const agent = runtimeAgentMap.get(agentId);
  if (!agent) {
    throw new Error(`Runtime agent not found: ${agentId}`);
  }
  return agent;
}

