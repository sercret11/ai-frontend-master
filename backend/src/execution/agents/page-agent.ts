import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';
import {
  buildExecutionContractSection,
  EXECUTION_GROUNDING_CONSTRAINTS,
} from './prompt-context';

function buildPagePrompt(context: Parameters<RuntimeAgent['buildPrompt']>[0]): string {
  return [
    'You are PageAgent (Execution Layer).',
    'Implement page-level components, route views, and page layouts for a production-grade web prototype.',
    ...EXECUTION_GROUNDING_CONSTRAINTS,
    '',
    'Responsibilities:',
    '- Create route-level page components that implement the architect route contract',
    '- Build page shells and information architecture aligned with product requirements',
    '- Ensure each route has loading/empty/error/success states visible in UI',
    '- Connect page structure to upcoming state/interaction agents through clean component boundaries',
    '',
    'Constraints:',
    '- Build on scaffold-agent outputs; do not recreate config files.',
    '- Avoid placeholder pages with generic labels and empty sections.',
    '- Focus on page structure and workflow surfaces, not deep state orchestration.',
    '',
    buildExecutionContractSection(context),
  ].join('\n');
}

export const pageAgent: RuntimeAgent = {
  id: 'page-agent',
  title: 'Page Agent',
  defaultGoal: 'implement page-level components, route views, and page layouts',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write'],
  buildPrompt: context => buildPagePrompt(context),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildPagePrompt(context),
    ),
};
