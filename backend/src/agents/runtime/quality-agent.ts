import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from './runner';

function buildQualityPrompt(userMessage: string): string {
  return [
    'You are QualityAgent.',
    'Check requirement coverage, consistency, and implementation quality.',
    'Report concrete gaps and produce repair directives when needed.',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const qualityAgent: RuntimeAgent = {
  id: 'quality-agent',
  title: 'Quality Agent',
  defaultGoal: 'validate quality gates and emit acceptance signal',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'bash'],
  buildPrompt: context => buildQualityPrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildQualityPrompt(context.userMessage)
    ),
};

