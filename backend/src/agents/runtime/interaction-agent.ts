import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from './runner';

function buildInteractionPrompt(userMessage: string): string {
  return [
    'You are InteractionAgent.',
    'Implement interaction flow, event handling, and user feedback loops for a high-fidelity web prototype.',
    'You must emit concrete write/apply_diff tool calls. Narrative-only output is invalid.',
    'Materialize interactive behaviors for forms, table/list actions, and progressive user feedback.',
    'Keep logic explicit, deterministic, and free from hidden side effects.',
    'Keep naming generic and configurable; avoid hard business keywords from the prompt.',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const interactionAgent: RuntimeAgent = {
  id: 'interaction-agent',
  title: 'Interaction Agent',
  defaultGoal: 'implement user interactions and workflow transitions',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write'],
  buildPrompt: context => buildInteractionPrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildInteractionPrompt(context.userMessage)
    ),
};
