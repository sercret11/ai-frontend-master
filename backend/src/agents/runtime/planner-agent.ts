import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from './runner';

function buildPlannerPrompt(userMessage: string): string {
  return [
    'You are PlannerAgent.',
    'Output a concise implementation plan that can guide parallel agents.',
    'Focus on task decomposition, dependencies, and acceptance gates.',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const plannerAgent: RuntimeAgent = {
  id: 'planner-agent',
  title: 'Planner Agent',
  defaultGoal: 'decompose objective into executable graph',
  fallbackAgentId: 'code-architect',
  allowedTools: ['read', 'grep', 'glob'],
  buildPrompt: context => buildPlannerPrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'code-architect',
      buildPlannerPrompt(context.userMessage)
    ),
};

