/**
 * Anthropic Provider Adapter
 *
 * Implements the ProviderAdapter interface for Anthropic's Messages API (/v1/messages).
 * Handles the Anthropic-specific request/response format including:
 * - system prompt as a separate top-level field (not in messages)
 * - content_block based response structure (text + tool_use)
 * - SSE events: content_block_start, content_block_delta, content_block_stop, message_delta, message_stop
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
// Anthropic-specific types (internal)
// ---------------------------------------------------------------------------

interface AnthropicContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicResponseBody {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements ProviderAdapter {
  readonly id: ProviderID = 'anthropic';

  private baseUrl: string;
  private apiKey: string;

  constructor(opts: { baseUrl?: string; apiKey: string }) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
  }

  // ---- buildRequest -------------------------------------------------------

  buildRequest(params: LLMRequestParams): AdapterRequest {
    const messages = this.convertMessages(params);
    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxOutputTokens ?? 4096,
      system: params.systemPrompt,
      messages,
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => this.convertToolDefinition(t));
    }
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.topP !== undefined) body.top_p = params.topP;

    return {
      url: `${this.baseUrl}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    };
  }

  // ---- parseResponse ------------------------------------------------------

  parseResponse(raw: unknown): LLMResponse {
    const body = raw as AnthropicResponseBody;
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const block of body.content ?? []) {
      if (block.type === 'text' && block.text) {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id ?? '',
          name: block.name ?? '',
          arguments: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }

    return {
      text,
      toolCalls,
      finishReason: this.mapStopReason(body.stop_reason),
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        totalTokens: (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0),
      },
    };
  }

  // ---- parseSSEEvent ------------------------------------------------------

  parseSSEEvent(event: string, data: string): StreamEvent | null {
    if (data === '[DONE]') return null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }

    switch (event) {
      case 'content_block_start': {
        const block = parsed.content_block as AnthropicContentBlock | undefined;
        if (block?.type === 'tool_use') {
          return { type: 'tool_call_start', id: block.id ?? '', name: block.name ?? '' };
        }
        return null;
      }

      case 'content_block_delta': {
        const delta = parsed.delta as Record<string, unknown> | undefined;
        if (!delta) return null;
        if (delta.type === 'text_delta') {
          return { type: 'text_delta', text: (delta.text as string) ?? '' };
        }
        if (delta.type === 'input_json_delta') {
          const idx = parsed.index as number | undefined;
          return {
            type: 'tool_call_delta',
            id: String(idx ?? ''),
            argumentsDelta: (delta.partial_json as string) ?? '',
          };
        }
        return null;
      }

      case 'content_block_stop': {
        const idx = parsed.index as number | undefined;
        return { type: 'tool_call_end', id: String(idx ?? '') };
      }

      case 'message_delta': {
        // message_delta carries stop_reason – we don't emit a StreamEvent for it
        // because the 'done' event is synthesized by the StreamHandler when the
        // stream ends.
        return null;
      }

      case 'message_stop': {
        return null; // handled by stream termination
      }

      default:
        return null;
    }
  }

  // ---- convertToolDefinition ----------------------------------------------

  convertToolDefinition(tool: ToolDefinition): AnthropicTool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    };
  }

  // ---- convertError -------------------------------------------------------

  convertError(status: number, body: unknown): LLMError {
    const parsed = body as { error?: { message?: string; type?: string } } | undefined;
    const message = parsed?.error?.message ?? `Anthropic API error (HTTP ${status})`;
    const retryable = [429, 500, 502, 503, 504].includes(status);

    const err = new Error(message) as LLMError;
    err.provider = 'anthropic';
    err.statusCode = status;
    err.retryable = retryable;
    err.raw = body;
    return err;
  }

  // ---- helpers ------------------------------------------------------------

  private convertMessages(params: LLMRequestParams): AnthropicMessage[] {
    return params.messages.map((msg) => {
      if (msg.role === 'tool_result') {
        // Anthropic expects tool results as user messages with tool_result content blocks
        const blocks = Array.isArray(msg.content)
          ? msg.content
              .filter((b) => b.type === 'tool_result')
              .map((b) => ({
                type: 'tool_result' as const,
                tool_use_id: b.toolUseId ?? '',
                content: b.content ?? '',
                is_error: b.isError ?? false,
              }))
          : [{ type: 'tool_result' as const, tool_use_id: '', content: String(msg.content) }];

        return { role: 'user' as const, content: blocks as unknown as AnthropicContentBlock[] };
      }

      if (typeof msg.content === 'string') {
        return { role: msg.role as 'user' | 'assistant', content: msg.content };
      }

      // Convert ContentBlock[] to Anthropic format
      const blocks: AnthropicContentBlock[] = msg.content.map((b) => {
        if (b.type === 'text') return { type: 'text' as const, text: b.text ?? '' };
        if (b.type === 'tool_use')
          return {
            type: 'tool_use' as const,
            id: b.id ?? '',
            name: b.name ?? '',
            input: b.input ?? {},
          };
        return { type: 'text' as const, text: b.content ?? '' };
      });

      return { role: msg.role as 'user' | 'assistant', content: blocks };
    });
  }

  private mapStopReason(
    reason: 'end_turn' | 'tool_use' | 'max_tokens' | null | undefined,
  ): LLMResponse['finishReason'] {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      default:
        return 'stop';
    }
  }
}
