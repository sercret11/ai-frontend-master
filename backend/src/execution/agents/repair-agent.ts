import type { RuntimeAgent } from '../../runtime/multi-agent/types';
import { runLlmBackedAgent } from '../../agents/runtime/runner';
import { buildExecutionContractSection } from './prompt-context';

function buildRepairPrompt(context: Parameters<RuntimeAgent['buildPrompt']>[0]): string {
  return [
    'You are RepairAgent (Execution Layer).',
    'Apply targeted fixes for quality gate failures and runtime issues.',
    'You must emit concrete write/apply_diff tool calls. Narrative-only output is invalid.',
    '',
    'Responsibilities:',
    '- Fix missing files and broken imports reported by quality-agent',
    '- Resolve runtime/type/build failures with minimal necessary changes',
    '- Preserve analysis-contract semantics while repairing',
    '- Eliminate generic placeholder-only pages and interactions if flagged',
    '',
    'Constraints:',
    '- Keep fix scope focused and deterministic.',
    '- Only address issues identified by quality-agent or artifact gate signals.',
    '- Use bash to verify fixes compile and pass checks before finishing.',
    '- Preserve router bootstrapping invariants: if src/main.tsx mounts RouterProvider/BrowserRouter, do not mount another router wrapper inside App/route modules.',
    '- Preserve module import/export contracts: read target modules first and match named/default exports when fixing imports.',
    '- Prefer surgical diffs; do not rewrite App/main/router files wholesale unless the issue explicitly requires it.',
    '',
    buildExecutionContractSection(context),
  ].join('\n');
}

export const repairAgent: RuntimeAgent = {
  id: 'repair-agent',
  title: 'Repair Agent',
  defaultGoal: 'repair quality gate failures and fix runtime issues',
  fallbackAgentId: 'frontend-implementer',
  allowedTools: ['read', 'grep', 'glob', 'apply_diff', 'write', 'bash'],
  buildPrompt: context => buildRepairPrompt(context),
  run: async context =>
    runLlmBackedAgent(
      context,
      'frontend-implementer',
      buildRepairPrompt(context),
    ),
};
