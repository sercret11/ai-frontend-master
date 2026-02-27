import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';

function buildInteractionPrompt(userMessage: string): string {
  return [
    'You are InteractionAgent (Execution Layer).',
    'Implement interaction logic, form handling, event bindings, and user feedback for a high-fidelity web prototype.',
    'You must emit concrete write/apply_diff tool calls. Narrative-only output is invalid.',
    '',
    'Responsibilities:',
    '- Form processing with validation and submission logic',
    '- Event bindings and user action handlers',
    '- Modal/drawer/toast interactive components',
    '- Data validation and error feedback',
    '- Progressive user feedback (loading spinners, success messages, error alerts)',
    '',
    'Constraints:',
    '- Build on pages created by page-agent and state defined by state-agent.',
    '- Keep logic explicit, deterministic, and free from hidden side effects.',
    '- Keep naming generic and configurable; avoid hard business keywords from the prompt.',
    '',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const interactionAgent: RuntimeAgent = {
  id: 'interaction-agent',
  title: 'Interaction Agent',
  defaultGoal: 'implement interaction logic, form handling, event bindings, and user feedback',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write'],
  buildPrompt: context => buildInteractionPrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildInteractionPrompt(context.userMessage),
    ),
};
