import type {
  FrontendArchitectDocument,
  ProductManagerDocument,
  SessionDocument,
  UIExpertDocument,
  UXExpertDocument,
} from '../../analysis/types';
import type { AgentExecutionContext } from '../../runtime/multi-agent/types';

function clip(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 3)}...`;
}

function summarizeProductDocument(doc: ProductManagerDocument): string[] {
  const requirementLines = doc.content.functionalRequirements
    .slice(0, 6)
    .map(item => `- [${item.priority}] ${clip(item.title, 64)}: ${clip(item.description, 140)}`);
  const storyLines = doc.content.userStories
    .slice(0, 4)
    .map(item => `- ${clip(item.persona, 36)}: ${clip(item.goal, 120)}`);

  const lines: string[] = [];
  if (requirementLines.length > 0) {
    lines.push('Product requirements:');
    lines.push(...requirementLines);
  }
  if (storyLines.length > 0) {
    lines.push('User stories:');
    lines.push(...storyLines);
  }
  return lines;
}

function summarizeArchitectDocument(doc: FrontendArchitectDocument): string[] {
  const routeLines = doc.content.routeDesign
    .slice(0, 8)
    .map(item => `- ${item.path} -> ${item.componentId}${item.guard ? ` (guard: ${item.guard})` : ''}`);
  const storeLines = doc.content.stateManagement.stores
    .slice(0, 5)
    .map(item => `- ${item.name}: ${clip(item.description, 120)}`);

  const lines: string[] = [];
  if (routeLines.length > 0) {
    lines.push('Route contract:');
    lines.push(...routeLines);
  }
  lines.push(`State approach: ${doc.content.stateManagement.approach}`);
  if (storeLines.length > 0) {
    lines.push('State stores:');
    lines.push(...storeLines);
  }
  return lines;
}

function summarizeUIDocument(doc: UIExpertDocument): string[] {
  const typography = doc.content.visualSpec.typography;
  return [
    `Visual contract: colorScheme=${doc.content.visualSpec.colorScheme}, borderRadius=${doc.content.visualSpec.borderRadius}`,
    `Typography: heading=${typography.heading}, body=${typography.body}`,
    `Responsive strategy: ${doc.content.responsiveLayout.strategy}`,
  ];
}

function summarizeUXDocument(doc: UXExpertDocument): string[] {
  const flowLines = doc.content.interactionFlows
    .slice(0, 5)
    .map(item => `- ${item.name} (${item.steps.length} step(s))`);
  const recLines = doc.content.usabilityRecommendations
    .slice(0, 4)
    .map(item => `- [${item.priority}] ${clip(item.area, 56)}: ${clip(item.recommendation, 120)}`);

  const lines: string[] = [];
  if (flowLines.length > 0) {
    lines.push('Interaction flows:');
    lines.push(...flowLines);
  }
  if (recLines.length > 0) {
    lines.push('Usability priorities:');
    lines.push(...recLines);
  }
  return lines;
}

function summarizeDocuments(documents: SessionDocument[]): string[] {
  const lines: string[] = [];
  for (const doc of documents) {
    switch (doc.agentId) {
      case 'product-manager':
        lines.push(...summarizeProductDocument(doc));
        break;
      case 'frontend-architect':
        lines.push(...summarizeArchitectDocument(doc));
        break;
      case 'ui-expert':
        lines.push(...summarizeUIDocument(doc));
        break;
      case 'ux-expert':
        lines.push(...summarizeUXDocument(doc));
        break;
      default:
        break;
    }
  }
  return lines;
}

export function buildExecutionContractSection(context: AgentExecutionContext): string {
  const contractLines = summarizeDocuments(context.sessionDocuments ?? []);
  const lines = [
    `Task goal: ${context.task.goal}`,
    `User requirement: ${context.userMessage}`,
    contractLines.length > 0
      ? ['Analysis contract (must be implemented, not ignored):', ...contractLines].join('\n')
      : 'Analysis contract: unavailable (fallback to user requirement + task goal).',
  ];
  return lines.join('\n');
}

export const EXECUTION_GROUNDING_CONSTRAINTS: string[] = [
  '- Ground page names, routes, entities, and workflows in the analysis contract and task goal.',
  '- Do not produce a generic admin scaffold with placeholder navigation labels.',
  '- Every major route/workspace must map to a concrete user workflow from requirements.',
  '- Emit concrete write/apply_diff tool calls. Narrative-only output is invalid.',
];
