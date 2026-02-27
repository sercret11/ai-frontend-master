/**
 * OpenAI Provider Adapter
 *
 * Implements the ProviderAdapter interface for OpenAI-compatible APIs.
 *
 * Supports two protocols:
 *   1. **Responses API** (`/v1/responses`) – the PRIMARY protocol.
 *      The endpoint at `https://vpsairobot.com` ONLY supports this API.
 *   2. **Chat Completions API** (`/v1/chat/completions`) – fallback.
 *
 * The protocol is selected via the constructor `protocol` parameter.
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

export type OpenAIProtocol = 'responses' | 'chat-completions';

// ---------------------------------------------------------------------------
// OpenAI Responses API types (internal)
// ---------------------------------------------------------------------------

interface ResponsesOutputMessage {
  type: 'message';
  id?: string;
  role?: string;
  content?: Array<{ type: string; text?: string }>;
}

interface ResponsesOutputFunctionCall {
  type: 'function_call';
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
}

type ResponsesOutputItem = ResponsesOutputMessage | ResponsesOutputFunctionCall;

interface ResponsesBody {
  id?: string;
  output?: ResponsesOutputItem[];
  status?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions API types (internal)
// ---------------------------------------------------------------------------

interface ChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string | null;
}

interface ChatCompletionBody {
  id?: string;
  choices?: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenAIAdapter implements ProviderAdapter {
  readonly id: ProviderID = 'openai';

  private baseUrl: string;
  private apiKey: string;
  private protocol: OpenAIProtocol;

  constructor(opts: { baseUrl?: string; apiKey: string; protocol?: OpenAIProtocol }) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.protocol = opts.protocol ?? 'responses';
  }

  // ---- buildRequest -------------------------------------------------------

  buildRequest(params: LLMRequestParams): AdapterRequest {
    if (this.protocol === 'responses') {
      return this.buildResponsesRequest(params);
    }
    return this.buildChatCompletionsRequest(params);
  }

  // ---- parseResponse ------------------------------------------------------

  parseResponse(raw: unknown): LLMResponse {
    if (this.protocol === 'responses') {
      return this.parseResponsesResponse(raw);
    }
    return this.parseChatCompletionsResponse(raw);
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

    if (this.protocol === 'responses') {
      return this.parseResponsesSSE(event, parsed);
    }
    return this.parseChatCompletionsSSE(parsed);
  }

  // ---- convertToolDefinition ----------------------------------------------

  convertToolDefinition(tool: ToolDefinition): unknown {
    if (this.protocol === 'responses') {
      // Responses API uses a flat function tool format
      return {
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      };
    }
    // Chat Completions uses nested function format
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    };
  }

  // ---- convertError -------------------------------------------------------

  convertError(status: number, body: unknown): LLMError {
    const parsed = body as { error?: { message?: string; type?: string; code?: string } } | undefined;
    const message = parsed?.error?.message ?? `OpenAI API error (HTTP ${status})`;
    const retryable = [429, 500, 502, 503, 504].includes(status);

    const err = new Error(message) as LLMError;
    err.provider = 'openai';
    err.statusCode = status;
    err.retryable = retryable;
    err.raw = body;
    return err;
  }

  // =========================================================================
  // Responses API helpers
  // =========================================================================

  private buildResponsesRequest(params: LLMRequestParams): AdapterRequest {
    const input = this.convertMessagesToResponsesInput(params);

    const body: Record<string, unknown> = {
      model: params.model,
      input,
    };

    if (params.systemPrompt) {
      body.instructions = params.systemPrompt;
    }
    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => this.convertToolDefinition(t));
    }
    if (params.maxOutputTokens !== undefined) body.max_output_tokens = params.maxOutputTokens;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.topP !== undefined) body.top_p = params.topP;

    return {
      url: `${this.baseUrl}/v1/responses`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
    };
  }

  private parseResponsesResponse(raw: unknown): LLMResponse {
    const body = raw as ResponsesBody;
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const item of body.output ?? []) {
      if (item.type === 'message') {
        const msg = item as ResponsesOutputMessage;
        for (const part of msg.content ?? []) {
          if (part.type === 'output_text' && part.text) {
            text += part.text;
          }
        }
      } else if (item.type === 'function_call') {
        const fc = item as ResponsesOutputFunctionCall;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(fc.arguments ?? '{}');
        } catch {
          /* keep empty */
        }
        toolCalls.push({
          id: fc.call_id ?? fc.id ?? '',
          name: fc.name ?? '',
          arguments: args,
        });
      }
    }

    const hasToolCalls = toolCalls.length > 0;
    const finishReason = hasToolCalls ? 'tool_use' : 'stop';

    return {
      text,
      toolCalls,
      finishReason,
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        totalTokens: body.usage?.total_tokens ?? 0,
      },
    };
  }

  private parseResponsesSSE(event: string, parsed: Record<string, unknown>): StreamEvent | null {
    switch (event) {
      case 'response.output_item.added': {
        const item = parsed.item as Record<string, unknown> | undefined;
        if (item?.type === 'function_call') {
          return {
            type: 'tool_call_start',
            id: (item.call_id as string) ?? (item.id as string) ?? '',
            name: (item.name as string) ?? '',
          };
        }
        return null;
      }

      case 'response.content_part.delta':
      case 'response.output_text.delta': {
        const delta = (parsed.delta as string) ?? '';
        if (delta) return { type: 'text_delta', text: delta };
        return null;
      }

      case 'response.function_call_arguments.delta': {
        const delta = (parsed.delta as string) ?? '';
        const itemId = (parsed.item_id as string) ?? '';
        if (delta) return { type: 'tool_call_delta', id: itemId, argumentsDelta: delta };
        return null;
      }

      case 'response.function_call_arguments.done': {
        const itemId = (parsed.item_id as string) ?? '';
        return { type: 'tool_call_end', id: itemId };
      }

      case 'response.output_item.done': {
        const item = parsed.item as Record<string, unknown> | undefined;
        if (item?.type === 'function_call') {
          return { type: 'tool_call_end', id: (item.call_id as string) ?? (item.id as string) ?? '' };
        }
        return null;
      }

      case 'response.completed': {
        // The full response object is in parsed.response – we don't emit 'done'
        // here because the StreamHandler synthesizes it from the aggregated events.
        return null;
      }

      default:
        return null;
    }
  }

  private convertMessagesToResponsesInput(params: LLMRequestParams): unknown[] {
    const input: unknown[] = [];

    for (const msg of params.messages) {
      if (msg.role === 'tool_result') {
        // Tool results in Responses API
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'tool_result') {
              input.push({
                type: 'function_call_output',
                call_id: block.toolUseId ?? '',
                output: block.content ?? '',
              });
            }
          }
        } else {
          input.push({
            type: 'function_call_output',
            call_id: '',
            output: String(msg.content),
          });
        }
      } else {
        // user / assistant messages
        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        if (typeof msg.content === 'string') {
          input.push({ role, content: msg.content });
        } else {
          // Convert content blocks
          const parts: unknown[] = [];
          for (const block of msg.content) {
            if (block.type === 'text') {
              parts.push({ type: 'input_text', text: block.text ?? '' });
            } else if (block.type === 'tool_use') {
              // Represent prior tool calls in the input
              input.push({
                type: 'function_call',
                call_id: block.id ?? '',
                name: block.name ?? '',
                arguments: JSON.stringify(block.input ?? {}),
              });
              continue; // don't add to parts
            }
          }
          if (parts.length > 0) {
            input.push({ role, content: parts });
          }
        }
      }
    }

    return input;
  }

  // =========================================================================
  // Chat Completions API helpers
  // =========================================================================

  private buildChatCompletionsRequest(params: LLMRequestParams): AdapterRequest {
    const messages = this.convertMessagesToChatFormat(params);

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => this.convertToolDefinition(t));
    }
    if (params.maxOutputTokens !== undefined) body.max_completion_tokens = params.maxOutputTokens;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.topP !== undefined) body.top_p = params.topP;

    return {
      url: `${this.baseUrl}/v1/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
    };
  }

  private parseChatCompletionsResponse(raw: unknown): LLMResponse {
    const body = raw as ChatCompletionBody;
    const choice = body.choices?.[0];
    const text = choice?.message?.content ?? '';
    const toolCalls: ToolCall[] = [];

    for (const tc of choice?.message?.tool_calls ?? []) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        /* keep empty */
      }
      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        arguments: args,
      });
    }

    const finishReason = this.mapChatFinishReason(choice?.finish_reason);

    return {
      text,
      toolCalls,
      finishReason,
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        totalTokens: body.usage?.total_tokens ?? 0,
      },
    };
  }

  private parseChatCompletionsSSE(parsed: Record<string, unknown>): StreamEvent | null {
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) return null;

    const delta = choices[0].delta as Record<string, unknown> | undefined;
    if (!delta) return null;

    // Text delta
    if (delta.content) {
      return { type: 'text_delta', text: delta.content as string };
    }

    // Tool call deltas
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls && toolCalls.length > 0) {
      const tc = toolCalls[0];
      const fn = tc.function as Record<string, unknown> | undefined;
      const id = (tc.id as string) ?? '';
      const name = (fn?.name as string) ?? '';
      const argsDelta = (fn?.arguments as string) ?? '';

      // If we have an id and name, it's the start of a tool call
      if (id && name) {
        return { type: 'tool_call_start', id, name };
      }
      // Otherwise it's a delta
      if (argsDelta) {
        return { type: 'tool_call_delta', id, argumentsDelta: argsDelta };
      }
    }

    return null;
  }

  private convertMessagesToChatFormat(
    params: LLMRequestParams,
  ): Array<Record<string, unknown>> {
    const messages: Array<Record<string, unknown>> = [];

    // System message
    if (params.systemPrompt) {
      messages.push({ role: 'system', content: params.systemPrompt });
    }

    for (const msg of params.messages) {
      if (msg.role === 'tool_result') {
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'tool_result') {
              messages.push({
                role: 'tool',
                tool_call_id: block.toolUseId ?? '',
                content: block.content ?? '',
              });
            }
          }
        } else {
          messages.push({ role: 'tool', tool_call_id: '', content: String(msg.content) });
        }
      } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        // Assistant message with tool_use blocks
        const textParts: string[] = [];
        const toolCallsList: Array<Record<string, unknown>> = [];
        for (const block of msg.content) {
          if (block.type === 'text') textParts.push(block.text ?? '');
          if (block.type === 'tool_use') {
            toolCallsList.push({
              id: block.id ?? '',
              type: 'function',
              function: {
                name: block.name ?? '',
                arguments: JSON.stringify(block.input ?? {}),
              },
            });
          }
        }
        const chatMsg: Record<string, unknown> = {
          role: 'assistant',
          content: textParts.join('') || null,
        };
        if (toolCallsList.length > 0) chatMsg.tool_calls = toolCallsList;
        messages.push(chatMsg);
      } else {
        messages.push({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      }
    }

    return messages;
  }

  private mapChatFinishReason(reason: string | null | undefined): LLMResponse['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      default:
        return 'stop';
    }
  }
}
