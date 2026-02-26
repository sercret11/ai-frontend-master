import { createHash } from 'node:crypto';
import type { ParsedError } from '@ai-frontend/shared-types';

function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[0-9]+/g, '#')
    .trim();
}

export function createErrorFingerprint(errors: ParsedError[]): string {
  if (errors.length === 0) {
    return 'none';
  }

  const key = errors
    .slice(0, 8)
    .map(error => `${error.category}:${normalizeMessage(error.message || error.raw || '')}`)
    .join('|');

  return createHash('sha1').update(key).digest('hex').slice(0, 12);
}

