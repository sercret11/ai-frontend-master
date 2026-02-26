import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from './runner';

function buildRepairPrompt(userMessage: string): string {
  return [
    'You are RepairAgent.',
    'Apply targeted fixes for failed quality gates and runtime issues.',
    'Minimize scope while preserving architecture constraints.',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const repairAgent: RuntimeAgent = {
  id: 'repair-agent',
  title: 'Repair Agent',
  defaultGoal: 'repair failed gates and unblock delivery',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write', 'bash'],
  buildPrompt: context => buildRepairPrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildRepairPrompt(context.userMessage)
    ),
};

