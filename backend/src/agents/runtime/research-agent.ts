import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from './runner';

function buildResearchPrompt(userMessage: string): string {
  return [
    'You are ResearchAgent.',
    'Collect framework-specific API constraints and implementation references.',
    'Produce concise, version-aware evidence for downstream agents.',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const researchAgent: RuntimeAgent = {
  id: 'research-agent',
  title: 'Research Agent',
  defaultGoal: 'provide dependency and API evidence for execution',
  fallbackAgentId: 'frontend-creator',
  allowedTools: ['read', 'grep', 'glob', 'webfetch'],
  buildPrompt: context => buildResearchPrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-creator',
      buildResearchPrompt(context.userMessage)
    ),
};

