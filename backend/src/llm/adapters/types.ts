/**
 * Provider Adapter Interface
 *
 * Defines the contract that each LLM provider adapter must implement.
 * Adapters translate between the unified LLM types and provider-specific API formats.
 */

import type {
  ProviderID,
  LLMRequestParams,
  LLMResponse,
  StreamEvent,
  ToolDefinition,
  LLMError,
} from '../types.js';

/** HTTP request structure built by an adapter */
export interface AdapterRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * ProviderAdapter – abstracts away provider-specific API differences.
 *
 * Each provider (Anthropic, OpenAI, Google) implements this interface so that
 * the LLMClient can work with any provider through a single code path.
 */
export interface ProviderAdapter {
  /** Which provider this adapter handles */
  readonly id: ProviderID;

  /** Build the HTTP request (url, headers, body) from unified params */
  buildRequest(params: LLMRequestParams): AdapterRequest;

  /** Parse a non-streaming JSON response body into a unified LLMResponse */
  parseResponse(raw: unknown): LLMResponse;

  /** Parse a single SSE event into a unified StreamEvent (or null to skip) */
  parseSSEEvent(event: string, data: string): StreamEvent | null;

  /** Convert a unified ToolDefinition into the provider's tool format */
  convertToolDefinition(tool: ToolDefinition): unknown;

  /** Convert an HTTP error response into a unified LLMError */
  convertError(status: number, body: unknown): LLMError;
}
