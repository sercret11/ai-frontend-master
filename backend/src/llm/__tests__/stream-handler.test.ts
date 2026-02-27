/**
 * StreamHandler Unit Tests
 *
 * Tests SSE stream parsing: event/data lines, empty line delimiters,
 * [DONE] termination, multi-data lines, and adapter delegation.
 *
 * 需求: R5.4
 */

import { describe, it, expect, vi } from 'vitest';
import { StreamHandler } from '../stream-handler.js';
import type { ProviderAdapter } from '../adapters/types.js';
import type { StreamEvent } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake Response whose body streams the given SSE text. */
function makeSSEResponse(sseText: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    },
  });
  return new Response(stream);
}

/** Build a fake Response that streams chunks one at a time. */
function makeChunkedSSEResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream);
}

/** Minimal mock adapter that delegates parseSSEEvent to a spy. */
function makeMockAdapter(
  parseFn?: (event: string, data: string) => StreamEvent | null,
): ProviderAdapter {
  return {
    id: 'openai',
    buildRequest: vi.fn() as any,
    parseResponse: vi.fn() as any,
    parseSSEEvent: parseFn ?? ((event: string, data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.text) {
          return { type: 'text_delta', text: parsed.text } as StreamEvent;
        }
      } catch {
        // ignore
      }
      return null;
    }),
    convertToolDefinition: vi.fn() as any,
    convertError: vi.fn() as any,
  };
}

async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const evt of gen) {
    events.push(evt);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamHandler', () => {
  const handler = new StreamHandler();

  it('parses a simple text delta event', async () => {
    const sse = 'data: {"text":"Hello"}\n\n';
    const response = makeSSEResponse(sse);
    const adapter = makeMockAdapter();

    const events = await collectEvents(handler.parseSSEStream(response, adapter));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text_delta', text: 'Hello' });
  });

  it('parses multiple events separated by empty lines', async () => {
    const sse = 'data: {"text":"Hello"}\n\ndata: {"text":" world"}\n\n';
    const response = makeSSEResponse(sse);
    const adapter = makeMockAdapter();

    const events = await collectEvents(handler.parseSSEStream(response, adapter));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'text_delta', text: 'Hello' });
    expect(events[1]).toEqual({ type: 'text_delta', text: ' world' });
  });

  it('handles event: lines and passes event type to adapter', async () => {
    const parseSpy = vi.fn().mockReturnValue({ type: 'text_delta', text: 'hi' } as StreamEvent);
    const adapter = makeMockAdapter(parseSpy);

    const sse = 'event: content_block_delta\ndata: {"delta":"hi"}\n\n';
    const response = makeSSEResponse(sse);

    await collectEvents(handler.parseSSEStream(response, adapter));

    expect(parseSpy).toHaveBeenCalledWith('content_block_delta', '{"delta":"hi"}');
  });

  it('terminates on [DONE] marker', async () => {
    const sse = 'data: {"text":"Hello"}\n\ndata: [DONE]\n\ndata: {"text":"should not appear"}\n\n';
    const response = makeSSEResponse(sse);
    const adapter = makeMockAdapter();

    const events = await collectEvents(handler.parseSSEStream(response, adapter));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text_delta', text: 'Hello' });
  });

  it('skips events when adapter returns null', async () => {
    const adapter = makeMockAdapter(() => null);

    const sse = 'data: {"ignored":true}\n\ndata: {"also_ignored":true}\n\n';
    const response = makeSSEResponse(sse);

    const events = await collectEvents(handler.parseSSEStream(response, adapter));

    expect(events).toHaveLength(0);
  });

  it('handles empty response body gracefully', async () => {
    const response = new Response(null);
    const adapter = makeMockAdapter();

    const events = await collectEvents(handler.parseSSEStream(response, adapter));

    expect(events).toHaveLength(0);
  });

  it('handles chunked delivery across multiple reads', async () => {
    // Split an SSE event across two chunks
    const chunks = [
      'data: {"tex',
      't":"chunked"}\n\n',
    ];
    const response = makeChunkedSSEResponse(chunks);
    const adapter = makeMockAdapter();

    const events = await collectEvents(handler.parseSSEStream(response, adapter));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text_delta', text: 'chunked' });
  });

  it('ignores SSE comment lines (starting with :)', async () => {
    const sse = ': this is a comment\ndata: {"text":"real"}\n\n';
    const response = makeSSEResponse(sse);
    const adapter = makeMockAdapter();

    const events = await collectEvents(handler.parseSSEStream(response, adapter));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text_delta', text: 'real' });
  });

  it('joins multiple data: lines with newline per SSE spec', async () => {
    const parseSpy = vi.fn().mockReturnValue({ type: 'text_delta', text: 'joined' } as StreamEvent);
    const adapter = makeMockAdapter(parseSpy);

    const sse = 'data: line1\ndata: line2\n\n';
    const response = makeSSEResponse(sse);

    await collectEvents(handler.parseSSEStream(response, adapter));

    expect(parseSpy).toHaveBeenCalledWith('', 'line1\nline2');
  });

  it('resets event type between dispatches', async () => {
    const parseSpy = vi.fn().mockReturnValue({ type: 'text_delta', text: 'x' } as StreamEvent);
    const adapter = makeMockAdapter(parseSpy);

    const sse = 'event: first_type\ndata: {"a":1}\n\ndata: {"b":2}\n\n';
    const response = makeSSEResponse(sse);

    await collectEvents(handler.parseSSEStream(response, adapter));

    // First call should have event type "first_type"
    expect(parseSpy).toHaveBeenNthCalledWith(1, 'first_type', '{"a":1}');
    // Second call should have empty event type (reset after dispatch)
    expect(parseSpy).toHaveBeenNthCalledWith(2, '', '{"b":2}');
  });

  it('handles [DONE] with event prefix', async () => {
    const sse = 'event: done\ndata: [DONE]\n\n';
    const response = makeSSEResponse(sse);
    const adapter = makeMockAdapter();

    const events = await collectEvents(handler.parseSSEStream(response, adapter));

    expect(events).toHaveLength(0);
  });

  it('handles Windows-style line endings (\\r\\n)', async () => {
    // The \\r will be part of the line but trim() in processLine handles it
    const sse = 'data: {"text":"crlf"}\r\n\r\n';
    const response = makeSSEResponse(sse);
    const adapter = makeMockAdapter();

    const events = await collectEvents(handler.parseSSEStream(response, adapter));

    expect(events).toHaveLength(1);
  });
});
