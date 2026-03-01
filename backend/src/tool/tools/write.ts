/**
 * Write Tool - Create/Overwrite Files
 *
 * Saves files directly to FileStorage database
 */

import { Tool } from '../tool';
import { FileStorage } from '../../storage/file-storage';
import * as path from 'path';
import { z } from 'zod';
import type { FileOperationMetadata } from '@ai-frontend/shared-types';
import { normalizeWorkspaceRelativePath } from '../../security/path-safety';
import { evaluateContractWrite } from '../../orchestration/contract-policy';
import { evaluateRuntimeArtifactPath } from '../../orchestration/runtime-artifact-policy';
import { SessionStorage } from '../../session/storage';

interface WriteParams {
  filePath: string;
  content: string;
  createDirectories?: boolean;
  mode?: 'scaffold_only' | 'allow_full_overwrite';
}

export const WriteTool = Tool.define('write', {
  description:
    'Create a new file. Overwriting existing files is blocked by default and requires mode=allow_full_overwrite. For existing files, prefer apply_diff (SEARCH/REPLACE protocol).',
  parameters: z.object({
    filePath: z.string().describe('The file path (e.g., "src/App.tsx" or "components/Button.tsx")'),
    content: z.string().describe('The file content'),
    createDirectories: z.boolean().optional().describe('Whether to create parent directories (default: true)'),
    mode: z
      .enum(['scaffold_only', 'allow_full_overwrite'])
      .optional()
      .describe('Write policy. scaffold_only blocks overwriting existing files (default).'),
  }),
  async execute(params: WriteParams, ctx: any) {
    const { sessionID } = ctx;

    if (!sessionID) {
      throw new Error('Session ID is required for writing files');
    }

    try {
      const safePath = normalizeWorkspaceRelativePath(params.filePath);
      const existingFiles = FileStorage.getAllFiles(sessionID);
      const isFrontendAgent = typeof ctx.agent === 'string' && ctx.agent.startsWith('frontend-');
      const session = SessionStorage.getSession(sessionID);
      const isCreatorSession = session?.mode === 'creator';
      const defaultMode =
        isFrontendAgent || isCreatorSession ? 'allow_full_overwrite' : 'scaffold_only';
      const mode = params.mode ?? defaultMode;

      const contractDecision = evaluateContractWrite(sessionID, safePath);
      if (!contractDecision.allowed) {
        throw new Error(contractDecision.reason || 'CONTRACT_FROZEN_WRITE_BLOCKED');
      }

      const runtimePathDecision = evaluateRuntimeArtifactPath(safePath, existingFiles);
      if (!runtimePathDecision.allowed) {
        throw new Error(runtimePathDecision.reason || 'RUNTIME_ARTIFACT_PATH_BLOCKED');
      }
      const targetPath = runtimePathDecision.normalizedPath;
      const existing = existingFiles.find(file => file.path === targetPath || file.path.endsWith(targetPath));
      if (existing && mode !== 'allow_full_overwrite') {
        throw new Error(
          `Overwrite blocked for existing file "${targetPath}". Use apply_diff (SEARCH/REPLACE) or set mode=allow_full_overwrite.`
        );
      }

      // 1. Resolve language from file extension.
      const ext = path.extname(targetPath).slice(1);
      const languageMap: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'typescript',
        'js': 'javascript',
        'jsx': 'javascript',
        'css': 'css',
        'html': 'html',
        'json': 'json',
        'md': 'markdown',
        'py': 'python',
        'go': 'go',
        'rs': 'rust',
      };
      const language = languageMap[ext] || ext || 'text';

      // 2. Persist file to FileStorage.
      const saveResult = FileStorage.saveFiles(sessionID, [{
        path: targetPath,
        content: params.content,
        language,
      }]);
      if (saveResult.errors.length > 0) {
        throw new Error(saveResult.errors.join('; '));
      }

      console.log(`[WriteTool] Saved file to storage: ${targetPath} (${params.content.length} bytes)`);

      // 3. Return a concise confirmation.
      return {
        title: path.basename(targetPath),
        metadata: {
          filePath: targetPath,
          fileSize: params.content.length,
          created: !existing,
          overwritten: Boolean(existing),
          language,
        } as FileOperationMetadata,
        output: `File saved successfully: ${targetPath}`,
      };
    } catch (error) {
      console.error(`[WriteTool] Failed to save file:`, error);
      return {
        title: 'Write Error',
        metadata: {
          filePath: params.filePath,
          error: String(error),
        } as FileOperationMetadata,
        output: `Failed to write file: ${error}`,
      };
    }
  },
  formatValidationError(error: z.ZodError) {
    return `Invalid parameters for write tool: ${error.issues.map((e: z.ZodIssue) => e.message).join(', ')}`;
  },
});
