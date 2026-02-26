export interface SessionContractPolicy {
  /**
   * Whether frozen contract prefixes are read-only in current runtime stage.
   */
  readOnly: boolean;
  /**
   * Prefix list treated as frozen contracts.
   */
  frozenPrefixes: string[];
}

export interface ContractWriteDecision {
  allowed: boolean;
  reason?: string;
  matchedPrefix?: string;
}

const DEFAULT_FROZEN_PREFIXES = ['types/', 'store/', 'components/ui/'];

const sessionPolicies = new Map<string, SessionContractPolicy>();

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.?\//, '').trim();
}

function normalizePrefixes(prefixes: string[]): string[] {
  const normalized = prefixes
    .map(prefix => normalizePath(prefix))
    .filter(Boolean)
    .map(prefix => (prefix.endsWith('/') ? prefix : `${prefix}/`));
  return Array.from(new Set(normalized));
}

export function getDefaultFrozenPrefixes(): string[] {
  return [...DEFAULT_FROZEN_PREFIXES];
}

export function setSessionContractPolicy(
  sessionID: string,
  policy: Partial<SessionContractPolicy>
): void {
  const existing = sessionPolicies.get(sessionID);
  const next: SessionContractPolicy = {
    readOnly: policy.readOnly ?? existing?.readOnly ?? false,
    frozenPrefixes: normalizePrefixes(
      policy.frozenPrefixes ?? existing?.frozenPrefixes ?? DEFAULT_FROZEN_PREFIXES
    ),
  };
  sessionPolicies.set(sessionID, next);
}

export function clearSessionContractPolicy(sessionID: string): void {
  sessionPolicies.delete(sessionID);
}

export function getSessionContractPolicy(sessionID: string): SessionContractPolicy {
  const policy = sessionPolicies.get(sessionID);
  if (!policy) {
    return {
      readOnly: false,
      frozenPrefixes: [...DEFAULT_FROZEN_PREFIXES],
    };
  }
  return {
    readOnly: policy.readOnly,
    frozenPrefixes: [...policy.frozenPrefixes],
  };
}

export function evaluateContractWrite(sessionID: string, filePath: string): ContractWriteDecision {
  const policy = getSessionContractPolicy(sessionID);
  if (!policy.readOnly) {
    return { allowed: true };
  }

  const normalizedPath = normalizePath(filePath);
  const matchedPrefix = policy.frozenPrefixes.find(prefix => normalizedPath.startsWith(prefix));
  if (!matchedPrefix) {
    return { allowed: true };
  }

  return {
    allowed: false,
    matchedPrefix,
    reason: `CONTRACT_FROZEN_WRITE_BLOCKED: path "${normalizedPath}" is frozen under "${matchedPrefix}"`,
  };
}

