import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';
import {
  buildExecutionContractSection,
  EXECUTION_GROUNDING_CONSTRAINTS,
} from './prompt-context';

function buildInteractionPrompt(context: Parameters<RuntimeAgent['buildPrompt']>[0]): string {
  return [
    'You are InteractionAgent (Execution Layer).',
    'Implement interaction logic, form handling, event bindings, and user feedback for a high-fidelity web prototype.',
    ...EXECUTION_GROUNDING_CONSTRAINTS,
    '',
    'Responsibilities:',
    '- Form processing with validation and submission logic',
    '- Event bindings and user action handlers for primary workflows',
    '- Modal/drawer/toast interactive components where flows require feedback',
    '- Data validation and error feedback for user inputs',
    '- Progressive user feedback (loading, success, error) for async actions',
    '',
    'Constraints:',
    '- Build on page/state outputs and preserve explicit data flow.',
    '- Keep logic deterministic and free from hidden side effects.',
    '- Do not leave interactions as static UI placeholders.',
    '',
    buildExecutionContractSection(context),
  ].join('\n');
}

export const interactionAgent: RuntimeAgent = {
  id: 'interaction-agent',
  title: 'Interaction Agent',
  defaultGoal: 'implement interaction logic, form handling, event bindings, and user feedback',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write'],
  buildPrompt: context => buildInteractionPrompt(context),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildInteractionPrompt(context),
    ),
};
