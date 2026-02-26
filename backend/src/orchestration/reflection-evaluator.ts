import type { ExecutionPlan, Reflection, ReflectionIssue, TaskExecutionResult } from './types';

export interface ReflectionEvaluationInput {
  plan: ExecutionPlan;
  taskResults: TaskExecutionResult[];
  filesGenerated?: number;
  filesGeneratedInIteration?: number;
  passScore?: number;
  promptMessage?: string;
  touchedFilePaths?: string[];
  generatedArtifacts?: Array<{
    path: string;
    content?: string;
  }>;
}

function clampScore(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

interface InteractionSignalResult {
  strictPrototypeRequired: boolean;
  signalCoverage: number;
  viewFileCount: number;
  hasStandaloneHtmlOnly: boolean;
  hasLayoutShell: boolean;
  hasRouteStructure: boolean;
  hasDataSurface: boolean;
  hasFormFlow: boolean;
  hasValidation: boolean;
  hasStateManagement: boolean;
  hasAsyncInteraction: boolean;
  hasMultipleViews: boolean;
  hasPlaceholderContent: boolean;
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

function inferStrictPrototypeRequirement(input: ReflectionEvaluationInput): boolean {
  const routeMode = input.plan.routeDecision.mode;
  const platform = input.plan.metadata?.platform || 'web';
  if (routeMode !== 'creator') return false;
  return platform === 'web' || platform === 'desktop';
}

function collectInteractionSignals(input: ReflectionEvaluationInput): InteractionSignalResult {
  const strictPrototypeRequired = inferStrictPrototypeRequirement(input);
  const touchedFilePaths = (input.touchedFilePaths || []).map(path => path.toLowerCase());
  const artifactPaths = (input.generatedArtifacts || [])
    .map(artifact => artifact.path.toLowerCase())
    .filter(Boolean);
  const allPaths = [...new Set([...touchedFilePaths, ...artifactPaths])];
  const nonMetaPaths = allPaths.filter(path => {
    const fileName = path.split('/').filter(Boolean).pop() || '';
    return Boolean(fileName) && !fileName.startsWith('.');
  });
  const standaloneHtmlPaths = nonMetaPaths.filter(
    path => path.endsWith('.html') && !path.endsWith('index.html')
  );
  const hasStandaloneHtmlOnly =
    strictPrototypeRequired && nonMetaPaths.length === 1 && standaloneHtmlPaths.length === 1;
  const joinedPaths = allPaths.join('\n');

  const sampledArtifactText = (input.generatedArtifacts || [])
    .map(artifact => (artifact.content || '').slice(0, 4000).toLowerCase())
    .join('\n');

  const pathOrText = (pathPatterns: RegExp[], textPatterns: RegExp[]) => {
    return includesAny(joinedPaths, pathPatterns) || includesAny(sampledArtifactText, textPatterns);
  };

  const hasLayoutShell = pathOrText(
    [/(layout|shell|sidebar|navbar|topbar|header|navigation)/i],
    [/<aside\b|<nav\b|sidebar|topbar|app[-\s]?shell|navigation/i]
  );
  const hasRouteStructure = pathOrText(
    [/(^|\/)(pages|views|routes)\//i, /router/i],
    [/createbrowserrouter|routerprovider|<route\b|react-router|useroutes/i]
  );
  const hasDataSurface = pathOrText(
    [/(table|grid|list|board|kanban|chart|analytics|stats?)/i],
    [/<table\b|datagrid|thead|tbody|columns\s*[:=]|recharts|chart/i]
  );
  const hasFormFlow = pathOrText(
    [/(form|modal|dialog|drawer|wizard|stepper|editor)/i],
    [/<form\b|onsubmit|useform|react-hook-form|form\.item|dialog|drawer|modal/i]
  );
  const hasValidation = pathOrText(
    [/(validator|schema|rules)/i],
    [/zod|yup|seterror|fielderrors|required\b|rules\s*=\s*\[|validation/i]
  );
  const hasStateManagement = pathOrText(
    [/(store|state|reducer|context|hooks\/use)/i],
    [/usestate|usereducer|zustand|redux|createslice|context\.provider|usememo|usecallback/i]
  );
  const hasAsyncInteraction = pathOrText(
    [/(api|service|query|mutation|actions?)/i],
    [/fetch\(|axios|await\s+|debounce|throttle|pagination|sort|filter|search|onchange|onclick/i]
  );
  const hasPlaceholderContent = includesAny(sampledArtifactText, [
    /占位|placeholder|todo|待补充|coming soon|to be implemented|可扩展/i,
  ]);

  const viewFileCount = allPaths.filter(path => {
    if (/(^|\/)(pages|views|routes)\//i.test(path)) return true;
    return /\/(dashboard|overview|list|detail|settings|workspace|home)\.(tsx?|jsx?)$/i.test(path);
  }).length;
  const hasMultipleViews = viewFileCount >= 2;

  const signalFlags = [
    hasLayoutShell,
    hasRouteStructure,
    hasDataSurface,
    hasFormFlow,
    hasValidation,
    hasStateManagement,
    hasAsyncInteraction,
    hasMultipleViews,
  ];
  const signalCoverage = clampScore((signalFlags.filter(Boolean).length / signalFlags.length) * 100);

  return {
    strictPrototypeRequired,
    signalCoverage,
    viewFileCount,
    hasStandaloneHtmlOnly,
    hasLayoutShell,
    hasRouteStructure,
    hasDataSurface,
    hasFormFlow,
    hasValidation,
    hasStateManagement,
    hasAsyncInteraction,
    hasMultipleViews,
    hasPlaceholderContent,
  };
}

function findMissingCriticalPhases(input: ReflectionEvaluationInput): string[] {
  const phaseByTaskId = new Map(input.plan.tasks.map(task => [task.id, task.phase] as const));
  const completedPhases = new Set(
    input.taskResults
      .filter(result => result.status === 'completed')
      .map(result => phaseByTaskId.get(result.taskId))
      .filter((phase): phase is NonNullable<typeof phase> => Boolean(phase))
  );
  const criticalPhases = ['pages', 'interactions', 'states', 'quality'] as const;
  return criticalPhases.filter(phase => {
    const existsInPlan = input.plan.tasks.some(task => task.phase === phase);
    return existsInPlan && !completedPhases.has(phase);
  });
}

function pushInteractionIssues(issues: ReflectionIssue[], signals: InteractionSignalResult): void {
  if (!signals.strictPrototypeRequired) return;

  if (!signals.hasDataSurface) {
    issues.push({
      code: 'MISSING_DATA_SURFACE',
      message: 'Prototype is missing a meaningful data surface (table/list/grid/chart)',
      severity: 'error',
      suggestion: 'Add at least one data-heavy view with sortable/filterable records',
    });
  }
  if (!signals.hasFormFlow) {
    issues.push({
      code: 'MISSING_FORM_FLOW',
      message: 'Prototype is missing create/edit form interaction flow',
      severity: 'error',
      suggestion: 'Add modal/drawer/page form with submit and cancel actions',
    });
  }
  if (!signals.hasStateManagement) {
    issues.push({
      code: 'MISSING_STATE_MANAGEMENT',
      message: 'Prototype lacks explicit interactive state management',
      severity: 'warning',
      suggestion: 'Add controlled state for filters, panel visibility, and editing lifecycle',
    });
  }
  if (!signals.hasValidation) {
    issues.push({
      code: 'MISSING_FORM_VALIDATION',
      message: 'Form validation and error feedback are not clearly implemented',
      severity: 'warning',
      suggestion: 'Add required-field and invalid-input feedback with visible error states',
    });
  }
  if (!signals.hasLayoutShell) {
    issues.push({
      code: 'MISSING_LAYOUT_SHELL',
      message: 'Prototype lacks a dashboard shell structure (navigation + workspace)',
      severity: 'warning',
      suggestion: 'Implement sidebar/topbar layout and route-level workspace sections',
    });
  }
  if (signals.hasStandaloneHtmlOnly) {
    issues.push({
      code: 'STANDALONE_HTML_ARTIFACT',
      message: 'Detected standalone HTML artifact output; expected a multi-file frontend runtime project',
      severity: 'error',
      suggestion: 'Generate runtime project files under src/ plus required root configs instead of single HTML file',
    });
  }
  if (!signals.hasMultipleViews) {
    issues.push({
      code: 'INSUFFICIENT_VIEW_COVERAGE',
      message: `Only ${signals.viewFileCount} route/view file detected; expected at least 2`,
      severity: 'warning',
      suggestion: 'Add multiple view modules and route switching to represent real workflow',
    });
  }
  if (signals.signalCoverage < 80) {
    issues.push({
      code: 'LOW_INTERACTION_COMPLEXITY',
      message: `Interaction coverage is only ${signals.signalCoverage}%`,
      severity: 'error',
      suggestion: 'Expand interaction matrix: list actions, filters, forms, status transitions, and feedback states',
    });
  }
  if (signals.hasPlaceholderContent) {
    issues.push({
      code: 'PLACEHOLDER_CONTENT_DETECTED',
      message: 'Prototype still contains placeholder content instead of concrete workflow implementation',
      severity: 'error',
      suggestion: 'Replace all placeholder sections with concrete CRUD/data-flow interactions and real state transitions',
    });
  }
}

export function evaluateReflection(input: ReflectionEvaluationInput): Reflection {
  const totalTasks = input.plan.tasks.length;
  const resultMap = new Map(input.taskResults.map(result => [result.taskId, result]));
  const completedTasks = [...resultMap.values()].filter(result => result.status === 'completed').length;
  const failedResults = [...resultMap.values()].filter(result => result.status === 'failed');
  const skippedTasks = [...resultMap.values()].filter(result => result.status === 'skipped').length;
  const filesGenerated = input.filesGenerated ?? 0;
  const filesGeneratedInIteration = input.filesGeneratedInIteration ?? filesGenerated;
  const signals = collectInteractionSignals(input);
  const missingCriticalPhases = findMissingCriticalPhases(input);

  const completionRatio = totalTasks > 0 ? completedTasks / totalTasks : 0;
  const missingPhasePenalty = missingCriticalPhases.length * 8;
  const coverageBaseline = signals.strictPrototypeRequired ? 80 : 58;
  const coveragePenalty = Math.max(0, coverageBaseline - signals.signalCoverage);
  const lowFilePenalty = signals.strictPrototypeRequired
    ? filesGenerated < 10
      ? 12
      : 0
    : filesGenerated < 6
      ? 6
      : 0;

  const demandMatch = clampScore(completionRatio * 100 - missingCriticalPhases.length * 10);
  const consistency = clampScore(
    100 - failedResults.length * 18 - skippedTasks * 5 - Math.round(coveragePenalty * 0.25)
  );
  const codeQuality = clampScore(
    70 +
      Math.min(filesGenerated, 25) -
      failedResults.length * 15 -
      coveragePenalty -
      lowFilePenalty -
      missingPhasePenalty
  );
  const bestPractice = clampScore(
    75 +
      Math.min(completedTasks, 5) * 4 -
      failedResults.length * 12 -
      Math.round(coveragePenalty * 0.7) -
      missingPhasePenalty
  );

  const score = clampScore(
    demandMatch * 0.3 +
      consistency * 0.2 +
      codeQuality * 0.25 +
      bestPractice * 0.15 +
      signals.signalCoverage * 0.1
  );
  const passScore = input.passScore ?? 90;

  const issues: ReflectionIssue[] = failedResults.map(result => ({
    code: 'TASK_FAILED',
    message: result.error || `Task failed: ${result.taskId}`,
    severity: 'error',
    taskId: result.taskId,
    suggestion: 'Add a targeted repair task for this phase and re-run quality checks',
  }));

  if (filesGenerated === 0) {
    issues.push({
      code: 'NO_FILES_GENERATED',
      message: 'No file output was observed in this run',
      severity: 'warning',
      suggestion: 'Verify scaffold/write/apply_diff path and ensure at least one artifact is emitted',
    });
  }

  for (const phase of missingCriticalPhases) {
    issues.push({
      code: 'PHASE_NOT_COMPLETED',
      message: `Critical phase "${phase}" is not completed`,
      severity: 'warning',
      suggestion: 'Continue autonomous iteration until this phase reaches completed status',
    });
  }

  if (signals.strictPrototypeRequired && filesGenerated < 10) {
    issues.push({
      code: 'INSUFFICIENT_ARTIFACT_VOLUME',
      message: `Only ${filesGenerated} generated/updated files were observed`,
      severity: 'warning',
      suggestion: 'Expand implementation breadth to include routed views, interactive components, and forms',
    });
  }

  if (signals.strictPrototypeRequired && filesGeneratedInIteration === 0) {
    issues.push({
      code: 'NO_INCREMENTAL_FILE_CHANGES',
      message: 'No incremental file updates were generated in this iteration',
      severity: 'error',
      suggestion: 'Emit concrete write/apply_diff tool calls that modify route, data-surface, and form files',
    });
  }

  pushInteractionIssues(issues, signals);

  const strictGateFailed =
    signals.strictPrototypeRequired &&
    (!signals.hasDataSurface ||
      !signals.hasFormFlow ||
      !signals.hasStateManagement ||
      !signals.hasMultipleViews ||
      !signals.hasRouteStructure ||
      signals.signalCoverage < 80 ||
      signals.hasPlaceholderContent ||
      signals.hasStandaloneHtmlOnly ||
      filesGeneratedInIteration === 0);

  const shouldIterate =
    score < passScore || failedResults.length > 0 || strictGateFailed || missingCriticalPhases.length > 0;
  const summary = shouldIterate
    ? `Reflection score ${score}/${passScore}, interaction coverage ${signals.signalCoverage}%: iteration recommended`
    : `Reflection score ${score}/${passScore}, interaction coverage ${signals.signalCoverage}%: accepted`;

  return {
    score,
    demandMatch,
    consistency,
    codeQuality,
    bestPractice,
    shouldIterate,
    summary,
    issues,
  };
}
