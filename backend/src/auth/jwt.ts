import crypto from 'crypto';

export interface AuthClaims {
  sub: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  scope?: string;
  scopes?: string[];
  [key: string]: unknown;
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return Buffer.from(padded, 'base64');
}

function parseJsonBuffer<T>(buffer: Buffer): T {
  const text = buffer.toString('utf8');
  return JSON.parse(text) as T;
}

function encodeBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function timingSafeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function normalizeAudience(claimAud: string | string[] | undefined): string[] {
  if (!claimAud) return [];
  return Array.isArray(claimAud) ? claimAud : [claimAud];
}

export function parseScopes(claims: AuthClaims): string[] {
  if (Array.isArray(claims.scopes)) {
    return claims.scopes.filter((value): value is string => typeof value === 'string');
  }
  if (typeof claims.scope === 'string') {
    return claims.scope
      .split(/\s+/)
      .map(value => value.trim())
      .filter(Boolean);
  }
  return [];
}

export function verifyJwtToken(
  token: string,
  options: {
    secret: string;
    audience?: string;
    issuer?: string;
    clockSkewSec?: number;
  }
): AuthClaims {
  const { secret, audience, issuer, clockSkewSec = 60 } = options;
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [rawHeader, rawPayload, rawSignature] = parts;
  const header = parseJsonBuffer<{ alg?: string; typ?: string }>(base64UrlDecode(rawHeader));
  if (header.alg !== 'HS256') {
    throw new Error(`Unsupported JWT alg: ${header.alg || 'unknown'}`);
  }

  const signingInput = `${rawHeader}.${rawPayload}`;
  const expectedSignature = encodeBase64Url(
    crypto.createHmac('sha256', secret).update(signingInput).digest()
  );
  if (!timingSafeEquals(expectedSignature, rawSignature)) {
    throw new Error('Invalid JWT signature');
  }

  const claims = parseJsonBuffer<AuthClaims>(base64UrlDecode(rawPayload));
  if (typeof claims.sub !== 'string' || !claims.sub.trim()) {
    throw new Error('JWT sub claim is required');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.nbf === 'number' && now + clockSkewSec < claims.nbf) {
    throw new Error('JWT token not active yet');
  }
  if (typeof claims.exp === 'number' && now - clockSkewSec >= claims.exp) {
    throw new Error('JWT token expired');
  }

  if (issuer && claims.iss !== issuer) {
    throw new Error(`JWT issuer mismatch: expected ${issuer}`);
  }

  if (audience) {
    const audiences = normalizeAudience(claims.aud);
    if (!audiences.includes(audience)) {
      throw new Error(`JWT audience mismatch: expected ${audience}`);
    }
  }

  return claims;
}

