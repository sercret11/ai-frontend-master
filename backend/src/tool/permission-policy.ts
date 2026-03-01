import type { PermissionRequest } from '@ai-frontend/shared-types';

export type PermissionRiskLevel = 'low' | 'high';

export interface PermissionPolicyContext {
  source: 'llm-service' | 'tool-context' | 'self-repair';
  agent: string;
  sessionID: string;
  messageID: string;
  callID?: string;
  toolName?: string;
}

export interface PermissionDecision {
  allowed: boolean;
  riskLevel: PermissionRiskLevel;
  strategy: 'default-allow' | 'controlled-allow' | 'hard-deny';
  reason: string;
}

const POLICY_VERSION = 'tool-permission-v1';

const HIGH_RISK_KEYWORDS = [
  'write',
  'edit',
  'delete',
  'remove',
  'filesystem',
  'bash',
  'shell',
  'exec',
  'command',
  'network',
  'http',
  'https',
  'webfetch',
];

const HARD_DENY_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\brmdir\b/i,
  /\bdel\s+\/[sqf]/i,
  /\bformat\s+[a-z]:/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bcurl\b.+\|\s*(?:sh|bash|powershell)/i,
  /\binvoke-expression\b/i,
  /\bremove-item\b.+-recurse.+-force/i,
];

const HIGH_RISK_ALLOWED_AGENTS = new Set([
  'frontend-creator',
  'frontend-implementer',
  'self-repair',
]);

const MAX_TOOL_ARGS_PREVIEW_LENGTH = 2000;

function collectRequestText(request: PermissionRequest): string {
  const metadataText = [
    request.metadata?.title,
    request.metadata?.filePath,
    request.metadata?.diff,
    Object.entries(request.metadata || {})
      .map(([key, value]) => `${key}:${String(value)}`)
      .join(' '),
  ]
    .filter(Boolean)
    .join(' ');

  return [request.permission, ...(request.patterns || []), metadataText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function stringifyToolArgs(args: Record<string, unknown>): string {
  try {
    const serialized = JSON.stringify(args);
    if (!serialized) {
      return '';
    }
    return serialized.slice(0, MAX_TOOL_ARGS_PREVIEW_LENGTH);
  } catch {
    return String(args).slice(0, MAX_TOOL_ARGS_PREVIEW_LENGTH);
  }
}

export function buildToolExecutionPermissionRequest(
  toolName: string,
  args: Record<string, unknown>
): PermissionRequest {
  const argsPreview = stringifyToolArgs(args);
  return {
    permission: `tool.execute.${toolName}`,
    patterns: [`tool:${toolName}`, argsPreview].filter(Boolean),
    metadata: {
      title: `Execute tool ${toolName}`,
      toolName,
      argsPreview,
    },
  };
}

export function evaluatePermission(
  request: PermissionRequest,
  context: PermissionPolicyContext
): PermissionDecision {
  const requestText = collectRequestText(request);

  const hasHardDenyPattern = HARD_DENY_PATTERNS.some(pattern => pattern.test(requestText));
  if (hasHardDenyPattern) {
    return {
      allowed: false,
      riskLevel: 'high',
      strategy: 'hard-deny',
      reason: 'Matched hard-deny safety pattern for destructive operation',
    };
  }

  const isHighRisk = HIGH_RISK_KEYWORDS.some(keyword => requestText.includes(keyword));
  if (!isHighRisk) {
    return {
      allowed: true,
      riskLevel: 'low',
      strategy: 'default-allow',
      reason: 'Low-risk permission request',
    };
  }

  if (HIGH_RISK_ALLOWED_AGENTS.has(context.agent)) {
    return {
      allowed: true,
      riskLevel: 'high',
      strategy: 'controlled-allow',
      reason: `High-risk permission allowed for trusted agent ${context.agent}`,
    };
  }

  return {
    allowed: false,
    riskLevel: 'high',
    strategy: 'hard-deny',
    reason: `High-risk permission denied for untrusted agent ${context.agent}`,
  };
}

export function logPermissionDecision(
  request: PermissionRequest,
  context: PermissionPolicyContext,
  decision: PermissionDecision
): void {
  console.log(
    '[ToolPermissionPolicy]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      version: POLICY_VERSION,
      source: context.source,
      agent: context.agent,
      sessionID: context.sessionID,
      messageID: context.messageID,
      callID: context.callID,
      toolName: context.toolName,
      permission: request.permission,
      patterns: request.patterns,
      metadata: request.metadata,
      decision,
    })
  );
}

export async function enforcePermission(
  request: PermissionRequest,
  context: PermissionPolicyContext
): Promise<void> {
  const decision = evaluatePermission(request, context);
  logPermissionDecision(request, context, decision);

  if (!decision.allowed) {
    throw new Error(
      `[PermissionDenied:${POLICY_VERSION}] ${decision.reason}; permission=${request.permission}; agent=${context.agent}`
    );
  }
}
