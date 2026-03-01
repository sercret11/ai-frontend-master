import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';
import {
  buildExecutionContractSection,
  EXECUTION_GROUNDING_CONSTRAINTS,
} from './prompt-context';

function buildStatePrompt(context: Parameters<RuntimeAgent['buildPrompt']>[0]): string {
  return [
    'You are StateAgent (Execution Layer).',
    'Implement state management, store definitions, data flow, and custom hooks for a multi-view web prototype.',
    ...EXECUTION_GROUNDING_CONSTRAINTS,
    '',
    'Responsibilities:',
    '- Implement stores and state transitions aligned with architect state contract',
    '- Build hooks/selectors/actions for each core workflow in analysis documents',
    '- Provide explicit loading/error/success/empty state handling in data flow',
    '- Keep state serializable and deterministic with explicit boundaries',
    '',
    'Constraints:',
    '- State must drive visible UI transitions for each major workflow.',
    '- Keep side effects explicit; avoid hidden coupling between modules.',
    '',
    buildExecutionContractSection(context),
  ].join('\n');
}

export const stateAgent: RuntimeAgent = {
  id: 'state-agent',
  title: 'State Agent',
  defaultGoal: 'implement state management, store definitions, data flow, and custom hooks',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write'],
  buildPrompt: context => buildStatePrompt(context),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildStatePrompt(context),
    ),
};
