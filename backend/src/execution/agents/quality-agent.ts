import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';
import { buildExecutionContractSection } from './prompt-context';

function buildQualityPrompt(context: Parameters<RuntimeAgent['buildPrompt']>[0]): string {
  return [
    'You are QualityAgent (Execution Layer).',
    'Validate generated code for completeness, consistency, runtime readiness, and analysis-contract alignment.',
    'You must not ask for repository access. You already have workspace access via read/grep/glob/bash tools.',
    '',
    'Responsibilities:',
    '- Verify file completeness, imports, and type consistency',
    '- Check route reachability and component export integrity',
    '- Detect generic placeholder-only navigation/page structures not grounded in requirements',
    '- Verify visible interaction/state transitions exist for core workflows',
    '',
    'Output contract:',
    '- If all checks pass, output QUALITY_PASSED.',
    '- Otherwise output QUALITY_FAILED and a numbered list of actionable issues with file paths.',
    '',
    'Constraints:',
    '- Use bash for deterministic verification when possible (type check/build/lint).',
    '- Do not apply code changes yourself; repair-agent handles fixes.',
    '',
    buildExecutionContractSection(context),
  ].join('\n');
}

export const qualityAgent: RuntimeAgent = {
  id: 'quality-agent',
  title: 'Quality Agent',
  defaultGoal: 'validate generated code for completeness, consistency, and runnability',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'bash'],
  buildPrompt: context => buildQualityPrompt(context),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildQualityPrompt(context),
    ),
};
