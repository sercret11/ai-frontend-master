import { describe, expect, it } from 'vitest';
import { evaluateReflection } from './reflection-evaluator';
import type { ExecutionPlan, TaskExecutionResult } from './types';

function buildPlan(): ExecutionPlan {
  return {
    id: 'plan-reflection-test',
    createdAt: Date.now(),
    userMessage: '生成web端的外卖后台管理系统',
    routeDecision: {
      agentId: 'frontend-creator',
      mode: 'creator',
      source: 'auto',
      confidence: 0.9,
    },
    maxIterations: 4,
    replanPolicy: {
      maxReplanDepth: 2,
    },
    metadata: {
      platform: 'web',
    },
    tasks: [
      {
        id: 'task-pages',
        phase: 'pages',
        name: 'pages',
        description: 'Implement pages',
        agent: 'PageAgent',
        mode: 'parallel',
        dependencies: [],
        priority: 90,
        timeoutMs: 60000,
        retryLimit: 1,
      },
      {
        id: 'task-interactions',
        phase: 'interactions',
        name: 'interactions',
        description: 'Implement interactions',
        agent: 'InteractionAgent',
        mode: 'parallel',
        dependencies: ['task-pages'],
        priority: 90,
        timeoutMs: 60000,
        retryLimit: 1,
      },
      {
        id: 'task-states',
        phase: 'states',
        name: 'states',
        description: 'Implement states',
        agent: 'StateAgent',
        mode: 'parallel',
        dependencies: ['task-interactions'],
        priority: 80,
        timeoutMs: 60000,
        retryLimit: 1,
      },
      {
        id: 'task-quality',
        phase: 'quality',
        name: 'quality',
        description: 'Quality checks',
        agent: 'QualityAgent',
        mode: 'serial',
        dependencies: ['task-states'],
        priority: 95,
        timeoutMs: 60000,
        retryLimit: 0,
      },
    ],
  };
}

function buildCompletedResults(): TaskExecutionResult[] {
  return ['task-pages', 'task-interactions', 'task-states', 'task-quality'].map(taskId => ({
    taskId,
    status: 'completed' as const,
  }));
}

describe('reflection-evaluator quality gate', () => {
  it('forces iteration for scaffold-level output under strict prototype intent', () => {
    const reflection = evaluateReflection({
      plan: buildPlan(),
      taskResults: buildCompletedResults(),
      filesGenerated: 7,
      passScore: 90,
      promptMessage: '生成web端的外卖后台管理系统',
      touchedFilePaths: ['src/main.tsx', 'src/App.tsx', 'src/index.css'],
      generatedArtifacts: [
        {
          path: 'src/App.tsx',
          content: `export default function App(){ return <h1>Welcome</h1>; }`,
        },
        {
          path: 'src/main.tsx',
          content: `import ReactDOM from 'react-dom/client';`,
        },
      ],
    });

    expect(reflection.shouldIterate).toBe(true);
    expect(reflection.issues.some(issue => issue.code === 'LOW_INTERACTION_COMPLEXITY')).toBe(true);
    expect(reflection.issues.some(issue => issue.code === 'MISSING_FORM_FLOW')).toBe(true);
    expect(reflection.issues.some(issue => issue.code === 'MISSING_DATA_SURFACE')).toBe(true);
  });

  it('accepts when interaction coverage and artifacts satisfy quality gate', () => {
    const reflection = evaluateReflection({
      plan: buildPlan(),
      taskResults: buildCompletedResults(),
      filesGenerated: 14,
      passScore: 90,
      promptMessage: '生成web端的外卖后台管理系统',
      touchedFilePaths: [
        'src/layout/AppShell.tsx',
        'src/routes/index.tsx',
        'src/pages/DashboardPage.tsx',
        'src/pages/WorkListPage.tsx',
        'src/components/WorkTable.tsx',
        'src/components/WorkFormModal.tsx',
        'src/store/useWorkStore.ts',
        'src/services/work-api.ts',
      ],
      generatedArtifacts: [
        {
          path: 'src/layout/AppShell.tsx',
          content: `<aside>menu</aside><nav>topbar</nav>`,
        },
        {
          path: 'src/routes/index.tsx',
          content: `createBrowserRouter([{ path: '/', element: <DashboardPage /> }, { path: '/worklist', element: <WorkListPage /> }])`,
        },
        {
          path: 'src/components/WorkTable.tsx',
          content: `<table><thead><tr><th>name</th></tr></thead><tbody></tbody></table> const columns = [];`,
        },
        {
          path: 'src/components/WorkFormModal.tsx',
          content: `<form onSubmit={onSubmit}><input required /><button type='submit'>save</button></form>`,
        },
        {
          path: 'src/store/useWorkStore.ts',
          content: `const [filter, setFilter] = useState(''); const submit = async () => { await fetch('/api/items'); };`,
        },
      ],
    });

    expect(reflection.shouldIterate).toBe(false);
    expect(reflection.score).toBeGreaterThanOrEqual(90);
  });

  it('rejects placeholder-heavy artifacts even when other signals exist', () => {
    const reflection = evaluateReflection({
      plan: buildPlan(),
      taskResults: buildCompletedResults(),
      filesGenerated: 16,
      passScore: 90,
      promptMessage: '生成web端的外卖后台管理系统',
      touchedFilePaths: [
        'src/layout/AppShell.tsx',
        'src/routes/index.tsx',
        'src/pages/DashboardPage.tsx',
        'src/pages/ModulePage.tsx',
        'src/components/WorkTable.tsx',
        'src/components/WorkFormModal.tsx',
        'src/store/useWorkStore.ts',
      ],
      generatedArtifacts: [
        {
          path: 'src/layout/AppShell.tsx',
          content: `<aside>menu</aside><nav>topbar</nav>`,
        },
        {
          path: 'src/routes/index.tsx',
          content: `createBrowserRouter([{ path: '/', element: <DashboardPage /> }, { path: '/module', element: <ModulePage /> }])`,
        },
        {
          path: 'src/components/WorkTable.tsx',
          content: `<table><thead><tr><th>name</th></tr></thead><tbody></tbody></table>`,
        },
        {
          path: 'src/components/WorkFormModal.tsx',
          content: `<form onSubmit={onSubmit}><input required /><button type='submit'>save</button></form>`,
        },
        {
          path: 'src/pages/ModulePage.tsx',
          content: `export default function ModulePage(){ return <div>模块列表占位，可扩展增删改查</div>; }`,
        },
      ],
    });

    expect(reflection.shouldIterate).toBe(true);
    expect(reflection.issues.some(issue => issue.code === 'PLACEHOLDER_CONTENT_DETECTED')).toBe(true);
  });

  it('rejects standalone html artifact output for strict prototype runs', () => {
    const reflection = evaluateReflection({
      plan: buildPlan(),
      taskResults: buildCompletedResults(),
      filesGenerated: 1,
      passScore: 90,
      promptMessage: '生成web端应用原型',
      touchedFilePaths: ['web-delivery-admin.html'],
      generatedArtifacts: [
        {
          path: 'web-delivery-admin.html',
          content: '<!doctype html><html><body><main>prototype</main></body></html>',
        },
      ],
    });

    expect(reflection.shouldIterate).toBe(true);
    expect(reflection.issues.some(issue => issue.code === 'STANDALONE_HTML_ARTIFACT')).toBe(true);
  });
});
