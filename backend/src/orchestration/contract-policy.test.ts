import { afterEach, describe, expect, it } from 'vitest';
import {
  clearSessionContractPolicy,
  evaluateContractWrite,
  getDefaultFrozenPrefixes,
  setSessionContractPolicy,
} from './contract-policy';

describe('contract-policy', () => {
  const sessionID = 'session-contract-policy';

  afterEach(() => {
    clearSessionContractPolicy(sessionID);
  });

  it('allows writes when readOnly is disabled', () => {
    setSessionContractPolicy(sessionID, {
      readOnly: false,
      frozenPrefixes: getDefaultFrozenPrefixes(),
    });

    expect(evaluateContractWrite(sessionID, 'types/user.ts').allowed).toBe(true);
  });

  it('blocks writes to frozen prefixes when readOnly is enabled', () => {
    setSessionContractPolicy(sessionID, {
      readOnly: true,
      frozenPrefixes: getDefaultFrozenPrefixes(),
    });

    const blocked = evaluateContractWrite(sessionID, 'components/ui/button.tsx');
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('CONTRACT_FROZEN_WRITE_BLOCKED');

    const allowed = evaluateContractWrite(sessionID, 'pages/home.tsx');
    expect(allowed.allowed).toBe(true);
  });
});

