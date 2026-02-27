import { createHash } from 'node:crypto';
import type {
  ExecutionPlan,
  ExecutionTask,
  ExternalDependencyChecklist,
  PlanGenerationInput,
  UIBlueprint,
} from './types';
import { normalizeTaskDependencies, validateUniqueTaskIds } from './scheduler.js';

const UI_LIBRARY_PACKAGE_MAP: Record<string, string> = {
  shadcn: '@radix-ui/react-slot',
  antd: 'antd',
  mui: '@mui/material',
  'chakra-ui': '@chakra-ui/react',
  mantine: '@mantine/core',
  bootstrap: 'bootstrap',
  tailwind: 'tailwindcss',
  'element-plus': 'element-plus',
  vuetify: 'vuetify',
  'naive-ui': 'naive-ui',
  quasar: 'quasar',
  uview: 'uview-plus',
  'ng-zorro': 'ng-zorro-antd',
  'angular-material': '@angular/material',
  'react-native-paper': 'react-native-paper',
  'native-base': 'native-base',
};

interface TaskTemplate {
  phase: ExecutionTask['phase'];
  name: string;
  description: string;
  agent: ExecutionTask['agent'];
  mode: ExecutionTask['mode'];
  priority: number;
  timeoutMs: number;
  retryLimit: number;
  dependsOnPhases?: ExecutionTask['phase'][];
  metadata?: Record<string, unknown>;
}

function hashSeed(raw: string): string {
  return createHash('sha1').update(raw).digest('hex').slice(0, 8);
}

function isRepairIntent(message: string): boolean {
  return /(修复|修正|排查|优化|fix|bug|error|issue|refactor|improve)/i.test(message);
}

function estimateMessageUnits(message: string): number {
  const cjkChars =
    message.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
      ?.length || 0;
  const latinWords = message.match(/[A-Za-z0-9][A-Za-z0-9+.#/_-]*/g)?.length || 0;
  return cjkChars + latinWords;
}

function estimateRequirementDetailScore(message: string): number {
  const units = estimateMessageUnits(message);
  const separators = message.match(/[，,、;；\n]/g)?.length || 0;
  const markers = message.match(/[:：]/g)?.length || 0;
  const bulletLines = message.match(/(^|\n)\s*(?:[-*•]|\d+\.)\s+/g)?.length || 0;

  let score = 0;
  if (units >= 18) score += 1;
  if (units >= 32) score += 1;
  if (separators >= 2) score += 1;
  if (markers >= 1) score += 1;
  if (bulletLines >= 1) score += 1;
  return score;
}

function shouldEnableRequirementBrainstorm(input: PlanGenerationInput): boolean {
  if (isRepairIntent(input.userMessage)) {
    return false;
  }
  const message = input.userMessage.trim();
  if (!message) {
    return true;
  }
  const creatorMode = input.routeDecision.mode === 'creator';
  const detailScore = estimateRequirementDetailScore(message);
  const sparsePrompt = detailScore <= 1;
  return sparsePrompt || (creatorMode && detailScore <= 2);
}

function createTaskId(planSeed: string, phase: ExecutionTask['phase'], index: number): string {
  return `task-${planSeed}-${phase}-${index + 1}`;
}

function normalizeTechStack(techStack: string[] | undefined): string[] {
  if (!techStack || techStack.length === 0) {
    return [];
  }
  return Array.from(
    new Set(
      techStack
        .map(item => item.trim().toLowerCase())
        .filter(Boolean)
        .map(item => {
          if (item.includes('next')) return 'next.js';
          if (item.includes('react native')) return 'react-native';
          if (item.includes('react')) return 'react';
          if (item.includes('vue')) return 'vue';
          if (item.includes('zustand')) return 'zustand';
          if (item.includes('tailwind')) return 'tailwindcss';
          return item;
        })
    )
  );
}

function buildDependencyChecklist(input: PlanGenerationInput): ExternalDependencyChecklist[] {
  const normalized = normalizeTechStack(input.techStack);
  const checklist: ExternalDependencyChecklist[] = [];
  const pushItem = (framework: string, packageName: string, topics: string[]) => {
    checklist.push({
      framework,
      packageName,
      topics,
      projectType: input.projectType,
    });
  };

  if (input.projectType === 'next-js' || normalized.includes('next.js')) {
    pushItem('next.js', 'next', ['app-router', 'server-components', 'data-fetching']);
  }
  if (normalized.includes('react') || input.projectType === 'react-vite') {
    pushItem('react', 'react', ['hooks', 'component-apis', 'state-management']);
  }
  if (normalized.includes('zustand')) {
    pushItem('zustand', 'zustand', ['store-creation', 'selectors', 'middleware']);
  }
  if (normalized.includes('tailwindcss')) {
    pushItem('tailwindcss', 'tailwindcss', ['utility-classes', 'responsive-design']);
  }
  const selectedUiLibrary = input.routeDecision.uiLibrarySelection?.library;
  if (selectedUiLibrary) {
    const packageName = UI_LIBRARY_PACKAGE_MAP[selectedUiLibrary] || selectedUiLibrary;
    const framework = input.routeDecision.framework || selectedUiLibrary;
    pushItem(framework, packageName, ['components', 'theming', 'migration']);
  }

  if (checklist.length === 0) {
    pushItem('react', 'react', ['hooks', 'component-apis']);
  }

  return checklist;
}

function buildUiBlueprint(input: PlanGenerationInput, brainstormRequirements: boolean): UIBlueprint {
  const routePrefix =
    input.platform === 'mobile' ? 'screen' : input.platform === 'miniprogram' ? 'page' : 'view';
  const routes: UIBlueprint['routes'] = [
    { id: `${routePrefix}-overview`, path: '/', role: 'overview-workspace' },
    { id: `${routePrefix}-worklist`, path: '/worklist', role: 'data-surface-and-actions' },
    { id: `${routePrefix}-settings`, path: '/settings', role: 'preferences-and-rules' },
  ];
  const interactions: UIBlueprint['interactions'] = [
    { id: 'filtering', requirement: 'support real-time filtering and reset', mandatory: true },
    { id: 'sorting', requirement: 'support deterministic sort behavior', mandatory: true },
    { id: 'pagination', requirement: 'support page navigation and size control', mandatory: true },
    { id: 'selection', requirement: 'support row/item selection and bulk action', mandatory: true },
    { id: 'status-transition', requirement: 'support status transition action with feedback', mandatory: true },
    {
      id: 'async-submit',
      requirement: 'support asynchronous submission with loading and completion feedback',
      mandatory: true,
    },
  ];
  const states: UIBlueprint['states'] = [
    { id: 'idle', description: 'default idle state', mandatory: true },
    { id: 'loading', description: 'request in progress', mandatory: true },
    { id: 'empty', description: 'empty data set handling', mandatory: true },
    { id: 'error', description: 'recoverable error with retry', mandatory: true },
    { id: 'success', description: 'operation success feedback', mandatory: true },
    { id: 'editing', description: 'editing lifecycle state', mandatory: true },
  ];
  const forms: UIBlueprint['forms'] = [
    {
      id: 'primary-editor',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'owner', type: 'text', required: true },
        { name: 'group', type: 'text', required: true },
        { name: 'score', type: 'number', required: true },
        { name: 'priority', type: 'select', required: true },
      ],
      validation: 'required fields + invalid input feedback + submit guard',
    },
  ];

  if (brainstormRequirements) {
    interactions.push({
      id: 'cross-view-linkage',
      requirement: 'support interaction linkage between multiple views',
      mandatory: true,
    });
    routes.push({
      id: `${routePrefix}-analysis`,
      path: '/analysis',
      role: 'secondary-analysis-view',
    });
  }

  return {
    version: 1,
    intent: 'generic-interactive-application',
    modules: ['overview', 'worklist', 'workflow', 'quality'],
    routes,
    interactions,
    states,
    forms,
    acceptanceGates: {
      minViewCount: brainstormRequirements ? 3 : 2,
      minDataSurfaceCount: 1,
      minFormFlowCount: 1,
      requireValidationFeedback: true,
      requireExplicitStateTransitions: true,
    },
  };
}

function buildTemplates(input: PlanGenerationInput): TaskTemplate[] {
  if (isRepairIntent(input.userMessage)) {
    return [
      {
        phase: 'repair',
        name: 'targeted-repair',
        description: 'Generate targeted fixes for detected issues',
        agent: 'RepairAgent',
        mode: 'serial',
        priority: 100,
        timeoutMs: 90_000,
        retryLimit: 1,
      },
      {
        phase: 'quality',
        name: 'quality-recheck',
        description: 'Re-evaluate quality after targeted fixes',
        agent: 'QualityAgent',
        mode: 'serial',
        priority: 90,
        timeoutMs: 60_000,
        retryLimit: 0,
        dependsOnPhases: ['repair'],
      },
    ];
  }

  const dependencyChecklist = buildDependencyChecklist(input);
  const brainstormRequirements = shouldEnableRequirementBrainstorm(input);
  const uiBlueprint = buildUiBlueprint(input, brainstormRequirements);
  const baseTemplates: TaskTemplate[] = [
    {
      phase: 'design-system',
      name: 'design-system-bootstrap',
      description: 'Prepare design tokens and base UI direction',
      agent: 'DesignSystemAgent',
      mode: 'serial',
      priority: 100,
      timeoutMs: 60_000,
      retryLimit: 0,
    },
    {
      phase: 'skeleton',
      name: 'skeleton-bootstrap',
      description:
        'Materialize runtime project structure first (entry files + core folder roots), then generate shared contracts',
      agent: 'StateAgent',
      mode: 'serial',
      priority: 98,
      timeoutMs: 120_000,
      retryLimit: 1,
      dependsOnPhases: ['design-system'],
    },
    {
      phase: 'skeleton-l1-gate',
      name: 'skeleton-l1-type-gate',
      description: 'Validate structure-first skeleton completeness, then run L1 TypeScript gate (tsc --noEmit)',
      agent: 'QualityAgent',
      mode: 'serial',
      priority: 97,
      timeoutMs: 120_000,
      retryLimit: 1,
      dependsOnPhases: ['skeleton'],
    },
    {
      phase: 'contract-freeze',
      name: 'freeze-immutable-contracts',
      description: 'Freeze skeleton signatures as immutable read-only context for downstream agents',
      agent: 'StateAgent',
      mode: 'serial',
      priority: 96,
      timeoutMs: 45_000,
      retryLimit: 0,
      dependsOnPhases: ['skeleton-l1-gate'],
    },
    {
      phase: 'research',
      name: 'research-api-contracts',
      description:
        brainstormRequirements
          ? 'Run requirement-brainstorm pass first: infer missing feature modules, interaction matrix, and form/data workflows before coding; then distill API signatures/snippets with version anchors'
          : 'Search official/community references and distill API signatures/snippets with version anchors',
      agent: 'DesignSystemAgent',
      mode: 'serial',
      priority: 95,
      timeoutMs: 90_000,
      retryLimit: 1,
      dependsOnPhases: ['contract-freeze'],
      metadata: {
        dependencyChecklist,
        requirementStrategy: brainstormRequirements ? 'brainstorm' : 'direct',
        uiBlueprint,
      },
    },
    {
      phase: 'pages',
      name: 'pages',
      description: 'Generate page-level structure and layout from frozen contracts',
      agent: 'PageAgent',
      mode: 'parallel',
      priority: 90,
      timeoutMs: 180_000,
      retryLimit: 1,
      dependsOnPhases: ['research'],
    },
    {
      phase: 'interactions',
      name: 'interactions',
      description: 'Implement interaction logic from frozen contracts and research snippets',
      agent: 'InteractionAgent',
      mode: 'parallel',
      priority: 88,
      timeoutMs: 150_000,
      retryLimit: 1,
      dependsOnPhases: ['research'],
    },
    {
      phase: 'states',
      name: 'state-management',
      description: 'Fill state logic under frozen signatures without mutating shared contract shapes',
      agent: 'StateAgent',
      mode: 'parallel',
      priority: 86,
      timeoutMs: 120_000,
      retryLimit: 1,
      dependsOnPhases: ['research'],
    },
    {
      phase: 'quality',
      name: 'quality-pass',
      description: 'Apply quality checks and final polish',
      agent: 'QualityAgent',
      mode: 'serial',
      priority: 70,
      timeoutMs: 90_000,
      retryLimit: 0,
      dependsOnPhases: ['pages', 'interactions', 'states'],
    },
  ];

  const uiSelection = input.routeDecision.uiLibrarySelection;
  if (uiSelection?.library && uiSelection.source === 'explicit') {
    baseTemplates.splice(2, 0, {
      phase: 'shared-components',
      name: 'ui-library-reconcile',
      description: `Rebuild shared UI foundation for explicit library "${uiSelection.library}"`,
      agent: 'DesignSystemAgent',
      mode: 'serial',
      priority: 97,
      timeoutMs: 120_000,
      retryLimit: 1,
      dependsOnPhases: ['design-system'],
      metadata: {
        uiLibrary: uiSelection.library,
        source: uiSelection.source,
        compatible: uiSelection.compatible,
      },
    });

    const skeletonGate = baseTemplates.find(item => item.phase === 'skeleton-l1-gate');
    if (skeletonGate) {
      skeletonGate.dependsOnPhases = ['skeleton', 'shared-components'];
    }
  }

  return baseTemplates;
}

function buildTasksWithDependencies(templates: TaskTemplate[], seed: string): ExecutionTask[] {
  const tasks = templates.map((template, index) => ({
    id: createTaskId(seed, template.phase, index),
    phase: template.phase,
    name: template.name,
    description: template.description,
    agent: template.agent,
    mode: template.mode,
    dependencies: [] as string[],
    priority: template.priority,
    timeoutMs: template.timeoutMs,
    retryLimit: template.retryLimit,
    metadata: template.metadata,
  }));
  const normalizedTaskIds = validateUniqueTaskIds(tasks);
  const normalizedTasks = tasks.map((task, index) => ({
    ...task,
    id: normalizedTaskIds[index],
  }));

  const tasksByPhase = new Map<ExecutionTask['phase'], ExecutionTask[]>();
  for (const task of normalizedTasks) {
    const list = tasksByPhase.get(task.phase) || [];
    list.push(task);
    tasksByPhase.set(task.phase, list);
  }

  return normalizedTasks.map(task => {
    const template = templates.find(item => item.phase === task.phase && item.name === task.name);
    if (!template?.dependsOnPhases || template.dependsOnPhases.length === 0) {
      return task;
    }
    const dependencies = template.dependsOnPhases.flatMap(phase =>
      (tasksByPhase.get(phase) || []).map(candidate => candidate.id)
    );
    return {
      ...task,
      dependencies: normalizeTaskDependencies({ dependencies }),
    };
  });
}

/**
 * 鐢熸垚 Layer1 鍙墽琛岃鍒掞紙鏈€灏忓彲杩愯楠ㄦ灦锛? */
export function generateExecutionPlan(input: PlanGenerationInput): ExecutionPlan {
  const createdAt = Date.now();
  const seed = hashSeed(
    [
      input.userMessage.trim().toLowerCase(),
      input.routeDecision.agentId,
      input.routeDecision.mode,
      input.platform ?? 'unknown-platform',
      input.projectType ?? 'unknown-project-type',
    ].join('|')
  );

  const brainstormRequirements = shouldEnableRequirementBrainstorm(input);
  const uiBlueprint = buildUiBlueprint(input, brainstormRequirements);
  const templates = buildTemplates(input);
  const tasks = buildTasksWithDependencies(templates, seed);
  const maxIterations = isRepairIntent(input.userMessage) ? 2 : brainstormRequirements ? 6 : 5;

  return {
    id: `plan-${seed}`,
    createdAt,
    userMessage: input.userMessage,
    routeDecision: input.routeDecision,
    maxIterations,
    replanPolicy: {
      maxReplanDepth: 2,
    },
    tasks,
    metadata: {
      platform: input.platform,
      techStack: input.techStack,
      projectType: input.projectType,
      requirementStrategy: brainstormRequirements ? 'brainstorm' : 'direct',
      uiBlueprint,
    },
  };
}
