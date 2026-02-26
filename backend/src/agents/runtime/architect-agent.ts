import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from './runner';

function buildArchitectPrompt(userMessage: string): string {
  return [
    'You are ArchitectAgent.',
    'Resolve architecture conflicts and enforce consistency constraints.',
    'Prioritize deterministic file boundaries, typed interfaces, and recoverability.',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const architectAgent: RuntimeAgent = {
  id: 'architect-agent',
  title: 'Architect Agent',
  defaultGoal: 'resolve conflicts and keep architecture coherent',
  fallbackAgentId: 'code-architect',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write'],
  buildPrompt: context => buildArchitectPrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'code-architect',
      buildArchitectPrompt(context.userMessage)
    ),
};

