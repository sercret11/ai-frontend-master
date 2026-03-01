import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisLayer } from '../analysis-layer.js';
import type {
  AnalysisAgent,
  AnalysisAgentID,
  AnalysisLayerInput,
  SessionDocument,
} from '../types.js';
import type { RuntimeEvent, RuntimeEventPayload } from '@ai-frontend/shared-types';
import type { LLMClient } from '../../llm/client.js';

const AGENT_IDS: AnalysisAgentID[] = [
  'product-manager',
  'frontend-architect',
  'ui-expert',
  'ux-expert',
];

function buildDocument(agentId: AnalysisAgentID, raw: string): SessionDocument {
  const createdAt = Date.now();
  switch (agentId) {
    case 'product-manager':
      return {
        id: `doc-${agentId}`,
        agentId,
        createdAt,
        version: 1,
        content: {
          functionalRequirements: [
            { id: 'fr-1', title: raw, description: raw, priority: 'high' },
          ],
          userStories: [
            { id: 'us-1', persona: 'admin', goal: raw, benefit: 'efficiency' },
          ],
          priorityOrder: ['fr-1'],
        },
      };
    case 'frontend-architect':
      return {
        id: `doc-${agentId}`,
        agentId,
        createdAt,
        version: 1,
        content: {
          componentTree: [
            { id: 'c-1', name: 'App', type: 'page', children: [] },
          ],
          routeDesign: [{ path: '/', componentId: 'c-1' }],
          stateManagement: {
            approach: 'zustand',
            stores: [{ name: 'app', description: raw, fields: { count: 'number' } }],
          },
        },
      };
    case 'ui-expert':
      return {
        id: `doc-${agentId}`,
        agentId,
        createdAt,
        version: 1,
        content: {
          visualSpec: {
            colorScheme: 'light',
            typography: { heading: 'Inter', body: 'Inter' },
            spacing: { md: '16px' },
            borderRadius: '8px',
          },
          componentStyles: [{ componentId: 'c-1', styles: { color: '#111' } }],
          responsiveLayout: {
            breakpoints: { md: 768 },
            strategy: 'mobile-first',
          },
        },
      };
    case 'ux-expert':
      return {
        id: `doc-${agentId}`,
        agentId,
        createdAt,
        version: 1,
        content: {
          interactionFlows: [
            {
              id: 'flow-1',
              name: raw,
              steps: [{ action: 'click', expectedResult: 'navigate' }],
            },
          ],
          userJourneys: [
            {
              id: 'journey-1',
              persona: 'admin',
              touchpoints: ['dashboard'],
              painPoints: [],
            },
          ],
          usabilityRecommendations: [
            { area: 'navigation', recommendation: raw, priority: 'high' },
          ],
        },
      };
  }
}

function buildAgent(agentId: AnalysisAgentID): AnalysisAgent {
  return {
    id: agentId,
    title: `Agent ${agentId}`,
    buildPrompt: () => `prompt-${agentId}`,
    parseOutput: (raw: string) => buildDocument(agentId, raw),
  };
}

function okResponse(text: string) {
  return {
    text,
    toolCalls: [],
    finishReason: 'stop' as const,
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
  };
}

function createMockEmitter() {
  return (event: RuntimeEventPayload): RuntimeEvent =>
    ({
      id: `evt-${Date.now()}`,
      timestamp: Date.now(),
      ...event,
    }) as unknown as RuntimeEvent;
}

function createInput(): AnalysisLayerInput {
  return {
    sessionId: 'session-retry-test',
    userMessage: '生成web端的外卖后台管理系统',
    platform: 'web',
    techStack: ['React', 'TypeScript'],
    abortSignal: new AbortController().signal,
    emitRuntimeEvent: createMockEmitter(),
  };
}

function createLayer(mockComplete: ReturnType<typeof vi.fn>): AnalysisLayer {
  const llmClient = {
    complete: mockComplete,
    completeStreaming: mockComplete,
  } as unknown as LLMClient;

  const layer = new AnalysisLayer({
    llmClient,
    provider: 'openai',
    model: 'test-model',
  });
  (layer as unknown as { agents: AnalysisAgent[] }).agents = AGENT_IDS.map(buildAgent);
  return layer;
}

function makeError(
  message: string,
  extras: Record<string, unknown> = {},
): Error & Record<string, unknown> {
  return Object.assign(new Error(message), extras);
}

describe('AnalysisLayer timeout budget', () => {
  const originalTimeout = process.env.ANALYSIS_AGENT_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.ANALYSIS_AGENT_TIMEOUT_MS;
      return;
    }
    process.env.ANALYSIS_AGENT_TIMEOUT_MS = originalTimeout;
  });

  it('uses the default timeout for analysis agents', () => {
    delete process.env.ANALYSIS_AGENT_TIMEOUT_MS;
    const layer = createLayer(vi.fn(async () => okResponse('ok')));
    expect((layer as unknown as { agentTimeoutMs: number }).agentTimeoutMs).toBe(240000);
  });

  it('clamps oversized timeout values to prevent unbounded waits', () => {
    process.env.ANALYSIS_AGENT_TIMEOUT_MS = '9999999';
    const layer = createLayer(vi.fn(async () => okResponse('ok')));
    expect((layer as unknown as { agentTimeoutMs: number }).agentTimeoutMs).toBe(600000);
  });

  it('clamps tiny timeout values to a safe floor', () => {
    process.env.ANALYSIS_AGENT_TIMEOUT_MS = '1000';
    const layer = createLayer(vi.fn(async () => okResponse('ok')));
    expect((layer as unknown as { agentTimeoutMs: number }).agentTimeoutMs).toBe(30000);
  });
});

describe('AnalysisLayer transient retry', () => {
  it('retries once for transient network failure and continues pipeline', async () => {
    let calls = 0;
    const mockComplete = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw makeError('fetch failed', { statusCode: 0 });
      }
      return okResponse(`response-${calls}`);
    });
    const layer = createLayer(mockComplete);

    const result = await layer.run(createInput());

    expect(result.success).toBe(true);
    expect(result.documents).toHaveLength(4);
    expect(mockComplete).toHaveBeenCalledTimes(5);
    expect(mockComplete.mock.calls[0][0].systemPrompt).toBe('prompt-product-manager');
    expect(mockComplete.mock.calls[1][0].systemPrompt).toBe('prompt-product-manager');
  });

  it('does not retry for non-transient errors', async () => {
    const mockComplete = vi.fn(async () => {
      throw makeError('invalid request', { statusCode: 400 });
    });
    const layer = createLayer(mockComplete);

    const result = await layer.run(createInput());

    expect(result.success).toBe(false);
    expect(result.failedAgentId).toBe('product-manager');
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it('falls back to synthesized documents after transient retry exhaustion', async () => {
    const mockComplete = vi.fn(async () => {
      throw makeError('fetch failed', { statusCode: 0 });
    });
    const layer = createLayer(mockComplete);

    const result = await layer.run(createInput());

    expect(result.success).toBe(true);
    expect(result.failedAgentId).toBeUndefined();
    expect(result.documents).toHaveLength(4);
    expect(mockComplete).toHaveBeenCalledTimes(8);
    expect(result.documents.some(doc => doc.id.startsWith('fallback-'))).toBe(true);
  });
});
