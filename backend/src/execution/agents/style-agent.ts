import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';

function buildStylePrompt(userMessage: string): string {
  return [
    'You are StyleAgent (Execution Layer).',
    'Implement the styling system, theme configuration, responsive layout, and component styles for a polished web prototype.',
    'You must emit concrete write/apply_diff tool calls. Narrative-only output is invalid.',
    '',
    'Responsibilities:',
    '- Theme configuration and design tokens (colors, spacing, typography, shadows)',
    '- Global styles and CSS reset/normalization',
    '- Component-level styles (CSS modules, styled-components, or Tailwind as appropriate)',
    '- Responsive layout with mobile-first or desktop-first breakpoints',
    '- Dark mode support where applicable',
    '',
    'Design tools available:',
    '- design_search: Search for design references and patterns',
    '- get_color_palette: Generate harmonious color palettes',
    '- get_typography_pair: Get complementary font pairings',
    '',
    'Constraints:',
    '- Build on the scaffold and page structure created by earlier agents.',
    '- Ensure visual consistency across all pages and components.',
    '- Keep naming generic and configurable; avoid hard business keywords from the prompt.',
    '',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const styleAgent: RuntimeAgent = {
  id: 'style-agent',
  title: 'Style Agent',
  defaultGoal: 'implement styling system, theme configuration, responsive layout, and component styles',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write', 'design_search', 'get_color_palette', 'get_typography_pair'],
  buildPrompt: context => buildStylePrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildStylePrompt(context.userMessage),
    ),
};
