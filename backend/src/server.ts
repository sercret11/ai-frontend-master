/**
 * Backend Server - REST API + WebSocket Server
 * Complete backend service for AI Frontend Master
 *
 * Provides:
 * - REST API for session management
 * - WebSocket for real-time streaming
 * - Integration with LLM service and tool system
 * - Configuration management
 */

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import { SessionManager } from './session/manager';
import { LLMService } from './llm/index';
import { SessionStorage } from './session/storage';
import {
  FileStorage,
  InvalidFileQueryParamsError,
  isAllowedFileSortField,
  isAllowedFileSortOrder,
} from './storage/file-storage';
import { ProjectValidator } from './validation';
import { ToolRegistry } from './tool/registry';
import { Agent } from './agent/agent';
import { ModeRouter } from './prompt/router';
import { config, validateConfig, printConfig } from './config';
import { generateExecutionPlan } from './orchestration/plan-generator';
import { createExecutionSchedule } from './orchestration/scheduler';
import { evaluateReflection } from './orchestration/reflection-evaluator';
import { decideIteration } from './orchestration/iteration-controller';
import { createContractBundle, formatContractBundle } from './orchestration/contract-freezer';
import {
  clearSessionContractPolicy,
  getDefaultFrozenPrefixes,
  setSessionContractPolicy,
} from './orchestration/contract-policy';
import {
  evaluateRuntimeArtifactPath,
  filterRuntimeArtifactFiles,
  normalizeGeneratedArtifactPaths,
} from './orchestration/runtime-artifact-policy';
import { formatResearchDigest, runResearchAgent } from './orchestration/research-agent';
import { getSmartBuilder } from './context/integration/smart-builder';
import { CommandRunner } from './validation/command-runner';
import type {
  AssemblyPatch,
  AssemblyRuntimeEventPayload,
  AssemblySessionSnapshot,
  RouteDecision,
  RunTerminationReason,
  RuntimeEvent,
} from '@ai-frontend/shared-types';
import type {
  Decision,
  ExternalDependencyChecklist,
  Reflection,
  ResearchDigest,
  TaskExecutionResult,
} from './orchestration/types';
import { assemblySessionGraphService } from './rendering';
import { parseScopes, verifyJwtToken } from './auth/jwt';
import { MultiAgentKernel } from './runtime/multi-agent';
import type { RuntimeExecutionBudget } from './runtime/multi-agent/types';
import {
  createRunTerminalEventTracker,
  emitRunCompletedOnce,
  emitRunErrorOnce,
  withRunTerminalEventTracking,
} from './runtime/run-terminal-events';

// Load and validate configuration
console.log('[Server] Loading configuration...');
const validation = validateConfig();

if (!validation.valid) {
  console.error('[Server] Configuration validation failed:');
  validation.errors.forEach(error => console.error(`  [ERROR] ${error}`));
  console.error('\nPlease fix the configuration errors before starting the server.\n');
  process.exit(1);
}

// Print configuration in development
if (config.server.env === 'development') {
  printConfig();
}

const app = express();
const server = createServer(app);
const PORT = config.server.port;

function getBearerToken(req: Request): string | null {
  const header = req.header('Authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ', 2);
  if (!scheme || !value || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  return value.trim() || null;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.auth.enabled) {
    return next();
  }

  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Bearer token is required',
    });
    return;
  }

  try {
    const claims = verifyJwtToken(token, {
      secret: config.auth.jwtSecret,
      audience: config.auth.audience,
      issuer: config.auth.issuer,
    });
    req.auth = {
      claims,
      scopes: parseScopes(claims),
    };
    next();
  } catch (error) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: error instanceof Error ? error.message : 'Invalid token',
    });
  }
}

function getRequestOwnerId(req: Request): string | null {
  if (!config.auth.enabled) {
    return null;
  }
  const sub = req.auth?.claims?.sub;
  return typeof sub === 'string' && sub.trim() ? sub : null;
}

function ensureSessionAccess(req: Request, res: Response, sessionId: string): boolean {
  if (!config.auth.enabled) {
    return true;
  }
  const ownerId = getRequestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'JWT sub claim is required',
    });
    return false;
  }
  const session = SessionManager.get(sessionId);
  if (!session) {
    res.status(404).json({
      error: 'SESSION_NOT_FOUND',
      message: `Session not found: ${sessionId}`,
    });
    return false;
  }
  if (session.ownerId && session.ownerId !== ownerId) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Session does not belong to current principal',
    });
    return false;
  }
  if (!session.ownerId) {
    SessionManager.update(sessionId, { ownerId });
  }
  return true;
}

// Middleware
// Support local development and Docker environment
const allowedOrigins = [
  config.frontend.url,
  'http://localhost:5190',
  'http://127.0.0.1:5190',
  'http://localhost:5191',
  'http://127.0.0.1:5191',
  'http://localhost:5174',
  'http://localhost:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5173',
  // nginx reverse proxy origins
  'http://localhost:80',
  'http://localhost',
  'http://127.0.0.1:80',
  'http://127.0.0.1',
];

// Request logging middleware
app.use((req, res, next) => {
  const requestIdHeader = req.headers['x-request-id'];
  const requestId =
    (typeof requestIdHeader === 'string' && requestIdHeader.trim()) ||
    `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('X-Request-ID', requestId);
  console.log(
    `[REQUEST] [${requestId}] ${req.method} ${req.url} - Origin: ${req.headers.origin || 'none'}`
  );
  next();
});

// CORS configuration - must be registered before routes
app.use(
  cors({
    origin: (origin, callback) => {
      // Block requests without origin to avoid bypassing the CORS origin allowlist.
      if (!origin) {
        console.warn('[CORS] Missing origin header');
        return callback(new Error('Origin header is required'));
      }

      // Check whether origin is in the allowed list
      console.log(`[CORS] Checking origin: ${origin}`);

      if (allowedOrigins.includes(origin)) {
        console.log(`[CORS] Origin allowed: ${origin}`);
        // Return the requesting origin instead of '*'
        return callback(null, origin);
      } else {
        console.warn(`[CORS] Blocking origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    // Preflight cache time (seconds)
    maxAge: 86400,
    // Allowed headers
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID'],
    // Allowed methods
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

// COOP/COEP response headers - enable SharedArrayBuffer
app.use((req, res, next) => {
  // Set Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

app.use(express.json());
app.use('/api', requireAuth);

// ============================================================================
// REST API Routes
// ============================================================================

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

/**
 * Same-origin Context7 research bridge.
 * Frontend workers call this route to avoid browser CORS issues.
 */
app.post('/api/runtime/context7/research', async (req, res) => {
  try {
    const input = isRecord(req.body) ? req.body : {};
    const dependencies = parseDependencyChecklistInput(input.dependencies);
    if (dependencies.length === 0) {
      res.status(400).json({
        error: 'INVALID_DEPENDENCIES',
        message: 'dependencies must be a non-empty checklist array',
      });
      return;
    }

    const digest = await runResearchAgent(dependencies, {
      mcpUrl: (process.env['CONTEXT7_MCP_URL'] || '').trim() || undefined,
      mcpApiKey: (process.env['CONTEXT7_API_KEY'] || '').trim() || undefined,
    });
    res.json({
      ok: true,
      digest,
    });
  } catch (error) {
    res.status(500).json({
      error: 'CONTEXT7_RESEARCH_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Create a new session
 */
app.post('/api/sessions', async (req, res) => {
  try {
    const ownerId = getRequestOwnerId(req) || undefined;
    const input = isRecord(req.body) ? req.body : {};
    const session = await SessionManager.create({
      title: typeof input.title === 'string' ? input.title : undefined,
      agentId: typeof input.agentId === 'string' ? input.agentId : undefined,
      modelProvider: typeof input.modelProvider === 'string' ? input.modelProvider : undefined,
      modelId: typeof input.modelId === 'string' ? input.modelId : undefined,
      userMessage: typeof input.userMessage === 'string' ? input.userMessage : undefined,
      ownerId,
    });
    res.json(session);
  } catch (error) {
    console.error('[API] Failed to create session:', error);
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get a session
 */
app.get('/api/sessions/:id', (req, res) => {
  try {
    if (!ensureSessionAccess(req, res, req.params.id)) {
      return;
    }
    const session = SessionManager.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    console.error('[API] Failed to get session:', error);
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get messages for a session
 */
app.get('/api/sessions/:id/messages', (req, res) => {
  try {
    if (!ensureSessionAccess(req, res, req.params.id)) {
      return;
    }
    const messages = SessionManager.getMessages(req.params.id);
    res.json(messages);
  } catch (error) {
    console.error('[API] Failed to get messages:', error);
    res.status(500).json({ error: String(error) });
  }
});

/**
 * List all sessions
 */
app.get('/api/sessions', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const ownerId = getRequestOwnerId(req) || undefined;
    const sessions = SessionManager.listAll(limit, ownerId);
    res.json(sessions);
  } catch (error) {
    console.error('[API] Failed to list sessions:', error);
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Delete a session
 */
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const sessionID = req.params.id;
    if (!ensureSessionAccess(req, res, sessionID)) {
      return;
    }
    SessionManager.deleteSession(sessionID);

    const smartBuilder = await getSmartBuilder();
    const contextManager = (
      smartBuilder as unknown as {
        contextManager?: { deleteSession?: (id: string) => void };
      }
    ).contextManager;
    contextManager?.deleteSession?.(sessionID);
    FileStorage.deleteFiles(sessionID);

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Failed to delete session:', error);
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get files for a session (with pagination)
 */
app.get('/api/sessions/:id/files', (req, res) => {
  try {
    if (!ensureSessionAccess(req, res, req.params.id)) {
      return;
    }
    const parsedPage = req.query.page ? Number.parseInt(req.query.page as string, 10) : 1;
    const parsedLimit = req.query.limit ? Number.parseInt(req.query.limit as string, 10) : 50;
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
    const search = req.query.search as string | undefined;
    const language = req.query.language as string | undefined;
    const sortByParam = req.query.sortBy;
    const sortOrderParam = req.query.sortOrder;

    let sortBy: 'createdAt' | 'path' | 'size' | 'language' | undefined;
    if (sortByParam !== undefined) {
      if (typeof sortByParam !== 'string' || !isAllowedFileSortField(sortByParam)) {
        return res.status(400).json({
          error: `Invalid sortBy. Allowed values: createdAt, path, size, language`,
        });
      }
      sortBy = sortByParam;
    }

    let sortOrder: 'asc' | 'desc' | undefined;
    if (sortOrderParam !== undefined) {
      if (typeof sortOrderParam !== 'string' || !isAllowedFileSortOrder(sortOrderParam)) {
        return res.status(400).json({
          error: `Invalid sortOrder. Allowed values: asc, desc`,
        });
      }
      sortOrder = sortOrderParam.toLowerCase() as 'asc' | 'desc';
    }

    const result = FileStorage.getFiles(req.params.id, {
      page,
      limit,
      search,
      language,
      sortBy,
      sortOrder,
    });

    res.json(result);
  } catch (error) {
    if (error instanceof InvalidFileQueryParamsError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[API] Failed to get files:', error);
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get file statistics for a session
 */
app.get('/api/sessions/:id/files/stats', (req, res) => {
  try {
    if (!ensureSessionAccess(req, res, req.params.id)) {
      return;
    }
    const stats = FileStorage.getStats(req.params.id);
    if (!stats) {
      return res.status(404).json({ error: 'No files found for session' });
    }
    res.json(stats);
  } catch (error) {
    console.error('[API] Failed to get file stats:', error);
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Add a user message (non-streaming)
 */
app.post('/api/sessions/:id/messages', async (req, res) => {
  try {
    if (!ensureSessionAccess(req, res, req.params.id)) {
      return;
    }
    const { content } = req.body;
    const message = SessionManager.addUserMessage(req.params.id, content);
    res.json(message);
  } catch (error) {
    console.error('[API] Failed to add message:', error);
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Set SSE response headers */
function setSSEHeaders(res: express.Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

/**
 * Write SSE payload */
function writeSSEData(res: express.Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Runtime stream input validation
 */
function validateRuntimeStreamInput(message: unknown): { valid: boolean; error?: string } {
  if (typeof message !== 'string') {
    return { valid: false, error: 'message must be a string' };
  }
  if (!message.trim()) {
    return { valid: false, error: 'message cannot be empty' };
  }
  if (message.length > 10000) {
    return { valid: false, error: 'message too long (max 10000 chars)' };
  }
  return { valid: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAssemblyGraphInput(
  graph: unknown
): AssemblySessionSnapshot['graph'] | undefined {
  if (!isRecord(graph)) {
    return undefined;
  }
  return graph;
}

function normalizeAssemblyPatchInput(input: unknown): AssemblyPatch['patch'][] {
  if (Array.isArray(input)) {
    return input.filter((item): item is AssemblyPatch['patch'] => isRecord(item));
  }
  if (isRecord(input)) {
    return [input];
  }
  return [];
}

type RuntimeEventPayload = RuntimeEvent extends infer EventType
  ? EventType extends RuntimeEvent
    ? Omit<EventType, 'sessionId' | 'runId' | 'timestamp' | 'sequence'>
    : never
  : never;

type RuntimeRunCompletedPayload = Extract<RuntimeEventPayload, { type: 'run.completed' }>;
type RuntimeRunErrorPayload = Extract<RuntimeEventPayload, { type: 'run.error' }>;
type AssemblyRunCompletedPayload = Extract<AssemblyRuntimeEventPayload, { type: 'run.completed' }>;
type AssemblyRunErrorPayload = Extract<AssemblyRuntimeEventPayload, { type: 'run.error' }>;

interface RuntimeEventEmitterOptions {
  runId: string;
  getSessionId: () => string;
  emit: (event: RuntimeEvent) => void;
}

function createRuntimeEventEmitter(
  options: RuntimeEventEmitterOptions
): (event: RuntimeEventPayload) => RuntimeEvent {
  let sequence = 0;
  const stageStartAt = new Map<string, number>();
  const toolStartAt = new Map<string, number>();

  return (event: RuntimeEventPayload): RuntimeEvent => {
    const timestamp = Date.now();
    let durationMs: number | undefined = event.durationMs;

    if (event.type === 'render.pipeline.stage') {
      const stageKey = `${event.adapter}:${event.stage}:${event.parentId || ''}:${event.groupId || ''}`;
      if (event.status === 'started') {
        stageStartAt.set(stageKey, timestamp);
      } else if (durationMs === undefined) {
        const started = stageStartAt.get(stageKey);
        if (typeof started === 'number') {
          durationMs = timestamp - started;
          stageStartAt.delete(stageKey);
        }
      }
    }

    if (event.type === 'tool.call.started') {
      toolStartAt.set(event.callId, timestamp);
    }
    if (
      (event.type === 'tool.call.progress' ||
        event.type === 'tool.call.completed' ||
        event.type === 'tool.call.failed') &&
      durationMs === undefined
    ) {
      const started = toolStartAt.get(event.callId);
      if (typeof started === 'number') {
        durationMs = timestamp - started;
      }
    }
    if (event.type === 'tool.call.completed' || event.type === 'tool.call.failed') {
      toolStartAt.delete(event.callId);
    }

    sequence += 1;
    const runtimeEvent = {
      ...event,
      durationMs,
      sessionId: options.getSessionId(),
      runId: options.runId,
      sequence,
      timestamp,
    } as RuntimeEvent;

    options.emit(runtimeEvent);
    return runtimeEvent;
  };
}

interface RuntimeBudgetOverrides {
  maxIterations?: number;
  maxDurationMs?: number;
  maxToolCalls?: number;
  targetScore?: number;
}

interface RuntimeBudget {
  maxIterations: number;
  maxDurationMs: number;
  maxToolCalls: number;
  targetScore: number;
}

function parseOptionalIntegerBudget(
  field: string,
  value: unknown,
  min: number,
  max: number
): { value?: number; error?: string } {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { error: `${field} must be a finite number` };
  }

  const normalized = Math.floor(value);
  if (normalized < min || normalized > max) {
    return { error: `${field} must be between ${min} and ${max}` };
  }

  return { value: normalized };
}

function validateRuntimeBudgetInput(input: RuntimeBudgetOverrides): {
  valid: boolean;
  error?: string;
  budgetOverrides: RuntimeBudgetOverrides;
} {
  const budgetOverrides: RuntimeBudgetOverrides = {};

  const maxIterations = parseOptionalIntegerBudget('maxIterations', input.maxIterations, 1, 20);
  if (maxIterations.error) {
    return { valid: false, error: maxIterations.error, budgetOverrides };
  }
  if (typeof maxIterations.value === 'number') {
    budgetOverrides.maxIterations = maxIterations.value;
  }

  const maxDurationMs = parseOptionalIntegerBudget(
    'maxDurationMs',
    input.maxDurationMs,
    1000,
    30 * 60 * 1000
  );
  if (maxDurationMs.error) {
    return { valid: false, error: maxDurationMs.error, budgetOverrides };
  }
  if (typeof maxDurationMs.value === 'number') {
    budgetOverrides.maxDurationMs = maxDurationMs.value;
  }

  const maxToolCalls = parseOptionalIntegerBudget('maxToolCalls', input.maxToolCalls, 1, 200);
  if (maxToolCalls.error) {
    return { valid: false, error: maxToolCalls.error, budgetOverrides };
  }
  if (typeof maxToolCalls.value === 'number') {
    budgetOverrides.maxToolCalls = maxToolCalls.value;
  }

  const targetScore = parseOptionalIntegerBudget('targetScore', input.targetScore, 1, 100);
  if (targetScore.error) {
    return { valid: false, error: targetScore.error, budgetOverrides };
  }
  if (typeof targetScore.value === 'number') {
    budgetOverrides.targetScore = targetScore.value;
  }

  return { valid: true, budgetOverrides };
}

function resolveRuntimeBudget(
  budgetOverrides: RuntimeBudgetOverrides,
  plan: ReturnType<typeof generateExecutionPlan> | null
): RuntimeBudget {
  const fallbackMaxIterations = plan?.maxIterations && plan.maxIterations > 0 ? plan.maxIterations : 1;
  const maxIterations = budgetOverrides.maxIterations ?? fallbackMaxIterations;
  const maxDurationMs = budgetOverrides.maxDurationMs ?? config.streaming.maxDurationMs;
  const maxToolCalls =
    budgetOverrides.maxToolCalls ?? Math.max(config.tools.maxCallsPerMessage * maxIterations, 1);
  const targetScore = budgetOverrides.targetScore ?? 90;

  return {
    maxIterations,
    maxDurationMs,
    maxToolCalls,
    targetScore,
  };
}

function toRuntimeExecutionBudget(
  budgetOverrides: RuntimeBudgetOverrides,
): RuntimeExecutionBudget | undefined {
  const runtimeBudget: RuntimeExecutionBudget = {};

  if (typeof budgetOverrides.maxIterations === 'number') {
    runtimeBudget.maxIterations = budgetOverrides.maxIterations;
  }
  if (typeof budgetOverrides.maxDurationMs === 'number') {
    runtimeBudget.maxDurationMs = budgetOverrides.maxDurationMs;
  }
  if (typeof budgetOverrides.maxToolCalls === 'number') {
    runtimeBudget.maxToolCalls = budgetOverrides.maxToolCalls;
  }
  if (typeof budgetOverrides.targetScore === 'number') {
    runtimeBudget.targetScore = budgetOverrides.targetScore;
  }

  return Object.keys(runtimeBudget).length > 0 ? runtimeBudget : undefined;
}

function shouldEnforceRichPrototype(input: {
  userMessage: string;
  mode: 'creator' | 'implementer';
  platform?: 'web' | 'mobile' | 'desktop' | 'miniprogram';
}): boolean {
  if (!input.userMessage.trim()) return false;
  if (input.mode !== 'creator') return false;
  return input.platform !== 'mobile' && input.platform !== 'miniprogram';
}

function estimateRequirementDetailScore(message: string): number {
  const trimmed = message.trim();
  if (!trimmed) return 0;
  const cjkChars =
    trimmed.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
      ?.length || 0;
  const latinWords = trimmed.match(/[A-Za-z0-9][A-Za-z0-9+.#/_-]*/g)?.length || 0;
  const separators = trimmed.match(/[，,、;；\n]/g)?.length || 0;
  const markers = trimmed.match(/[:：]/g)?.length || 0;
  const bulletLines = trimmed.match(/(^|\n)\s*(?:[-*•]|\d+\.)\s+/g)?.length || 0;
  const units = cjkChars + latinWords;

  let score = 0;
  if (units >= 18) score += 1;
  if (units >= 32) score += 1;
  if (separators >= 2) score += 1;
  if (markers >= 1) score += 1;
  if (bulletLines >= 1) score += 1;
  return score;
}

function shouldEnableRequirementBrainstorm(userMessage: string): boolean {
  return estimateRequirementDetailScore(userMessage) <= 1;
}

function buildRequirementBrainstormPolicy(userMessage: string): string[] {
  if (!shouldEnableRequirementBrainstorm(userMessage)) {
    return [];
  }
  return [
    '- The request is underspecified. Run a requirement-brainstorm pass before coding.',
    '- Infer a complete feature blueprint (modules, routes, data surfaces, form flows, and state transitions) without asking user follow-up questions.',
    '- Keep the capability set generic and configurable; avoid domain-locked constants and hard-coded business rules.',
    '- After brainstorming, immediately materialize the blueprint via concrete file mutations (write/apply_diff).',
  ];
}

function buildRichPrototypePolicy(enabled: boolean): string[] {
  if (!enabled) {
    return [];
  }
  return [
    '- Produce a high-fidelity web prototype, not a simple scaffold or welcome page.',
    '- Must include a navigation shell and multiple route-level workspaces.',
    '- Must include interactive data surfaces and editable form workflows with validation feedback.',
    '- Must include explicit user-visible state transitions for loading, empty, error, and success states.',
    '- Output only runtime artifact files (src/, public/, assets/, styles/, package.json, tsconfig*, vite config). Do not generate notes/log/summary files.',
    '- Avoid domain-locked naming copied from user prompt. Use neutral, configurable labels and data semantics.',
    '- Keep dependency-safe imports: if a new package is required, update package.json in the same iteration; otherwise only use existing dependencies.',
    '- Deliver a complete multi-file frontend (components, routes, state/hooks, styling), not a single-file demo.',
    '- Must emit concrete write/apply_diff tool calls in this iteration; plain narrative output is invalid.',
    '- Minimum incremental delta in this iteration: update or create at least 3 files.',
    '- Keep structures and content generic/configurable; avoid domain-locked constants.',
  ];
}

function buildAutonomousIterationPrompt(
  baseMessage: string,
  iteration: number,
  reflection: Reflection,
  decision: Decision,
  options: {
    requirementBrainstormEnabled: boolean;
    enforceRichPrototype: boolean;
  }
): string {
  const issueSummary =
    reflection.issues
      .slice(0, 3)
      .map(issue => {
        const suggestionPart = issue.suggestion ? `; suggestion=${issue.suggestion}` : '';
        return `- [${issue.severity}] ${issue.message}${suggestionPart}`;
      })
      .join('\n') || '- no explicit issue reported';

  const nextTaskSummary =
    decision.nextTasks
      .slice(0, 3)
      .map(task => `- ${task.phase}: ${task.description}`)
      .join('\n') || '- improve output quality and complete missing artifacts';

  const requirementBrainstormPolicy = options.requirementBrainstormEnabled
    ? buildRequirementBrainstormPolicy(baseMessage)
    : [];
  const richPrototypePolicy = buildRichPrototypePolicy(options.enforceRichPrototype);

  return [
    baseMessage,
    '',
    `[AutonomousIteration:${iteration}] ${reflection.summary}`,
    `[ReplanDepth:${decision.replanDepth}/${decision.maxReplanDepth}] escalated=${decision.escalated}`,
    `Issues:\n${issueSummary}`,
    `NextActions:\n${nextTaskSummary}`,
    ...(requirementBrainstormPolicy.length > 0
      ? ['', '[RequirementBrainstorm]', ...requirementBrainstormPolicy]
      : []),
    ...(richPrototypePolicy.length > 0
      ? ['', '[RichPrototypeQualityGate]', ...richPrototypePolicy]
      : []),
    '- If current output is still scaffold-level, continue iterating until quality gates are satisfied.',
  ].join('\n');
}

function extractDependencyChecklist(
  plan: ReturnType<typeof generateExecutionPlan> | null
): ExternalDependencyChecklist[] {
  if (!plan) return [];
  const researchTask = plan.tasks.find(task => task.phase === 'research');
  const metadataChecklist = researchTask?.metadata?.dependencyChecklist;
  if (!Array.isArray(metadataChecklist)) {
    return [];
  }
  return metadataChecklist.filter((item): item is ExternalDependencyChecklist => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Partial<ExternalDependencyChecklist>;
    return (
      typeof candidate.framework === 'string' &&
      typeof candidate.packageName === 'string' &&
      Array.isArray(candidate.topics)
    );
  });
}

function buildBlueprintContext(plan: ReturnType<typeof generateExecutionPlan> | null): string {
  const blueprint = plan?.metadata?.uiBlueprint;
  if (!blueprint) return '';
  const compactBlueprint = {
    intent: blueprint.intent,
    modules: blueprint.modules,
    routes: blueprint.routes,
    interactions: blueprint.interactions,
    states: blueprint.states,
    forms: blueprint.forms,
    acceptanceGates: blueprint.acceptanceGates,
  };
  return [
    '[ReasoningContract:UIBlueprint]',
    'Use this blueprint as immutable execution contract.',
    JSON.stringify(compactBlueprint, null, 2),
  ].join('\n');
}

function parseDependencyChecklistInput(value: unknown): ExternalDependencyChecklist[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is ExternalDependencyChecklist => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<ExternalDependencyChecklist>;
      return (
        typeof candidate.framework === 'string' &&
        typeof candidate.packageName === 'string' &&
        Array.isArray(candidate.topics)
      );
    })
    .map(item => ({
      framework: item.framework.trim(),
      packageName: item.packageName.trim(),
      topics: item.topics.filter(topic => typeof topic === 'string').map(topic => topic.trim()),
      projectType: item.projectType,
    }))
    .filter(item => item.framework && item.packageName && item.topics.length > 0);
}

function appendImmutableContext(baseMessage: string, blocks: string[]): string {
  const validBlocks = blocks.map(item => item.trim()).filter(Boolean);
  if (validBlocks.length === 0) return baseMessage;
  return [baseMessage, '', '[ImmutableContext]', ...validBlocks].join('\n');
}

function buildSkeletonPhasePrompt(baseMessage: string): string {
  return [
    baseMessage,
    '',
    '[ExecutionPolicy]',
    '- This iteration is structure-first, then contracts.',
    '- First materialize runtime project structure by establishing a runnable manifest, a host entry surface, and a framework entry module.',
    '- Then establish shared contract roots via representative files under src/types/, src/store/, src/components/ui/, and src/routes/.',
    '- Do NOT implement page-level and interaction-level domain logic in this iteration.',
    '- Keep naming generic and configurable; avoid domain-locked constants.',
    '- Use apply_diff SEARCH/REPLACE blocks for existing files; avoid full-file rewrites.',
  ].join('\n');
}

function evaluateSkeletonStructure(sessionID: string): {
  ok: boolean;
  missingSignals: string[];
  missingDirectoryRoots: string[];
} {
  const files = FileStorage.getAllFiles(sessionID).map(file => file.path);
  const hasRuntimeManifest = files.some(filePath => /(^|\/)package\.json$/i.test(filePath));
  const hasHostEntry = files.some(filePath => filePath.toLowerCase().endsWith('.html'));
  const hasFrameworkEntry = files.some(filePath =>
    /^src\/(main|index|app)\.(tsx?|jsx?|ts|js)$/i.test(filePath)
  );
  const missingSignals = [
    !hasRuntimeManifest ? 'runtime-manifest' : '',
    !hasHostEntry ? 'host-entry-surface' : '',
    !hasFrameworkEntry ? 'framework-entry-module' : '',
  ].filter(Boolean);

  const requiredDirectoryRoots = ['src/types/', 'src/store/', 'src/components/ui/', 'src/routes/'];
  const missingDirectoryRoots = requiredDirectoryRoots.filter(
    rootPath => !files.some(filePath => filePath.startsWith(rootPath))
  );

  return {
    ok: missingSignals.length === 0 && missingDirectoryRoots.length === 0,
    missingSignals,
    missingDirectoryRoots,
  };
}

async function runSkeletonTypeGate(sessionID: string): Promise<{ ok: boolean; error?: string }> {
  let tempDir: string | null = null;
  try {
    const skeletonStructure = evaluateSkeletonStructure(sessionID);
    if (!skeletonStructure.ok) {
      const missingSignalSummary =
        skeletonStructure.missingSignals.length > 0
          ? `missing structure signals: ${skeletonStructure.missingSignals.join(', ')}`
          : '';
      const missingRootSummary =
        skeletonStructure.missingDirectoryRoots.length > 0
          ? `missing directory roots: ${skeletonStructure.missingDirectoryRoots.join(', ')}`
          : '';
      const reason = [missingSignalSummary, missingRootSummary].filter(Boolean).join('; ');
      return {
        ok: false,
        error: `SKELETON_STRUCTURE_INCOMPLETE: ${reason}`,
      };
    }

    tempDir = await CommandRunner.createValidationDir(sessionID);
    await CommandRunner.exportSessionFiles(sessionID, tempDir);
    const npmResult = await CommandRunner.runNpmInstall(sessionID, { cwd: tempDir });
    if (npmResult.exitCode !== 0) {
      return {
        ok: false,
        error: npmResult.stderr || npmResult.stdout || 'npm install failed before skeleton type gate',
      };
    }
    const tscResult = await CommandRunner.runTsc(sessionID, { cwd: tempDir });
    if (tscResult.exitCode === 0) {
      return { ok: true };
    }
    const output = [tscResult.stderr, tscResult.stdout].filter(Boolean).join('\n').trim();
    return {
      ok: false,
      error: output || 'TypeScript gate failed',
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (tempDir) {
      await CommandRunner.cleanup(tempDir);
    }
  }
}

function calculateBudgetStatus(used: number, limit: number): 'ok' | 'warning' | 'exhausted' {
  if (limit <= 0) return 'exhausted';
  const remaining = limit - used;
  if (remaining <= 0) return 'exhausted';
  if (remaining / limit <= 0.2) return 'warning';
  return 'ok';
}

function normalizeGeneratedFilePaths<T extends { path: string }>(
  files: T[],
  existingFiles: Array<{ path: string }> = []
): T[] {
  return normalizeGeneratedArtifactPaths(files, existingFiles);
}

type RuntimeRouteDecision = RouteDecision;

function resolveRuntimeRouteDecision(input: {
  requestedAgentId?: string;
  sessionAgentId: string;
  userMessage: string;
  requestedFramework?: string;
  requestedUiLibrary?: string;
}): RuntimeRouteDecision {
  const requestedAgentId = input.requestedAgentId?.trim();

  if (requestedAgentId && Agent.has(requestedAgentId)) {
    const agent = Agent.get(requestedAgentId);
    const detected = ModeRouter.detectAgent({
      userQuery: input.userMessage,
      hasPRD: false,
      hasTechStack: false,
      hasFigma: false,
      hasDetailedRequirements: false,
      hasBusinessContext: false,
      preferredFramework: input.requestedFramework,
      preferredUiLibrary: input.requestedUiLibrary,
    });
    return {
      agentId: requestedAgentId,
      mode: agent?.mode || 'creator',
      source: 'request',
      confidence: 1,
      version: ModeRouter.version,
      reasons: ['agent explicitly requested by client', ...(detected.reasons || [])],
      score: detected.score,
      language: detected.language,
      techSignals: detected.techSignals,
      framework: detected.framework,
      uiLibrarySelection: detected.uiLibrarySelection,
      decisionTrace: detected.decisionTrace,
      clarificationTask: detected.clarificationTask,
      blocked: detected.blocked,
    };
  }

  const sessionAgentId = input.sessionAgentId?.trim();
  if (sessionAgentId && Agent.has(sessionAgentId) && !input.userMessage.trim()) {
    const sessionAgent = Agent.get(sessionAgentId);
    return {
      agentId: sessionAgentId,
      mode: sessionAgent?.mode || 'creator',
      source: 'session-default',
      confidence: 0.6,
      version: ModeRouter.version,
      reasons: ['fall back to session agent because user message is empty'],
    };
  }

  const detected = ModeRouter.detectAgent({
    userQuery: input.userMessage,
    hasPRD: false,
    hasTechStack: false,
    hasFigma: false,
    hasDetailedRequirements: false,
    hasBusinessContext: false,
    preferredFramework: input.requestedFramework,
    preferredUiLibrary: input.requestedUiLibrary,
  });
  const detectedAgent = Agent.get(detected.agentId);

  return {
    agentId: detected.agentId,
    mode: detected.mode || detectedAgent?.mode || 'creator',
    source: 'auto',
    confidence: detected.confidence / 100,
    score: detected.score,
    reasons: detected.reasons,
    version: detected.version || ModeRouter.version,
    language: detected.language,
    techSignals: detected.techSignals,
    framework: detected.framework,
    uiLibrarySelection: detected.uiLibrarySelection,
    decisionTrace: detected.decisionTrace,
    clarificationTask: detected.clarificationTask,
    blocked: detected.blocked,
  };
}

/**
 * Runtime stream endpoint (Unified SSE event protocol)
 * Events:
 * - assistant.delta
 * - tool.call.started / tool.call.completed / tool.call.failed
 * - artifact.file.changed
 * - run.completed / run.error
 */
app.post('/api/runtime/sessions/:sessionId/stream', async (req, res) => {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const reqSessionId = req.params.sessionId;
  let currentSessionId = reqSessionId || 'unknown';
  const connectionAbortController = new AbortController();
  const runtimeTerminalTracker = createRunTerminalEventTracker();

  const handleConnectionClosed = () => {
    if (!connectionAbortController.signal.aborted) {
      connectionAbortController.abort();
    }
  };

  req.on('aborted', handleConnectionClosed);
  res.on('close', handleConnectionClosed);

  const throwIfConnectionClosed = () => {
    if (connectionAbortController.signal.aborted || res.writableEnded || res.destroyed) {
      const abortError = new Error('Runtime stream connection closed');
      abortError.name = 'AbortError';
      throw abortError;
    }
  };

  const sendRuntimeEvent = withRunTerminalEventTracking(
    createRuntimeEventEmitter({
      runId,
      getSessionId: () => currentSessionId,
      emit: event => {
        if (connectionAbortController.signal.aborted || res.writableEnded || res.destroyed) {
          return;
        }
        writeSSEData(res, { event });
      },
    }),
    runtimeTerminalTracker,
  );
  const sendRuntimeRunCompleted = (payload: Omit<RuntimeRunCompletedPayload, 'type'>) =>
    emitRunCompletedOnce<RuntimeRunCompletedPayload, RuntimeEvent>(
      sendRuntimeEvent,
      runtimeTerminalTracker,
      payload,
    );
  const sendRuntimeRunError = (payload: Omit<RuntimeRunErrorPayload, 'type'>) =>
    emitRunErrorOnce<RuntimeRunErrorPayload, RuntimeEvent>(
      sendRuntimeEvent,
      runtimeTerminalTracker,
      payload,
    );

  try {
    const { message, agentId, platform, techStack, modelProvider, modelId, framework, uiLibrary } = req.body;
    const runtimeBudgetInput =
      req.body?.autonomy && typeof req.body.autonomy === 'object' ? req.body.autonomy : req.body ?? {};
    const budgetValidation = validateRuntimeBudgetInput({
      maxIterations: (runtimeBudgetInput as RuntimeBudgetOverrides).maxIterations,
      maxDurationMs: (runtimeBudgetInput as RuntimeBudgetOverrides).maxDurationMs,
      maxToolCalls: (runtimeBudgetInput as RuntimeBudgetOverrides).maxToolCalls,
      targetScore: (runtimeBudgetInput as RuntimeBudgetOverrides).targetScore,
    });
    const inputValidation = validateRuntimeStreamInput(message);

    if (!inputValidation.valid) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: inputValidation.error,
      });
    }
    if (!budgetValidation.valid) {
      return res.status(400).json({
        error: 'INVALID_BUDGET',
        message: budgetValidation.error,
      });
    }

    const runtimeBudget = toRuntimeExecutionBudget(budgetValidation.budgetOverrides);

    if (!currentSessionId || currentSessionId === 'new') {
      const ownerId = getRequestOwnerId(req) || undefined;
      const newSession = await SessionManager.create({
        title: message.slice(0, 50),
        ownerId,
      });
      currentSessionId = newSession.id;
    } else if (!ensureSessionAccess(req, res, currentSessionId)) {
      return;
    }

    const session = SessionManager.get(currentSessionId);
    if (!session) {
      return res.status(404).json({
        error: 'SESSION_NOT_FOUND',
        message: `Session not found: ${currentSessionId}`,
      });
    }

    setSSEHeaders(res);
    throwIfConnectionClosed();

    const normalizedPlatform =
      typeof platform === 'string' &&
      ['web', 'mobile', 'desktop', 'miniprogram'].includes(platform)
        ? (platform as 'web' | 'mobile' | 'desktop' | 'miniprogram')
        : undefined;
    const normalizedTechStack = Array.isArray(techStack)
      ? techStack.filter((value): value is string => typeof value === 'string')
      : [];
    const requestedFramework = typeof framework === 'string' ? framework : undefined;
    const requestedUiLibrary = typeof uiLibrary === 'string' ? uiLibrary : undefined;
    const openaiRuntimeModel = (process.env.AI_RUNTIME_OPENAI_MODEL || 'gpt-4o').trim();

    let runtimeModelProvider = modelProvider || session.modelProvider || undefined;
    let runtimeModelId = modelId || session.modelId || undefined;
    const enforceRichPrototype = shouldEnforceRichPrototype({
      userMessage: message,
      mode: session.mode,
      platform: normalizedPlatform,
    });
    const preferToolCompatibleModel =
      enforceRichPrototype &&
      (typeof runtimeModelId !== 'string' || runtimeModelId.trim().length === 0) &&
      (typeof runtimeModelProvider !== 'string' || runtimeModelProvider === 'openai');
    if (preferToolCompatibleModel) {
      runtimeModelProvider = runtimeModelProvider || config.ai.defaultProvider || 'openai';
      const normalizedRuntimeProvider =
        typeof runtimeModelProvider === 'string' ? runtimeModelProvider : 'openai';
      runtimeModelId =
        runtimeModelId ||
        (normalizedRuntimeProvider === 'openai'
          ? openaiRuntimeModel
          : config.ai.defaultModel);
    }

    sendRuntimeEvent({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'ingest',
      status: 'started',
      message: 'runtime stream started',
    });

    sendRuntimeEvent({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'route',
      status: 'started',
      message: 'resolving agent route',
    });

    const routeDecision = resolveRuntimeRouteDecision({
      requestedAgentId: typeof agentId === 'string' ? agentId : undefined,
      sessionAgentId: session.agentId,
      userMessage: message,
      requestedFramework,
      requestedUiLibrary,
    });

    if (routeDecision.blocked || routeDecision.clarificationTask?.required) {
      const clarificationMessage =
        routeDecision.clarificationTask?.message ||
        'Route blocked: framework and UI library are incompatible.';
      sendRuntimeEvent({
        type: 'render.pipeline.stage',
        adapter: 'sandpack-renderer',
        stage: 'route',
        status: 'failed',
        message: clarificationMessage,
      });
      sendRuntimeRunError({
        error: clarificationMessage,
      });
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
      return;
    }

    if (session.agentId !== routeDecision.agentId || session.mode !== routeDecision.mode) {
      SessionManager.update(currentSessionId, {
        agentId: routeDecision.agentId,
        mode: routeDecision.mode,
      });
    }

    sendRuntimeEvent({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'route',
      status: 'completed',
      message: `agent=${routeDecision.agentId} source=${routeDecision.source}${runtimeModelId ? ` model=${runtimeModelId}` : ''}`,
    });

    sendRuntimeEvent({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'plan',
      status: 'started',
      message: 'generating multi-agent execution graph',
      groupId: 'orchestration.plan',
    });

    sendRuntimeEvent({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'plan',
      status: 'completed',
      message: 'multi-agent graph ready',
      groupId: 'orchestration.plan',
    });

    const kernel = new MultiAgentKernel({
      sessionId: currentSessionId,
      runId,
      userMessage: message,
      routeDecision: {
        agentId: routeDecision.agentId,
        mode: routeDecision.mode,
        source: routeDecision.source,
        confidence: routeDecision.confidence,
      },
      modelProvider: runtimeModelProvider,
      modelId: runtimeModelId,
      platform: normalizedPlatform,
      techStack: normalizedTechStack,
      runtimeBudget,
      emitRuntimeEvent: sendRuntimeEvent,
      abortSignal: connectionAbortController.signal,
    });

    await kernel.run();

    if (!connectionAbortController.signal.aborted && !res.writableEnded && !res.destroyed) {
      sendRuntimeRunCompleted({
        success: true,
      });
    }

    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }

    if (connectionAbortController.signal.aborted) {
      return;
    }

    const updatedSession = SessionManager.get(currentSessionId);
    const projectType = updatedSession?.projectType;
    const isSupportedProjectType =
      projectType === 'next-js' ||
      projectType === 'react-vite' ||
      projectType === 'react-native' ||
      projectType === 'uniapp';
    if (currentSessionId && isSupportedProjectType) {
      (async () => {
        try {
          const validationResult = await ProjectValidator.validateAndComplete(
            currentSessionId,
            projectType,
            message,
            routeDecision.agentId || updatedSession?.agentId || 'frontend-creator'
          );

          if (validationResult.isValid) {
            console.log('[Server] [OK] Project validation passed');
          } else {
            console.warn(
              '[Server] [WARN] Project validation incomplete. Missing files:',
              validationResult.missingCritical.map(f => f.path).join(', ')
            );
          }
        } catch (validationError) {
          console.error('[Server] [ERROR] Project validation failed:', validationError);
        }
      })().catch(validationTaskError => {
        console.error('[Server] Validation background task error:', validationTaskError);
      });
    }
  } catch (error) {
    if (connectionAbortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[API] Runtime stream aborted after client disconnect', {
        sessionId: currentSessionId,
        runId,
      });
      return;
    }

    console.error('[API] Runtime stream error:', error);

    if (res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!runtimeTerminalTracker.hasTerminalEvent()) {
        sendRuntimeEvent({
          type: 'render.pipeline.stage',
          adapter: 'sandpack-renderer',
          stage: 'build',
          status: 'failed',
          message: errorMessage,
        });
        sendRuntimeRunError({
          error: errorMessage,
        });
      }
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
      return;
    }

    return res.status(500).json({
      error: 'RUNTIME_STREAM_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    req.off('aborted', handleConnectionClosed);
    res.off('close', handleConnectionClosed);
  }
});

/**
 * Assembly stream endpoint (SSE)
 */
app.post('/api/runtime/sessions/:sessionId/assemble', async (req, res) => {
  const runId = `assemble-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const reqSessionId = req.params.sessionId;
  let currentSessionId = reqSessionId || 'unknown';
  let sequence = 0;
  const assemblyTerminalTracker = createRunTerminalEventTracker();

  const sendAssemblyEvent = withRunTerminalEventTracking(
    (event: AssemblyRuntimeEventPayload): void => {
      sequence += 1;
      writeSSEData(res, {
        event: {
          ...event,
          sessionId: currentSessionId,
          runId,
          sequence,
          timestamp: Date.now(),
        },
      });
    },
    assemblyTerminalTracker,
  );
  const sendAssemblyRunCompleted = (payload: Omit<AssemblyRunCompletedPayload, 'type'>) =>
    emitRunCompletedOnce<AssemblyRunCompletedPayload, void>(
      sendAssemblyEvent,
      assemblyTerminalTracker,
      payload,
    );
  const sendAssemblyRunError = (payload: Omit<AssemblyRunErrorPayload, 'type'>) =>
    emitRunErrorOnce<AssemblyRunErrorPayload, void>(
      sendAssemblyEvent,
      assemblyTerminalTracker,
      payload,
    );

  try {
    if (!currentSessionId || currentSessionId === 'new') {
      const ownerId = getRequestOwnerId(req) || undefined;
      const sessionTitleSeed =
        isRecord(req.body) && typeof req.body.message === 'string'
          ? req.body.message
          : isRecord(req.body) && typeof req.body.title === 'string'
            ? req.body.title
            : 'assembly session';
      const newSession = await SessionManager.create({
        title: sessionTitleSeed.slice(0, 50),
        ownerId,
      });
      currentSessionId = newSession.id;
    } else if (!ensureSessionAccess(req, res, currentSessionId)) {
      return;
    }

    const session = SessionManager.get(currentSessionId);
    if (!session) {
      return res.status(404).json({
        error: 'SESSION_NOT_FOUND',
        message: `Session not found: ${currentSessionId}`,
      });
    }

    setSSEHeaders(res);

    const body = req.body;
    const graphInput = normalizeAssemblyGraphInput(isRecord(body) ? body.graph : undefined);
    const executorInput =
      isRecord(body) && typeof body.executor === 'string' && body.executor.trim()
        ? body.executor.trim()
        : undefined;
    const patchesInput = normalizeAssemblyPatchInput(
      isRecord(body) ? (body.patches ?? body.patch) : undefined
    );

    const beginResult = assemblySessionGraphService.beginAssemble(currentSessionId, {
      runId,
      graph: graphInput,
      executor: executorInput,
    });

    sendAssemblyEvent({
      type: 'assembly.graph.ready',
      revision: beginResult.snapshot.revision,
      graph: beginResult.snapshot.graph,
      executor: beginResult.snapshot.executor,
      pendingPatches: beginResult.snapshot.pendingPatches.length,
      message: 'assembly graph is ready',
    });

    if (beginResult.executorSwitch) {
      sendAssemblyEvent({
        type: 'assembly.executor.switch',
        previousExecutor: beginResult.executorSwitch.from,
        executor: beginResult.executorSwitch.to,
        revision: beginResult.snapshot.revision,
        message: `executor switched to ${beginResult.executorSwitch.to}`,
      });
    }

    for (const patch of patchesInput) {
      const patchRecord = assemblySessionGraphService.appendPatch(currentSessionId, patch, undefined, runId);
      if (!patchRecord) {
        continue;
      }

      sendAssemblyEvent({
        type: 'assembly.patch',
        revision: patchRecord.revision,
        patchId: patchRecord.id,
        patch: patchRecord.patch,
        acked: false,
      });
    }

    const finalSnapshot = assemblySessionGraphService.getSnapshot(currentSessionId, runId);
    sendAssemblyRunCompleted({
      success: true,
      filesCount: patchesInput.length,
      terminationReason: 'single_iteration',
      iterations: 1,
    });

    writeSSEData(res, { snapshot: finalSnapshot });
    res.end();
  } catch (error) {
    console.error('[API] Assembly stream error:', error);

    if (res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      sendAssemblyRunError({
        error: errorMessage,
      });
      res.end();
      return;
    }

    return res.status(500).json({
      error: 'ASSEMBLY_STREAM_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/runtime/sessions/:sessionId/patch/ack', (req, res) => {
  const sessionId = req.params.sessionId;
  if (!sessionId || sessionId === 'new') {
    return res.status(400).json({
      error: 'INVALID_SESSION_ID',
      message: 'sessionId is required',
    });
  }
  if (!isRecord(req.body)) {
    return res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'request body must be an object',
    });
  }

  const revisionValue = req.body.revision;
  if (typeof revisionValue !== 'number' || !Number.isFinite(revisionValue)) {
    return res.status(400).json({
      error: 'INVALID_REVISION',
      message: 'revision must be a finite number',
    });
  }

  const revision = Math.floor(revisionValue);
  if (revision < 0) {
    return res.status(400).json({
      error: 'INVALID_REVISION',
      message: 'revision must be greater than or equal to 0',
    });
  }

  const patchId =
    typeof req.body.patchId === 'string' && req.body.patchId.trim()
      ? req.body.patchId.trim()
      : undefined;
  const runId =
    typeof req.body.runId === 'string' && req.body.runId.trim()
      ? req.body.runId.trim()
      : null;
  if (!runId) {
    return res.status(400).json({
      error: 'INVALID_RUN_ID',
      message: 'runId is required',
    });
  }

  if (!ensureSessionAccess(req, res, sessionId)) {
    return;
  }

  const ackResult = assemblySessionGraphService.ackPatch(sessionId, revision, patchId, runId);
  if (!ackResult.ok) {
    const statusCode = ackResult.reason === 'SESSION_NOT_FOUND' ? 404 : 409;
    return res.status(statusCode).json({
      error: ackResult.reason,
      message: ackResult.message,
      snapshot: ackResult.snapshot ?? null,
    });
  }

  return res.json({
    ok: true,
    sessionId,
    revision: ackResult.snapshot.acknowledgedRevision,
    acknowledgedRevision: ackResult.snapshot.acknowledgedRevision,
    acknowledgedPatchId: ackResult.acknowledgedPatchId ?? null,
    pendingPatches: ackResult.snapshot.pendingPatches.length,
    snapshot: ackResult.snapshot,
  });
});

app.post('/api/runtime/sessions/:sessionId/patch/rollback', (req, res) => {
  const sessionId = req.params.sessionId;
  if (!sessionId || sessionId === 'new') {
    return res.status(400).json({
      error: 'INVALID_SESSION_ID',
      message: 'sessionId is required',
    });
  }
  if (!isRecord(req.body)) {
    return res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'request body must be an object',
    });
  }

  const runId =
    typeof req.body.runId === 'string' && req.body.runId.trim()
      ? req.body.runId.trim()
      : null;
  if (!runId) {
    return res.status(400).json({
      error: 'INVALID_RUN_ID',
      message: 'runId is required',
    });
  }

  const targetRevisionValue = req.body.targetRevision;
  if (typeof targetRevisionValue !== 'number' || !Number.isFinite(targetRevisionValue)) {
    return res.status(400).json({
      error: 'INVALID_TARGET_REVISION',
      message: 'targetRevision must be a finite number',
    });
  }
  const targetRevision = Math.floor(targetRevisionValue);

  if (!ensureSessionAccess(req, res, sessionId)) {
    return;
  }

  const rollbackResult = assemblySessionGraphService.rollbackPatch(
    sessionId,
    targetRevision,
    runId
  );
  if (!rollbackResult.ok) {
    const statusCode = rollbackResult.reason === 'SESSION_NOT_FOUND' ? 404 : 409;
    return res.status(statusCode).json({
      error: rollbackResult.reason,
      message: rollbackResult.message,
      snapshot: rollbackResult.snapshot ?? null,
    });
  }

  return res.json({
    ok: true,
    sessionId,
    runId,
    rolledBackFrom: rollbackResult.rolledBackFrom,
    rolledBackTo: rollbackResult.rolledBackTo,
    removedPatchCount: rollbackResult.removedPatchCount,
    snapshot: rollbackResult.snapshot,
  });
});

app.get('/api/runtime/sessions/:sessionId/snapshot', (req, res) => {
  const sessionId = req.params.sessionId;
  if (!sessionId || sessionId === 'new') {
    return res.status(400).json({
      error: 'INVALID_SESSION_ID',
      message: 'sessionId is required',
    });
  }

  if (!ensureSessionAccess(req, res, sessionId)) {
    return;
  }

  const runId =
    typeof req.query.runId === 'string' && req.query.runId.trim() ? req.query.runId.trim() : undefined;

  const snapshot = assemblySessionGraphService.getSnapshot(sessionId, runId);
  if (!snapshot) {
    return res.status(404).json({
      error: 'SESSION_NOT_FOUND',
      message: `Assembly snapshot not found: ${sessionId}`,
    });
  }

  return res.json({
    sessionId,
    snapshot,
  });
});

app.post('/api/workflow/stream', (req, res) => {
  return res.status(410).json({
    error: 'WORKFLOW_STREAM_REMOVED',
    message: 'Legacy workflow SSE endpoint was removed. Use runtime stream endpoint instead.',
    migration: {
      from: '/api/workflow/stream',
      to: '/api/runtime/sessions/:sessionId/stream',
      example: '/api/runtime/sessions/new/stream',
    },
  });
});
// ============================================================================
// WebSocket Server
// ============================================================================

const wss = new WebSocketServer({ server, path: '/ws' });

interface WSClient {
  socket: WebSocket;
  sessionID: string;
  isAlive: boolean;
  activeAbortController?: AbortController;
}

// WebSocket client limit to prevent memory exhaustion
const MAX_CLIENTS = 1000;

const clients = new Map<WebSocket, WSClient>();

function sendWSMessage(ws: WebSocket, payload: unknown): boolean {
  if (ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  ws.send(JSON.stringify(payload));
  return true;
}

function sendWSRuntimeEvent(ws: WebSocket, event: RuntimeEvent): boolean {
  const delivered = sendWSMessage(ws, { event });
  if (!delivered) {
    return false;
  }

  if (event.type === 'assistant.delta') {
    sendWSMessage(ws, {
      type: 'text_delta',
      data: event.delta,
    });
  } else if (event.type === 'run.completed') {
    const legacyFinishReason =
      event.terminationReason === 'max_iterations'
        ? 'length'
        : event.terminationReason === 'error'
          ? 'error'
          : 'stop';
    sendWSMessage(ws, {
      type: 'done',
      data: {
        messageId: `msg-${Date.now()}`,
        finishReason: legacyFinishReason,
      },
    });
  } else if (event.type === 'run.error') {
    sendWSMessage(ws, {
      type: 'error',
      data: {
        message: event.error,
      },
    });
  }

  return true;
}

function startWSRuntimeStream(ws: WebSocket): AbortController | null {
  const client = clients.get(ws);
  if (!client) {
    return null;
  }

  if (client.activeAbortController && !client.activeAbortController.signal.aborted) {
    client.activeAbortController.abort();
  }

  const abortController = new AbortController();
  client.activeAbortController = abortController;
  return abortController;
}

function finalizeWSRuntimeStream(ws: WebSocket, abortController: AbortController): void {
  const client = clients.get(ws);
  if (client?.activeAbortController === abortController) {
    client.activeAbortController = undefined;
  }
}

wss.on('connection', (ws, req) => {
  // Check if server is at capacity
  if (clients.size >= MAX_CLIENTS) {
    ws.close(1008, 'Server is at capacity');
    console.warn(`[WS] Connection rejected: server full (${clients.size}/${MAX_CLIENTS})`);
    return;
  }

  // Extract session ID from URL query params
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionID = url.searchParams.get('session');
  const token = url.searchParams.get('token');

  if (!sessionID) {
    ws.close(1008, 'Session ID required');
    return;
  }

  let wsPrincipalSub: string | null = null;
  if (config.auth.enabled) {
    if (!token) {
      ws.close(1008, 'Bearer token required');
      return;
    }
    try {
      const claims = verifyJwtToken(token, {
        secret: config.auth.jwtSecret,
        audience: config.auth.audience,
        issuer: config.auth.issuer,
      });
      wsPrincipalSub = claims.sub;
    } catch (error) {
      ws.close(1008, `Invalid token: ${error instanceof Error ? error.message : 'unauthorized'}`);
      return;
    }
  }

  // Verify session exists
  const session = SessionManager.get(sessionID);
  if (!session) {
    ws.close(1008, 'Session not found');
    return;
  }
  if (config.auth.enabled) {
    if (!wsPrincipalSub) {
      ws.close(1008, 'Invalid principal');
      return;
    }
    if (session.ownerId && session.ownerId !== wsPrincipalSub) {
      ws.close(1008, 'Forbidden session access');
      return;
    }
    if (!session.ownerId) {
      SessionManager.update(sessionID, { ownerId: wsPrincipalSub });
    }
  }

  // Register client
  clients.set(ws, {
    socket: ws,
    sessionID,
    isAlive: true,
  });

  console.log(`[WS] Client connected for session ${sessionID} (${clients.size}/${MAX_CLIENTS})`);

  // Send welcome message
  sendWSMessage(ws, {
    type: 'connected',
    data: { sessionID },
  });

  // Handle incoming messages
  ws.on('message', async data => {
    try {
      const msg = JSON.parse(data.toString());
      await handleWSMessage(ws, sessionID, msg);
    } catch (error) {
      console.error('[WS] Failed to handle message:', error);
      sendWSMessage(ws, {
        type: 'error',
        data: { message: String(error) },
      });
    }
  });

  // Handle ping/pong for connection health
  ws.on('pong', () => {
    const client = clients.get(ws);
    if (client) {
      client.isAlive = true;
    }
  });

  // Handle close
  ws.on('close', () => {
    const client = clients.get(ws);
    if (client?.activeAbortController && !client.activeAbortController.signal.aborted) {
      client.activeAbortController.abort();
    }
    clients.delete(ws);
    console.log(`[WS] Client disconnected for session ${sessionID}`);
  });
});

/**
 * Handle WebSocket messages
 */
async function handleWSMessage(ws: WebSocket, sessionID: string, msg: any) {
  const client = clients.get(ws);
  if (!client) return;

  const messageType = typeof msg?.type === 'string' ? msg.type : '';
  switch (messageType) {
    case 'start_stream':
      await handleStreamStart(ws, sessionID, msg?.data);
      break;

    case 'ping':
      sendWSMessage(ws, { type: 'pong' });
      break;

    default:
      console.warn(`[WS] Unknown message type: ${messageType || 'invalid'}`);
  }
}


/**
 * Handle streaming request
 */
async function handleStreamStart(ws: WebSocket, sessionID: string, data: any) {
  const { message, agentId, platform, techStack, modelProvider, modelId, framework, uiLibrary } =
    data ?? {};
  const abortController = startWSRuntimeStream(ws);
  if (!abortController) {
    return;
  }

  const runId = `ws-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runtimeTerminalTracker = createRunTerminalEventTracker();
  const sendRuntimeEvent = withRunTerminalEventTracking(
    createRuntimeEventEmitter({
      runId,
      getSessionId: () => sessionID,
      emit: event => {
        if (!sendWSRuntimeEvent(ws, event) && !abortController.signal.aborted) {
          abortController.abort();
        }
      },
    }),
    runtimeTerminalTracker,
  );
  const sendRuntimeRunCompleted = (payload: Omit<RuntimeRunCompletedPayload, 'type'>) =>
    emitRunCompletedOnce<RuntimeRunCompletedPayload, RuntimeEvent>(
      sendRuntimeEvent,
      runtimeTerminalTracker,
      payload,
    );
  const sendRuntimeRunError = (payload: Omit<RuntimeRunErrorPayload, 'type'>) =>
    emitRunErrorOnce<RuntimeRunErrorPayload, RuntimeEvent>(
      sendRuntimeEvent,
      runtimeTerminalTracker,
      payload,
    );

  const isStreamClosed = () => abortController.signal.aborted || ws.readyState !== WebSocket.OPEN;

  try {
    const normalizedMessage = typeof message === 'string' ? message : '';
    const runtimeBudgetInput =
      data?.autonomy && typeof data.autonomy === 'object' ? data.autonomy : data ?? {};
    const budgetValidation = validateRuntimeBudgetInput({
      maxIterations: (runtimeBudgetInput as RuntimeBudgetOverrides).maxIterations,
      maxDurationMs: (runtimeBudgetInput as RuntimeBudgetOverrides).maxDurationMs,
      maxToolCalls: (runtimeBudgetInput as RuntimeBudgetOverrides).maxToolCalls,
      targetScore: (runtimeBudgetInput as RuntimeBudgetOverrides).targetScore,
    });
    if (!budgetValidation.valid) {
      sendRuntimeRunError({
        error: budgetValidation.error ?? 'invalid runtime budget',
      });
      return;
    }
    const runtimeBudget = toRuntimeExecutionBudget(budgetValidation.budgetOverrides);

    const session = SessionManager.get(sessionID);
    if (!session) {
      throw new Error('Session not found');
    }

    sendRuntimeEvent({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'ingest',
      status: 'started',
      message: 'runtime stream started',
    });
    sendRuntimeEvent({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'route',
      status: 'started',
      message: 'resolving agent route',
    });

    const routeDecision = resolveRuntimeRouteDecision({
      requestedAgentId: typeof agentId === 'string' ? agentId : undefined,
      sessionAgentId: session.agentId,
      userMessage: normalizedMessage,
      requestedFramework: typeof framework === 'string' ? framework : undefined,
      requestedUiLibrary: typeof uiLibrary === 'string' ? uiLibrary : undefined,
    });

    if (routeDecision.blocked || routeDecision.clarificationTask?.required) {
      const clarificationMessage =
        routeDecision.clarificationTask?.message ||
        'Route blocked: framework and UI library are incompatible.';
      sendRuntimeEvent({
        type: 'render.pipeline.stage',
        adapter: 'sandpack-renderer',
        stage: 'route',
        status: 'failed',
        message: clarificationMessage,
      });
      sendRuntimeRunError({
        error: clarificationMessage,
      });
      return;
    }

    if (session.agentId !== routeDecision.agentId || session.mode !== routeDecision.mode) {
      SessionManager.update(sessionID, {
        agentId: routeDecision.agentId,
        mode: routeDecision.mode,
      });
    }

    sendRuntimeEvent({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'route',
      status: 'completed',
      message: `agent=${routeDecision.agentId} source=${routeDecision.source}`,
    });

    sendRuntimeEvent({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'plan',
      status: 'started',
      message: 'generating multi-agent execution graph',
      groupId: 'orchestration.plan',
    });

    sendRuntimeEvent({
      type: 'render.pipeline.stage',
      adapter: 'sandpack-renderer',
      stage: 'plan',
      status: 'completed',
      message: 'multi-agent graph ready',
      groupId: 'orchestration.plan',
    });

    const maPlatform =
      typeof platform === 'string' && ['web', 'mobile', 'desktop', 'miniprogram'].includes(platform)
        ? (platform as 'web' | 'mobile' | 'desktop' | 'miniprogram')
        : undefined;
    const maTechStack = Array.isArray(techStack)
      ? techStack.filter((v): v is string => typeof v === 'string')
      : [];

    const kernel = new MultiAgentKernel({
      sessionId: sessionID,
      runId,
      userMessage: normalizedMessage,
      routeDecision: {
        agentId: routeDecision.agentId,
        mode: routeDecision.mode,
        source: routeDecision.source,
        confidence: routeDecision.confidence,
      },
      modelProvider: modelProvider || undefined,
      modelId: modelId || undefined,
      platform: maPlatform,
      techStack: maTechStack,
      runtimeBudget,
      emitRuntimeEvent: sendRuntimeEvent,
      abortSignal: abortController.signal,
    });
    await kernel.run();

    if (!isStreamClosed() && !runtimeTerminalTracker.hasTerminalEvent()) {
      sendRuntimeEvent({
        type: 'render.pipeline.stage',
        adapter: 'sandpack-renderer',
        stage: 'publish',
        status: 'completed',
        message: 'runtime stream completed',
      });
      sendRuntimeRunCompleted({
        success: true,
      });
    }
  } catch (error) {
    if (isStreamClosed() || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[WS] Stream aborted after socket closed', { sessionID, runId });
      return;
    }

    console.error('[WS] Stream error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!runtimeTerminalTracker.hasTerminalEvent()) {
      sendRuntimeEvent({
        type: 'render.pipeline.stage',
        adapter: 'sandpack-renderer',
        stage: 'build',
        status: 'failed',
        message: errorMessage,
      });
      sendRuntimeRunError({
        error: errorMessage,
      });
    }
  } finally {
    finalizeWSRuntimeStream(ws, abortController);
  }
}


// Connection health check
const healthCheckInterval = setInterval(() => {
  for (const [ws, client] of clients.entries()) {
    if (!client.isAlive) {
      if (client.activeAbortController && !client.activeAbortController.signal.aborted) {
        client.activeAbortController.abort();
      }
      ws.terminate();
      clients.delete(ws);
      continue;
    }

    client.isAlive = false;
    ws.ping();
  }
}, 30000);

// ============================================================================
// Start Server
// ============================================================================

// Initialize storage
SessionStorage.initialize();
FileStorage.initialize();

server.listen(PORT, config.server.host, () => {
  console.log(`
============================================================
 AI Frontend Master - Backend Server
 Port: ${PORT.toString().padEnd(48)}
 Host: ${config.server.host.padEnd(48)}
 Environment: ${config.server.env.padEnd(40)}
 Frontend URL: ${config.frontend.url.padEnd(36)}
 Default AI: ${config.ai.defaultProvider.padEnd(43)}
 Default Model: ${config.ai.defaultModel.padEnd(39)}
 Ready to accept connections...
============================================================
  `);
});

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);

  // Clear health check interval
  clearInterval(healthCheckInterval);

  // Close all WebSocket connections
  for (const [ws, client] of clients.entries()) {
    if (client.activeAbortController && !client.activeAbortController.signal.aborted) {
      client.activeAbortController.abort();
    }
    ws.close(1001, 'Server shutting down');
  }
  clients.clear();

  server.close(() => {
    SessionStorage.close();
    console.log('[Server] Closed');
    process.exit(0);
  });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export { app, server };

