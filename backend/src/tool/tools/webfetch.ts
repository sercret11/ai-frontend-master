/**
 * WebFetch Tool - Fetch Web Content
 * Ported from OpenCode with modifications for ai-frontend-master
 *
 * Allows AI to fetch and analyze web pages or API responses
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../../config';
import { Tool } from '../tool';
import { z } from 'zod';
import type { SearchOperationMetadata, ToolContext, ToolExecutionResult } from '@ai-frontend/shared-types';

// Define parameters type
interface WebFetchToolParameters {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

// Define tool result type
type WebFetchToolResult = ToolExecutionResult<SearchOperationMetadata>;

type WebFetchErrorType =
  | 'invalid_url'
  | 'unsupported_protocol'
  | 'allowlist_empty'
  | 'domain_not_allowed'
  | 'blocked_local_address'
  | 'blocked_private_address'
  | 'dns_resolution_failed'
  | 'http_error'
  | 'timeout'
  | 'network_error'
  | 'unknown_error';

class WebFetchError extends Error {
  readonly type: WebFetchErrorType;
  readonly details?: Record<string, unknown>;

  constructor(type: WebFetchErrorType, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'WebFetchError';
    this.type = type;
    this.details = details;
  }
}

const WEBFETCH_POLICY_ERROR_TYPES: Set<WebFetchErrorType> = new Set([
  'invalid_url',
  'unsupported_protocol',
  'allowlist_empty',
  'domain_not_allowed',
  'blocked_local_address',
  'blocked_private_address',
  'dns_resolution_failed',
]);

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  return normalized.endsWith('.') ? normalized.slice(0, -1) : normalized;
}

function normalizeUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new WebFetchError('invalid_url', 'URL cannot be empty.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new WebFetchError('invalid_url', `Invalid URL: "${rawUrl}"`);
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (!SUPPORTED_PROTOCOLS.has(protocol)) {
    throw new WebFetchError(
      'unsupported_protocol',
      `Unsupported protocol "${parsedUrl.protocol}". Only http and https are allowed.`,
      { protocol: parsedUrl.protocol }
    );
  }

  parsedUrl.protocol = protocol;
  parsedUrl.hostname = normalizeHostname(parsedUrl.hostname);
  return parsedUrl;
}

function isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
  for (const domainPattern of allowedDomains) {
    if (domainPattern.startsWith('*.')) {
      const baseDomain = domainPattern.slice(2);
      if (!baseDomain) {
        continue;
      }
      if (hostname !== baseDomain && hostname.endsWith(`.${baseDomain}`)) {
        return true;
      }
      continue;
    }

    if (hostname === domainPattern) {
      return true;
    }
  }

  return false;
}

function enforceAllowlist(hostname: string): void {
  const allowedDomains = config.tools.webfetchAllowedDomains;

  if (allowedDomains.length === 0) {
    throw new WebFetchError(
      'allowlist_empty',
      'WEBFETCH_ALLOWED_DOMAINS is empty. WebFetch is disabled until at least one allowed domain is configured.'
    );
  }

  if (!isDomainAllowed(hostname, allowedDomains)) {
    throw new WebFetchError(
      'domain_not_allowed',
      `Domain "${hostname}" is not allowed by WEBFETCH_ALLOWED_DOMAINS.`,
      { hostname, allowedDomains }
    );
  }
}

function isPrivateOrLocalIpv4(address: string): boolean {
  const octets = address.split('.').map(part => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some(octet => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  if (first === 10) return true;
  if (first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 0) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;

  return false;
}

function isPrivateOrLocalIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true; // fe80::/10

  return false;
}

function isPrivateOrLocalAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];

  const mappedIpv4Match = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedIpv4Match && isPrivateOrLocalIpv4(mappedIpv4Match[1])) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateOrLocalIpv4(normalized);
  }
  if (ipVersion === 6) {
    return isPrivateOrLocalIpv6(normalized);
  }

  return false;
}

async function enforceAddressPolicy(hostname: string): Promise<void> {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new WebFetchError('blocked_local_address', 'Localhost addresses are not allowed.', {
      hostname,
    });
  }

  const directIpVersion = isIP(hostname);
  if (directIpVersion > 0) {
    if (isPrivateOrLocalAddress(hostname)) {
      throw new WebFetchError(
        'blocked_private_address',
        `IP address "${hostname}" is private/local and cannot be fetched.`,
        { hostname }
      );
    }
    return;
  }

  let resolvedAddresses: Array<{ address: string }>;
  try {
    resolvedAddresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new WebFetchError(
      'dns_resolution_failed',
      `Failed to resolve hostname "${hostname}".`,
      { hostname, cause: String(error) }
    );
  }

  if (resolvedAddresses.length === 0) {
    throw new WebFetchError('dns_resolution_failed', `Hostname "${hostname}" did not resolve to any address.`, {
      hostname,
    });
  }

  for (const resolved of resolvedAddresses) {
    if (isPrivateOrLocalAddress(resolved.address)) {
      throw new WebFetchError(
        'blocked_private_address',
        `Hostname "${hostname}" resolves to private/local address "${resolved.address}".`,
        { hostname, address: resolved.address }
      );
    }
  }
}

function classifyWebFetchError(error: unknown): {
  type: WebFetchErrorType;
  message: string;
  details?: Record<string, unknown>;
  isPolicyError: boolean;
} {
  if (error instanceof WebFetchError) {
    return {
      type: error.type,
      message: error.message,
      details: error.details,
      isPolicyError: WEBFETCH_POLICY_ERROR_TYPES.has(error.type),
    };
  }

  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return {
      type: 'timeout',
      message: 'Request timed out after 30 seconds.',
      details: { cause: error.message },
      isPolicyError: false,
    };
  }

  if (error instanceof Error) {
    return {
      type: 'network_error',
      message: error.message,
      isPolicyError: false,
    };
  }

  return {
    type: 'unknown_error',
    message: String(error),
    isPolicyError: false,
  };
}

export const WebFetchTool = Tool.define('webfetch', {
  description:
    'Fetch content from a URL. Returns the response body as text. Useful for fetching documentation, APIs, or web pages.',
  parameters: z.object({
    url: z.string(),
    method: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
  }),
  async execute(params: WebFetchToolParameters, _ctx: ToolContext<SearchOperationMetadata>): Promise<WebFetchToolResult> {
    try {
      const normalizedUrl = normalizeUrl(params.url);
      const hostname = normalizeHostname(normalizedUrl.hostname);

      enforceAllowlist(hostname);
      await enforceAddressPolicy(hostname);

      const method = (params.method || 'GET').toUpperCase();
      const headers = params.headers || {
        'User-Agent':
          'Mozilla/5.0 (compatible; AI-Frontend-Master/1.0; +https://github.com/ai-frontend)',
      };

      const options: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(30000), // 30 second timeout
      };

      if (params.body && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
        options.body = params.body;
      }

      const response = await fetch(normalizedUrl, options);

      if (!response.ok) {
        throw new WebFetchError('http_error', `HTTP ${response.status}: ${response.statusText}`, {
          statusCode: response.status,
          statusText: response.statusText,
        });
      }

      const text = await response.text();

      return {
        title: `Fetched: ${hostname}`,
        metadata: {
          query: normalizedUrl.toString(),
          domain: hostname,
          count: text.length,
          statusCode: response.status,
        } as SearchOperationMetadata,
        output: text.slice(0, 100000), // Limit to 100KB
      };
    } catch (error) {
      const classified = classifyWebFetchError(error);
      return {
        title: classified.isPolicyError ? 'WebFetch Blocked' : 'WebFetch Error',
        metadata: {
          query: params.url,
          error: classified.message,
          errorType: classified.type,
          ...(classified.details ? { errorDetails: classified.details } : {}),
        } as SearchOperationMetadata,
        output: `WebFetch ${classified.isPolicyError ? 'blocked' : 'failed'} (${classified.type}): ${classified.message}`,
      };
    }
  },
});
