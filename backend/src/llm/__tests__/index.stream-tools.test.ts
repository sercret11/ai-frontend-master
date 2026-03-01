import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentConfig } from '@ai-frontend/shared-types';
import { Agent } from '../../agent/agent';
import * as SmartBuilderModule from '../../context/integration/smart-builder';
import { ToolRegistry } from '../../tool/registry';
import { LLMService, resetDefaultLLMClient } from '../index.js';

const TRUSTED_AGENT_ID = 'repair-agent';
const UNTRUSTED_AGENT_ID = 'test-llm-stream-agent';
const TEST_COUNTER_TOOL_ID = 'test_stream_counter_tool';
const TEST_BASH_GUARD_TOOL_ID = 'test_stream_bash_guard';

const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;

function makeSSEResponse(
  events: Array<{ event: string; data: Record<string, unknown> }>,
): Response {
  const lines: string[] = [];
  for (const item of events) {
    lines.push(`event: ${item.event}`);
    lines.push(`data: ${JSON.stringify(item.data)}`);
    lines.push('');
  }
  lines.push('data: [DONE]');
  lines.push('');

  return new Response(lines.join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function buildSingleToolCallResponse(
  toolName: string,
  callID: string,
  args: Record<string, unknown>,
  options: { duplicateToolCallEnd?: boolean } = {},
): Response {
  const argsJSON = JSON.stringify(args);
  const events: Array<{ event: string; data: Record<string, unknown> }> = [
    {
      event: 'response.output_item.added',
      data: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: callID,
          name: toolName,
        },
      },
    },
    {
      event: 'response.function_call_arguments.delta',
      data: {
        type: 'response.function_call_arguments.delta',
        item_id: callID,
        delta: argsJSON,
      },
    },
    {
      event: 'response.function_call_arguments.done',
      data: {
        type: 'response.function_call_arguments.done',
        item_id: callID,
      },
    },
  ];

  if (options.duplicateToolCallEnd) {
    events.push({
      event: 'response.output_item.done',
      data: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: callID,
          name: toolName,
          arguments: argsJSON,
        },
      },
    });
  }

  events.push({
    event: 'response.completed',
    data: {
      type: 'response.completed',
      response: {
        id: `resp-${callID}`,
        output: [
          {
            type: 'function_call',
            call_id: callID,
            name: toolName,
            arguments: argsJSON,
          },
        ],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
        },
      },
    },
  });

  return makeSSEResponse(events);
}

describe('LLMService.stream tool execution', () => {
  const baseImplementer = Agent.get('frontend-implementer');
  if (!baseImplementer) {
    throw new Error('frontend-implementer agent not found');
  }

  let trustedAgent: AgentConfig;
  let untrustedAgent: AgentConfig;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENAI_BASE_URL = 'https://api.test.local';
    resetDefaultLLMClient();

    trustedAgent = {
      ...baseImplementer,
      id: TRUSTED_AGENT_ID,
      name: 'Trusted Test LLM Stream Agent',
      enabledTools: [],
      disabledTools: [],
    };

    untrustedAgent = {
      ...baseImplementer,
      id: UNTRUSTED_AGENT_ID,
      name: 'Untrusted Test LLM Stream Agent',
      enabledTools: [],
      disabledTools: [],
    };

    const realAgentHas = Agent.has;
    const realAgentGet = Agent.get;

    vi.spyOn(Agent, 'has').mockImplementation((agentId: string) => {
      if (agentId === TRUSTED_AGENT_ID || agentId === UNTRUSTED_AGENT_ID) {
        return true;
      }
      return realAgentHas(agentId);
    });

    vi.spyOn(Agent, 'get').mockImplementation((agentId: string) => {
      if (agentId === TRUSTED_AGENT_ID) {
        return trustedAgent;
      }
      if (agentId === UNTRUSTED_AGENT_ID) {
        return untrustedAgent;
      }
      return realAgentGet(agentId);
    });

    vi.spyOn(Agent, 'buildAgentPrompt').mockResolvedValue({
      prompt: 'You are a test agent.',
      sections: [],
      resources: [],
      variables: {},
      estimatedTokens: 0,
    });

    vi
      .spyOn(SmartBuilderModule, 'getSmartBuilder')
      .mockRejectedValue(new Error('skip smart context resolution in tests'));
  });

  afterEach(() => {
    vi.restoreAllMocks();

    ToolRegistry.unregister(TEST_COUNTER_TOOL_ID);
    ToolRegistry.unregister(TEST_BASH_GUARD_TOOL_ID);

    resetDefaultLLMClient();

    if (ORIGINAL_OPENAI_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_API_KEY;
    }

    if (ORIGINAL_OPENAI_BASE_URL === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = ORIGINAL_OPENAI_BASE_URL;
    }
  });

  it('executes a streamed tool call exactly once even with duplicate end events', async () => {
    const executeSpy = vi.fn(async () => ({
      title: 'ok',
      output: 'ok',
      metadata: {},
    }));

    ToolRegistry.register({
      id: TEST_COUNTER_TOOL_ID,
      init: async () => ({
        description: 'counter test tool',
        parameters: z.object({ value: z.number().optional() }),
        execute: executeSpy,
      }),
    });

    trustedAgent.enabledTools = [TEST_COUNTER_TOOL_ID];

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        buildSingleToolCallResponse(
          TEST_COUNTER_TOOL_ID,
          'call-1',
          { value: 1 },
          { duplicateToolCallEnd: true },
        ),
      );

    const onToolCall = vi.fn();
    const onToolResult = vi.fn();

    const result = await LLMService.stream({
      sessionID: 'session-1',
      messageID: 'message-1',
      agentId: TRUSTED_AGENT_ID,
      userMessage: 'run the tool once',
      modelProvider: 'openai',
      modelId: 'gpt-4o-mini',
      onToolCall,
      onToolResult,
    });

    for await (const _delta of result.textStream) {
      // drain stream
    }

    const toolCalls = await result.toolCalls;
    await result.text;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(toolCalls).toEqual([
      {
        toolName: TEST_COUNTER_TOOL_ID,
        toolCallId: 'call-1',
        args: { value: 1 },
      },
    ]);
    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolResult).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps permission policy enforcement in streamed tool execution path', async () => {
    const executeSpy = vi.fn(async () => ({
      title: 'ok',
      output: 'ok',
      metadata: {},
    }));

    ToolRegistry.register({
      id: TEST_BASH_GUARD_TOOL_ID,
      init: async () => ({
        description: 'high-risk guard tool',
        parameters: z.object({ command: z.string().optional() }),
        execute: executeSpy,
      }),
    });

    untrustedAgent.enabledTools = [TEST_BASH_GUARD_TOOL_ID];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      buildSingleToolCallResponse(TEST_BASH_GUARD_TOOL_ID, 'call-2', {
        command: 'echo should-not-run',
      }),
    );

    const onToolResult = vi.fn();

    const result = await LLMService.stream({
      sessionID: 'session-2',
      messageID: 'message-2',
      agentId: UNTRUSTED_AGENT_ID,
      userMessage: 'run guarded tool',
      modelProvider: 'openai',
      modelId: 'gpt-4o-mini',
      onToolResult,
    });

    for await (const _delta of result.textStream) {
      // drain stream
    }

    await result.toolCalls;
    await result.text;

    expect(executeSpy).not.toHaveBeenCalled();
    expect(onToolResult).toHaveBeenCalledTimes(1);

    const toolResultPayload = onToolResult.mock.calls[0]?.[0] as {
      title: string;
      output: string;
      metadata?: Record<string, unknown>;
    };
    expect(toolResultPayload.title).toBe('Tool Error');
    expect(toolResultPayload.output).toContain('[PermissionDenied:tool-permission-v1]');
    expect(toolResultPayload.metadata?.['toolExecutionFailed']).toBe(true);
  });
});
