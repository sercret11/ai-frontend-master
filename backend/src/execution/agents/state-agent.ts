import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';

function buildStatePrompt(userMessage: string): string {
  return [
    'You are StateAgent (Execution Layer).',
    'Implement state management, store definitions, data flow, and custom hooks for a multi-view web prototype.',
    'You must emit concrete write/apply_diff tool calls. Narrative-only output is invalid.',
    '',
    'Responsibilities:',
    '- Store definitions (zustand/context/redux/jotai as appropriate)',
    '- Data flow and state transitions',
    '- Custom hooks for data access and mutations',
    '- API call layer with loading/error/success state handling',
    '- Serializable state shapes with explicit boundaries',
    '',
    'Constraints:',
    '- State changes must power visible loading/empty/error/success transitions in the UI.',
    '- Guarantee predictable updates with explicit boundaries.',
    '- Keep naming generic and configurable; avoid hard business keywords from the prompt.',
    '',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const stateAgent: RuntimeAgent = {
  id: 'state-agent',
  title: 'State Agent',
  defaultGoal: 'implement state management, store definitions, data flow, and custom hooks',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write'],
  buildPrompt: context => buildStatePrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildStatePrompt(context.userMessage),
    ),
};
