/**
 * Glob Tool - Find Files by Pattern
 * Ported from OpenCode with modifications for ai-frontend-master
 *
 * Allows AI to find files using glob patterns
 */

import { Tool } from '../tool';
import { glob } from 'glob';
import * as path from 'path';
import { z } from 'zod';
import type { SearchOperationMetadata, ToolContext, ToolExecutionResult } from '@ai-frontend/shared-types';

// Define tool result type
type GlobToolResult = ToolExecutionResult<SearchOperationMetadata>;

export const GlobTool = Tool.define('glob', {
  description:
    'Find files matching a glob pattern. Useful for discovering project structure or finding specific types of files.',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern (e.g., "**/*.ts", "src/**/*.jsx")'),
    cwd: z.string().optional().describe('Current working directory (defaults to project root)'),
    maxResults: z.number().optional().describe('Maximum number of results (defaults to 100)'),
  }),
  async execute(params, ctx: ToolContext<SearchOperationMetadata>): Promise<GlobToolResult> {
    try {
      const cwd = params.cwd || process.cwd();
      const maxResults = params.maxResults || 100;

      // Note: glob v11 doesn't have maxResults option, so we slice the results
      const files = await glob(params.pattern, {
        cwd,
        windowsPathsNoEscape: true,
      });

      // Limit results to maxResults
      const limitedFiles = files.slice(0, maxResults);

      const formatted = limitedFiles
        .map(file => path.relative(cwd, file))
        .sort()
        .join('\n');

      return {
        title: `Glob: ${params.pattern}`,
        metadata: {
          query: params.pattern,
          count: limitedFiles.length,
          maxResults,
        } as SearchOperationMetadata,
        output: `Found ${limitedFiles.length} file(s):\n${formatted || 'No files found'}`,
      };
    } catch (error) {
      return {
        title: 'Glob Error',
        metadata: {
          query: params.pattern,
          error: String(error),
        } as SearchOperationMetadata,
        output: `Glob failed: ${error}`,
      };
    }
  },
});
