/**
 * Analysis agent shared helpers.
 */

import { jsonrepair } from 'jsonrepair';
import type { AnalysisAgentID } from '../types.js';

/** Execution order for analysis agents. */
export const ANALYSIS_AGENT_ORDER: readonly AnalysisAgentID[] = [
  'product-manager',
  'frontend-architect',
  'ui-expert',
  'ux-expert',
] as const;

/** Extract JSON payload from LLM output. */
export function extractJsonFromOutput(raw: string): unknown {
  const direct = tryParseJson(raw, { allowRepair: false });
  if (direct !== null) {
    return direct;
  }

  const codeBlockMatches = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const match of codeBlockMatches) {
    const parsed = tryParseJson(match[1] ?? '', { allowRepair: true });
    if (parsed !== null) {
      return parsed;
    }
  }

  const candidates = extractBalancedJsonCandidates(raw).sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate, { allowRepair: true });
    if (parsed !== null) {
      return parsed;
    }
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const parsed = tryParseJson(raw.slice(firstBrace, lastBrace + 1), { allowRepair: true });
    if (parsed !== null) {
      return parsed;
    }
  }

  throw new Error('Failed to extract JSON from LLM output');
}

/** Generate a unique ID. */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function tryParseJson(
  input: string,
  options: { allowRepair?: boolean } = {},
): unknown | null {
  const trimmed = stripControlChars(input).trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with normalization fallback.
  }

  const normalized = trimmed
    .replace(/^\uFEFF/, '')
    .replace(/[¡°¡±]/g, '"')
    .replace(/[¡®¡¯]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(normalized);
  } catch {
    // Continue to best-effort repair parser.
  }

  if (options.allowRepair) {
    try {
      const repaired = jsonrepair(normalized);
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }

  return null;
}

function stripControlChars(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function extractBalancedJsonCandidates(raw: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];

    if (start === -1) {
      if (ch === '{' || ch === '[') {
        start = i;
        stack.length = 0;
        stack.push(ch);
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      const open = stack.pop();
      const matched =
        (open === '{' && ch === '}') ||
        (open === '[' && ch === ']');

      if (!matched) {
        start = -1;
        stack.length = 0;
        inString = false;
        escaped = false;
        continue;
      }

      if (stack.length === 0 && start !== -1) {
        candidates.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}
