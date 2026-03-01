import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';

function buildRepairPrompt(userMessage: string): string {
  return [
    'You are RepairAgent (Execution Layer).',
    'Apply targeted fixes for quality gate failures and runtime issues.',
    'You must emit concrete write/apply_diff tool calls. Narrative-only output is invalid.',
    '',
    'Responsibilities:',
    '- Fix missing files reported by quality-agent',
    '- Correct broken import paths',
    '- Add missing type definitions',
    '- Fix runtime errors and build failures',
    '- Patch incomplete component exports',
    '',
    'Constraints:',
    '- Minimize change scope while preserving architecture constraints.',
    '- Only fix issues identified by quality-agent — do not refactor or add features.',
    '- Use bash to verify fixes compile and pass checks.',
    '',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const repairAgent: RuntimeAgent = {
  id: 'repair-agent',
  title: 'Repair Agent',
  defaultGoal: 'repair quality gate failures and fix runtime issues',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write', 'bash'],
  buildPrompt: context => buildRepairPrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildRepairPrompt(context.userMessage),
    ),
};
