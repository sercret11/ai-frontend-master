/**
 * StreamHandler – SSE stream parser for LLM provider responses.
 *
 * Reads a fetch `Response` body as an SSE stream, splits by lines,
 * and delegates event parsing to the provider's adapter via
 * `ProviderAdapter.parseSSEEvent`.
 *
 * Handles standard SSE format:
 *   - `event:` lines set the event type
 *   - `data:` lines carry the payload
 *   - Empty lines delimit events
 *   - `[DONE]` terminates the stream
 *
 * 需求: R5.4
 */

import type { StreamEvent } from './types.js';
import type { ProviderAdapter } from './adapters/types.js';

export class StreamHandler {
  /**
   * Async generator that yields standardized `StreamEvent` objects
   * from a raw SSE response stream.
   */
  async *parseSSEStream(
    response: Response,
    adapter: ProviderAdapter,
  ): AsyncGenerator<StreamEvent> {
    const body = response.body;
    if (!body) {
      return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let currentEvent = '';
    let currentData = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining buffered data before exiting
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              const result = this.processLine(line, currentEvent, currentData);
              currentEvent = result.event;
              currentData = result.data;

              if (result.dispatch) {
                const streamEvent = this.dispatchEvent(currentEvent, currentData, adapter);
                currentEvent = '';
                currentData = '';
                if (streamEvent) {
                  yield streamEvent;
                }
              }

              if (result.terminate) {
                return;
              }
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines (delimited by \n)
        const lines = buffer.split('\n');
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const result = this.processLine(line, currentEvent, currentData);
          currentEvent = result.event;
          currentData = result.data;

          if (result.dispatch) {
            const streamEvent = this.dispatchEvent(currentEvent, currentData, adapter);
            currentEvent = '';
            currentData = '';
            if (streamEvent) {
              yield streamEvent;
            }
          }

          if (result.terminate) {
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Process a single SSE line, updating event/data state.
   * Returns whether to dispatch the accumulated event or terminate.
   */
  private processLine(
    line: string,
    currentEvent: string,
    currentData: string,
  ): { event: string; data: string; dispatch: boolean; terminate: boolean } {
    // Empty line = event boundary → dispatch accumulated event
    if (line.trim() === '') {
      if (currentData) {
        return { event: currentEvent, data: currentData, dispatch: true, terminate: false };
      }
      return { event: '', data: '', dispatch: false, terminate: false };
    }

    // `event:` line
    if (line.startsWith('event:')) {
      return {
        event: line.slice('event:'.length).trim(),
        data: currentData,
        dispatch: false,
        terminate: false,
      };
    }

    // `data:` line
    if (line.startsWith('data:')) {
      const payload = line.slice('data:'.length).trim();

      // [DONE] marker terminates the stream
      if (payload === '[DONE]') {
        return { event: currentEvent, data: currentData, dispatch: false, terminate: true };
      }

      // Append data (multiple `data:` lines are joined with newline per SSE spec)
      const newData = currentData ? currentData + '\n' + payload : payload;
      return { event: currentEvent, data: newData, dispatch: false, terminate: false };
    }

    // Comment lines (starting with `:`) and unknown lines are ignored
    return { event: currentEvent, data: currentData, dispatch: false, terminate: false };
  }

  /**
   * Dispatch an accumulated SSE event through the provider adapter.
   */
  private dispatchEvent(
    event: string,
    data: string,
    adapter: ProviderAdapter,
  ): StreamEvent | null {
    if (!data) {
      return null;
    }
    return adapter.parseSSEEvent(event, data);
  }
}
