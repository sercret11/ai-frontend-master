import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';

function buildQualityPrompt(userMessage: string): string {
  return [
    'You are QualityAgent (Execution Layer).',
    'Validate the generated code for completeness, consistency, and runnability.',
    'Report concrete gaps and produce repair directives when needed.',
    '',
    'Responsibilities:',
    '- Check file completeness: all referenced files exist',
    '- Verify import consistency: all imports resolve to existing exports',
    '- Validate TypeScript types: no type errors in generated code',
    '- Check route reachability: all routes have corresponding page components',
    '- Verify component export completeness: all used components are properly exported',
    '',
    'Constraints:',
    '- Use bash to run type-checking and lint commands.',
    '- Report issues as structured findings with file path, line, and description.',
    '- Do not fix issues yourself — repair-agent handles that.',
    '',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const qualityAgent: RuntimeAgent = {
  id: 'quality-agent',
  title: 'Quality Agent',
  defaultGoal: 'validate generated code for completeness, consistency, and runnability',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'bash'],
  buildPrompt: context => buildQualityPrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildQualityPrompt(context.userMessage),
    ),
};
