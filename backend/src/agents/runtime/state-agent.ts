import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from './runner';

function buildStatePrompt(userMessage: string): string {
  return [
    'You are StateAgent.',
    'Implement state transitions, store contracts, and data synchronization for a multi-view web prototype.',
    'You must emit concrete write/apply_diff tool calls. Narrative-only output is invalid.',
    'State changes must power visible loading/empty/error/success transitions in the UI.',
    'Guarantee predictable updates with explicit boundaries and serializable state shapes.',
    'Keep naming generic and configurable; avoid hard business keywords from the prompt.',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const stateAgent: RuntimeAgent = {
  id: 'state-agent',
  title: 'State Agent',
  defaultGoal: 'implement deterministic state layer',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write'],
  buildPrompt: context => buildStatePrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildStatePrompt(context.userMessage)
    ),
};
