import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';
import {
  buildExecutionContractSection,
  EXECUTION_GROUNDING_CONSTRAINTS,
} from './prompt-context';

function buildScaffoldPrompt(context: Parameters<RuntimeAgent['buildPrompt']>[0]): string {
  return [
    'You are ScaffoldAgent.',
    'Generate the foundational project structure for a production-grade web prototype.',
    ...EXECUTION_GROUNDING_CONSTRAINTS,
    '',
    'Responsibilities:',
    '- package.json with correct dependencies and scripts',
    '- Entry files (main.tsx / App.tsx)',
    '- Router configuration aligned with the architect route contract',
    '- tsconfig.json with strict settings',
    '- Vite configuration (vite.config.ts)',
    '- Base directory structure (src/, src/pages/, src/components/, src/hooks/, src/styles/, src/stores/)',
    '',
    'Constraints:',
    '- Ensure the scaffold is immediately buildable with zero errors.',
    '- Do not implement detailed page content or full business logic; downstream agents handle those.',
    '- Provide sensible defaults for all configuration files.',
    '',
    buildExecutionContractSection(context),
  ].join('\n');
}

export const scaffoldAgent: RuntimeAgent = {
  id: 'scaffold-agent',
  title: 'Scaffold Agent',
  defaultGoal: 'generate project foundation: manifest, entry, routes, config, directory structure',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['write', 'apply_diff', 'read'],
  buildPrompt: context => buildScaffoldPrompt(context),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildScaffoldPrompt(context),
    ),
};
