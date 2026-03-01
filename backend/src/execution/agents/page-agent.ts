import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';

function buildPagePrompt(userMessage: string): string {
  return [
    'You are PageAgent (Execution Layer).',
    'Implement page-level components, route views, and page layouts for a production-grade web prototype.',
    'You must emit concrete write/apply_diff tool calls. Narrative-only output is invalid.',
    '',
    'Responsibilities:',
    '- Create page-level components for each route defined in the scaffold',
    '- Implement page shells with proper layout structure',
    '- Set up route-level code splitting boundaries',
    '- Ensure each route has a corresponding page with loading/empty/error/success states',
    '',
    'Constraints:',
    '- Build on the scaffold created by scaffold-agent — do not recreate config files.',
    '- Keep naming generic and configurable; avoid hard business keywords from the prompt.',
    '- Focus on structure and layout, not interaction logic or state management.',
    '',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const pageAgent: RuntimeAgent = {
  id: 'page-agent',
  title: 'Page Agent',
  defaultGoal: 'implement page-level components, route views, and page layouts',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write'],
  buildPrompt: context => buildPagePrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildPagePrompt(context.userMessage),
    ),
};
