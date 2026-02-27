import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';

function buildScaffoldPrompt(userMessage: string): string {
  return [
    'You are ScaffoldAgent.',
    'Generate the foundational project structure for a production-grade web prototype.',
    'Your output MUST include concrete write/apply_diff tool calls. Narrative-only output is invalid.',
    '',
    'Responsibilities:',
    '- package.json with correct dependencies and scripts',
    '- Entry files (main.tsx / App.tsx)',
    '- Router configuration with placeholder routes',
    '- tsconfig.json with strict settings',
    '- Vite configuration (vite.config.ts)',
    '- Base directory structure (src/, src/pages/, src/components/, src/hooks/, src/styles/, src/stores/)',
    '',
    'Constraints:',
    '- Keep naming generic and configurable; avoid hard business keywords from the prompt.',
    '- Ensure the scaffold is immediately buildable with zero errors.',
    '- Do not implement page content or business logic — downstream agents handle that.',
    '- Provide sensible defaults for all configuration files.',
    '',
    `User requirement: ${userMessage}`,
  ].join('\n');
}

export const scaffoldAgent: RuntimeAgent = {
  id: 'scaffold-agent',
  title: 'Scaffold Agent',
  defaultGoal: 'generate project foundation: manifest, entry, routes, config, directory structure',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['write', 'apply_diff', 'read'],
  buildPrompt: context => buildScaffoldPrompt(context.userMessage),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildScaffoldPrompt(context.userMessage),
    ),
};
