/**
 * Grep Tool - Search File Contents
 * Ported from OpenCode with modifications for ai-frontend-master
 *
 * Allows AI to search for text patterns across multiple files
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { SearchOperationMetadata, ToolContext, ToolExecutionResult } from '@ai-frontend/shared-types';
import { Tool } from '../tool';

const execFileAsync = promisify(execFile);

interface RgExecError {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

// Define parameters type using Zod schema
const GrepToolParametersSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  filePattern: z.string().optional(),
  ignoreCase: z.boolean().optional(),
  maxResults: z.number().optional(),
});

type GrepToolParameters = z.infer<typeof GrepToolParametersSchema>;

// Define tool result type
type GrepToolResult = ToolExecutionResult<SearchOperationMetadata>;

export const GrepTool = Tool.define('grep', {
  description:
    'Search for text patterns in files using ripgrep. Supports regex, case-insensitive search, and file filtering.',
  parameters: GrepToolParametersSchema,
  async execute(params: GrepToolParameters, ctx: ToolContext<SearchOperationMetadata>): Promise<GrepToolResult> {
    try {
      const searchPath = params.path || process.cwd();
      const maxResults = params.maxResults || 50;
      const args = ['--max-count', String(maxResults), '--line-number', '--no-heading'];

      if (params.ignoreCase) {
        args.push('-i');
      }

      if (params.filePattern) {
        args.push('-g', params.filePattern);
      }

      args.push(params.pattern, searchPath);

      let stdout = '';
      let stderr = '';
      try {
        const result = await execFileAsync('rg', args, {
          cwd: process.cwd(),
          maxBuffer: 10 * 1024 * 1024, // 10MB
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (error) {
        const rgError = error as RgExecError;
        // rg exits with code 1 when no matches are found; this is a valid result.
        if (rgError.code === 1) {
          stdout = rgError.stdout || '';
          stderr = rgError.stderr || '';
        } else {
          throw error;
        }
      }

      if (stderr && !stderr.includes('warning')) {
        throw new Error(stderr.trim());
      }

      const normalizedOutput = stdout.trim();
      const resultCount = normalizedOutput ? normalizedOutput.split('\n').length : 0;

      return {
        title: `Grep: ${params.pattern}`,
        metadata: {
          query: params.pattern,
          count: resultCount,
          maxResults,
        } as SearchOperationMetadata,
        output: normalizedOutput || 'No matches found',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        title: 'Grep Error',
        metadata: {
          query: params.pattern,
          error: message,
        } as SearchOperationMetadata,
        output: `Search failed: ${message}`,
      };
    }
  },
  formatValidationError(error: z.ZodError) {
    return `Invalid parameters for grep tool: ${error.issues.map((e: z.ZodIssue) => e.message).join(', ')}`;
  },
});
