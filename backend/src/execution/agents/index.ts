import type { ExecutionAgentID } from '../../planning/types';
import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { scaffoldAgent } from './scaffold-agent';
import { pageAgent } from './page-agent';
import { interactionAgent } from './interaction-agent';
import { stateAgent } from './state-agent';
import { styleAgent } from './style-agent';
import { qualityAgent } from './quality-agent';
import { repairAgent } from './repair-agent';

const executionAgents: RuntimeAgent[] = [
  scaffoldAgent,
  pageAgent,
  interactionAgent,
  stateAgent,
  styleAgent,
  qualityAgent,
  repairAgent,
];

const executionAgentMap = new Map<ExecutionAgentID, RuntimeAgent>(
  executionAgents.map(agent => [agent.id as ExecutionAgentID, agent]),
);

/**
 * Return all registered execution-layer agents.
 */
export function listExecutionAgents(): RuntimeAgent[] {
  return executionAgents;
}

/**
 * Look up an execution-layer agent by its ID.
 * Throws if the ID is not a valid execution agent.
 */
export function getExecutionAgent(agentId: ExecutionAgentID): RuntimeAgent {
  const agent = executionAgentMap.get(agentId);
  if (!agent) {
    throw new Error(`Execution agent not found: ${agentId}`);
  }
  return agent;
}

/**
 * Check whether a given string is a valid execution agent ID.
 */
export function isExecutionAgentID(id: string): id is ExecutionAgentID {
  return executionAgentMap.has(id as ExecutionAgentID);
}
