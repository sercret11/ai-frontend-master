import { describe, expect, it } from 'vitest';
import { ErrorCategory, type ParsedError } from '@ai-frontend/shared-types';
import { createErrorFingerprint } from './error-fingerprint';

describe('error-fingerprint', () => {
  it('normalizes numeric values for stable fingerprints', () => {
    const a: ParsedError[] = [
      {
        category: ErrorCategory.TYPE_ERROR,
        message: "Type '123' is not assignable to type '456'",
        raw: '',
      },
    ];
    const b: ParsedError[] = [
      {
        category: ErrorCategory.TYPE_ERROR,
        message: "Type '999' is not assignable to type '000'",
        raw: '',
      },
    ];

    expect(createErrorFingerprint(a)).toBe(createErrorFingerprint(b));
  });
});

