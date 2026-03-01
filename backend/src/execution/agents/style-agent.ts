import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';
import {
  buildExecutionContractSection,
  EXECUTION_GROUNDING_CONSTRAINTS,
} from './prompt-context';

function buildStylePrompt(context: Parameters<RuntimeAgent['buildPrompt']>[0]): string {
  return [
    'You are StyleAgent (Execution Layer).',
    'Implement styling system, theme configuration, responsive layout, and component styling for a polished web prototype.',
    ...EXECUTION_GROUNDING_CONSTRAINTS,
    '',
    'Responsibilities:',
    '- Theme tokens for colors, spacing, typography, elevation, and semantic states',
    '- Global styles and reset/normalization',
    '- Component-level styling aligned with page structure and workflows',
    '- Responsive behavior across viewport breakpoints',
    '- Meaningful visual hierarchy and interaction feedback styles',
    '',
    'Design tools available:',
    '- design_search: Search for design references and patterns',
    '- get_color_palette: Generate harmonious color palettes',
    '- get_typography_pair: Get complementary font pairings',
    '',
    'Constraints:',
    '- Build on scaffold/page outputs and preserve semantic structure.',
    '- Avoid flat boilerplate styling and purely generic dashboard skins.',
    '- Ensure visual consistency and accessibility contrast baselines.',
    '',
    buildExecutionContractSection(context),
  ].join('\n');
}

export const styleAgent: RuntimeAgent = {
  id: 'style-agent',
  title: 'Style Agent',
  defaultGoal: 'implement styling system, theme configuration, responsive layout, and component styles',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write', 'design_search', 'get_color_palette', 'get_typography_pair'],
  buildPrompt: context => buildStylePrompt(context),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildStylePrompt(context),
    ),
};
