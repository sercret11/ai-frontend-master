import { createHash } from 'node:crypto';
import { LLMService } from '../../llm/index';
import { SessionManager } from '../../session/manager';
import { FileStorage } from '../../storage/file-storage';
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  PatchIntent,
} from '../../runtime/multi-agent/types';

interface StoredFile {
  path: string;
  content: string;
}

const WRITE_REQUIRED_AGENT_IDS = new Set([
  'page-agent',
  'interaction-agent',
  'state-agent',
  'repair-agent',
]);

function toFileMap(files: StoredFile[]): Map<string, string> {
  const map = new Map<string, string>();
  files.forEach(file => {
    map.set(file.path, file.content);
  });
  return map;
}

function buildSelfAnalysisRetryPrompt(userMessage: string): string {
  return [
    'You are FrontendCreator running in autonomous recovery mode.',
    'Previous attempt produced empty output and no file mutations.',
    'Re-analyze the request and immediately materialize a complete web prototype via write/apply_diff tool calls.',
    '- Generate multiple runtime artifacts in one pass (manifest, entry, routes/components, state hooks, styles).',
    '- Include interactive workflows with forms, data surfaces, and explicit loading/empty/error/success states.',
    '- Keep naming generic/configurable and avoid hard business keywords copied from the user input.',
    '- Do not return narrative-only output. Tool-driven file mutations are mandatory.',
    `Original request: ${userMessage}`,
  ].join('\n');
}

function requiresArtifactMutation(agentId: string): boolean {
  return WRITE_REQUIRED_AGENT_IDS.has(agentId);
}

function collectPatchIntents(context: AgentExecutionContext, beforeFiles: StoredFile[]): PatchIntent[] {
  const beforeMap = toFileMap(beforeFiles);
  const afterFiles = FileStorage.getAllFiles(context.sessionId);
  const patchIntents: PatchIntent[] = [];
  const waveId = `wave-${context.task.wave}`;

  afterFiles.forEach(file => {
    const previous = beforeMap.get(file.path);
    if (previous === file.content) {
      return;
    }
    const digest = createHash('sha1').update(file.content).digest('hex');
    patchIntents.push({
      id: `intent-${context.task.id}-${patchIntents.length + 1}`,
      waveId,
      taskId: context.task.id,
      agentId: context.task.agentId,
      filePath: file.path,
      content: file.content,
      contentHash: digest,
      createdAt: Date.now(),
    });
  });

  return patchIntents;
}

export async function runLlmBackedAgent(
  context: AgentExecutionContext,
  fallbackAgentId: string,
  prompt: string
): Promise<AgentExecutionResult> {
  const normalizedModelProvider =
    context.modelProvider === 'anthropic' ||
    context.modelProvider === 'openai' ||
    context.modelProvider === 'google'
      ? context.modelProvider
      : undefined;

  const streamAttempt = async (input: {
    attemptId: string;
    progressText: string;
    agentId: string;
    userMessage: string;
    modelProvider?: 'anthropic' | 'openai' | 'google';
    modelId?: string;
  }): Promise<string> => {
    context.emitRuntimeEvent({
      type: 'agent.task.progress',
      agentId: context.task.agentId,
      taskId: context.task.id,
      waveId: `wave-${context.task.wave}`,
      progressText: input.progressText,
    });

    const llmResult = await LLMService.stream({
      sessionID: context.sessionId,
      messageID: `ma-${Date.now()}-${context.task.id}-${input.attemptId}`,
      agentId: input.agentId,
      userMessage: input.userMessage,
      mode: context.routeDecision.mode,
      platform: context.platform,
      techStack: context.techStack,
      modelProvider: input.modelProvider,
      modelId: input.modelId,
      messages: [],
      abort: context.abortSignal,
      onToolCall: call => {
        context.emitRuntimeEvent({
          type: 'tool.call.started',
          callId: call.callID,
          toolName: call.toolName,
          args: call.args,
          state: 'started',
          agentId: context.task.agentId,
          taskId: context.task.id,
          waveId: `wave-${context.task.wave}`,
        });
      },
      onToolResult: result => {
        context.emitRuntimeEvent({
          type: 'tool.call.completed',
          callId: result.callID,
          toolName: result.toolName,
          state: 'completed',
          title: result.title,
          output: result.output,
          metadata: result.metadata,
          agentId: context.task.agentId,
          taskId: context.task.id,
          waveId: `wave-${context.task.wave}`,
        });
      },
    });

    let assistantText = '';
    for await (const delta of llmResult.textStream as AsyncIterable<string>) {
      assistantText += delta;
      context.emitRuntimeEvent({
        type: 'assistant.delta',
        delta,
        agentId: context.task.agentId,
        taskId: context.task.id,
        waveId: `wave-${context.task.wave}`,
      });
    }

    const normalizedText = assistantText.trim();
    if (normalizedText.length > 0) {
      SessionManager.addAssistantMessage(
        context.sessionId,
        `[${context.task.agentId}] ${normalizedText}`
      );
    }

    return normalizedText;
  };

  const beforeFiles = FileStorage.getAllFiles(context.sessionId);
  let normalizedText = await streamAttempt({
    attemptId: 'primary',
    progressText: 'agent started LLM stream',
    agentId: fallbackAgentId,
    userMessage: prompt,
    modelProvider: normalizedModelProvider,
    modelId: context.modelId,
  });

  let patchIntents = collectPatchIntents(context, beforeFiles);
  let retryError: string | null = null;
  const shouldRunSelfAnalysisRetry =
    patchIntents.length === 0 &&
    normalizedText.length === 0 &&
    context.task.agentId === 'page-agent' &&
    !context.abortSignal.aborted;

  if (shouldRunSelfAnalysisRetry) {
    try {
      const retryText = await streamAttempt({
        attemptId: 'self-analysis',
        progressText: 'empty output detected, escalating to self-analysis retry',
        agentId: 'frontend-creator',
        userMessage: buildSelfAnalysisRetryPrompt(context.userMessage),
      });
      if (retryText.length > 0) {
        normalizedText = retryText;
      }
      patchIntents = collectPatchIntents(context, beforeFiles);
    } catch (error) {
      retryError = error instanceof Error ? error.message : String(error);
      context.emitRuntimeEvent({
        type: 'agent.task.progress',
        agentId: context.task.agentId,
        taskId: context.task.id,
        waveId: `wave-${context.task.wave}`,
        progressText: `self-analysis retry failed: ${retryError}`,
      });
    }
  }

  patchIntents.forEach(intent => {
    context.emitRuntimeEvent({
      type: 'patch.intent.submitted',
      agentId: context.task.agentId,
      taskId: context.task.id,
      waveId: intent.waveId,
      patchIntentId: intent.id,
      filePath: intent.filePath,
    });
  });

  const mutationRequired = requiresArtifactMutation(context.task.agentId);
  const success = mutationRequired ? patchIntents.length > 0 : true;

  const summary = success
    ? patchIntents.length > 0
      ? `materialized ${patchIntents.length} file updates`
      : normalizedText.length > 0
        ? normalizedText.slice(0, 140)
        : 'task completed without required artifact mutation'
    : retryError
      ? `empty model output after self-analysis retry: ${retryError}`
      : 'empty model output: no text and no file mutations';

  return {
    success,
    summary,
    assistantText: normalizedText,
    patchIntents,
    touchedFiles: patchIntents.map(item => item.filePath),
  };
}
