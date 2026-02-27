/**
 * Google Provider Adapter
 *
 * Implements the ProviderAdapter interface for Google's Gemini API (generateContent).
 * Handles the Google-specific request/response format including:
 * - systemInstruction as a separate top-level field
 * - candidates[0].content.parts with text and functionCall types
 * - functionDeclarations tool format
 * - SSE streaming via generateContent?alt=sse
 */

import type {
  ProviderID,
  LLMRequestParams,
  LLMResponse,
  StreamEvent,
  ToolDefinition,
  LLMError,
  ToolCall,
} from '../types.js';
import type { ProviderAdapter, AdapterRequest } from './types.js';

// ---------------------------------------------------------------------------
// Google-specific types (internal)
// ---------------------------------------------------------------------------

interface GooglePart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GoogleContent {
  role: 'user' | 'model';
  parts: GooglePart[];
}

interface GoogleFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface GoogleCandidate {
  content?: { parts?: GooglePart[] };
  finishReason?: string;
}

interface GoogleResponseBody {
  candidates?: GoogleCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class GoogleAdapter implements ProviderAdapter {
  readonly id: ProviderID = 'google';

  private baseUrl: string;
  private apiKey: string;

  constructor(opts: { baseUrl?: string; apiKey: string }) {
    this.baseUrl = (opts.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
  }

  // ---- buildRequest -------------------------------------------------------

  buildRequest(params: LLMRequestParams): AdapterRequest {
    const contents = this.convertMessages(params);

    const body: Record<string, unknown> = { contents };

    if (params.systemPrompt) {
      body.systemInstruction = { parts: [{ text: params.systemPrompt }] };
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: params.tools.map((t) => this.convertToolDefinition(t)),
        },
      ];
    }

    const generationConfig: Record<string, unknown> = {};
    if (params.temperature !== undefined) generationConfig.temperature = params.temperature;
    if (params.topP !== undefined) generationConfig.topP = params.topP;
    if (params.maxOutputTokens !== undefined)
      generationConfig.maxOutputTokens = params.maxOutputTokens;

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    return {
      url: `${this.baseUrl}/v1beta/models/${params.model}:generateContent`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body,
    };
  }

  // ---- parseResponse ------------------------------------------------------

  parseResponse(raw: unknown): LLMResponse {
    const body = raw as GoogleResponseBody;
    const candidate = body.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        text += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${toolCalls.length}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        });
      }
    }

    return {
      text,
      toolCalls,
      finishReason: this.mapFinishReason(candidate?.finishReason),
      usage: {
        inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: body.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }

  // ---- parseSSEEvent ------------------------------------------------------

  parseSSEEvent(_event: string, data: string): StreamEvent | null {
    if (data === '[DONE]') return null;

    let parsed: GoogleResponseBody;
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }

    const candidate = parsed.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    // Google streams partial candidates – each chunk may contain text or functionCall parts
    for (const part of parts) {
      if (part.text) {
        return { type: 'text_delta', text: part.text };
      }
      if (part.functionCall) {
        // Google sends the full function call in one chunk (not streamed incrementally)
        return {
          type: 'tool_call_start',
          id: `call_${Date.now()}`,
          name: part.functionCall.name,
        };
      }
    }

    return null;
  }

  // ---- convertToolDefinition ----------------------------------------------

  convertToolDefinition(tool: ToolDefinition): GoogleFunctionDeclaration {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    };
  }

  // ---- convertError -------------------------------------------------------

  convertError(status: number, body: unknown): LLMError {
    const parsed = body as { error?: { message?: string; status?: string; code?: number } } | undefined;
    const message = parsed?.error?.message ?? `Google API error (HTTP ${status})`;
    const retryable = [429, 500, 502, 503, 504].includes(status);

    const err = new Error(message) as LLMError;
    err.provider = 'google';
    err.statusCode = status;
    err.retryable = retryable;
    err.raw = body;
    return err;
  }

  // ---- helpers ------------------------------------------------------------

  private convertMessages(params: LLMRequestParams): GoogleContent[] {
    const contents: GoogleContent[] = [];

    for (const msg of params.messages) {
      if (msg.role === 'tool_result') {
        // Google expects function responses as user-role parts
        const parts: GooglePart[] = [];
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'tool_result') {
              parts.push({
                functionResponse: {
                  name: block.name ?? block.toolUseId ?? '',
                  response: { result: block.content ?? '' },
                },
              });
            }
          }
        } else {
          parts.push({
            functionResponse: {
              name: '',
              response: { result: String(msg.content) },
            },
          });
        }
        contents.push({ role: 'user', parts });
      } else {
        const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
        if (typeof msg.content === 'string') {
          contents.push({ role, parts: [{ text: msg.content }] });
        } else {
          const parts: GooglePart[] = [];
          for (const block of msg.content) {
            if (block.type === 'text') {
              parts.push({ text: block.text ?? '' });
            } else if (block.type === 'tool_use') {
              parts.push({
                functionCall: {
                  name: block.name ?? '',
                  args: (block.input as Record<string, unknown>) ?? {},
                },
              });
            }
          }
          contents.push({ role, parts });
        }
      }
    }

    return contents;
  }

  private mapFinishReason(reason: string | undefined): LLMResponse['finishReason'] {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'max_tokens';
      case 'SAFETY':
      case 'RECITATION':
      case 'OTHER':
        return 'error';
      default:
        // If there are function calls, the finish reason might not be set
        return 'stop';
    }
  }
}
