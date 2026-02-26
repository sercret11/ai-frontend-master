import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from './runner';

function buildPagePrompt(userMessage: string): string {
  return [
    'You are PageAgent.',
    'Implement page-level structure, route composition, and visual hierarchy for a production-grade web prototype.',
    'You must emit concrete write/apply_diff tool calls. Narrative-only output is invalid.',
    'Create or update multiple runtime files in this task, including route shells and reusable page modules.',
    'Keep naming generic and configurable; avoid hard business keywords from the prompt.',
    'Ensure UI supports loading/empty/error/success state rendering.',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const pageAgent: RuntimeAgent = {
  id: 'page-agent',
  title: 'Page Agent',
  defaultGoal: 'implement route-level and page-level scaffolding',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write'],
  buildPrompt: context => buildPagePrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildPagePrompt(context.userMessage)
    ),
};
