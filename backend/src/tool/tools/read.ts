/**
 * Read Tool - Read File Contents
 * Ported from OpenCode with modifications for ai-frontend-master
 *
 * Allows AI to read file contents from the filesystem
 * with support for line ranges and large files
 */

import { Tool } from '../tool';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import type { FileOperationMetadata, ToolContext, ToolExecutionResult } from '@ai-frontend/shared-types';
import { FileStorage } from '../../storage/file-storage';
import { normalizeWorkspaceRelativePath, resolvePathWithinBase } from '../../security/path-safety';

// Define parameters schema using Zod
const readToolSchema = z.object({
  filePath: z.string().describe('Absolute or relative path to the file to read'),
  offset: z.number().optional().describe('Line number to start reading from (0-based, defaults to 0)'),
  limit: z.number().optional().describe('Maximum number of lines to read (defaults to 2000)'),
});

// Define tool result type
type ReadToolResult = ToolExecutionResult<FileOperationMetadata>;
type ReadBudgetState = {
  totalCalls: number;
  uniquePaths: Set<string>;
};

const READ_BUDGET_BY_MESSAGE = new Map<string, ReadBudgetState>();
const MAX_READ_CALLS_PER_MESSAGE = 24;
const MAX_UNIQUE_READ_PATHS_PER_MESSAGE = 12;

type ValidatedReadPath = {
  canonicalInputPath: string;
  safeRelativePath: string | null;
};

function normalizePathLike(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function normalizeBudgetPath(input: string): string {
  const normalized = normalizePathLike(input).replace(/\/+/g, '/').replace(/\/$/, '');
  return normalized || '.';
}

function validateReadPathInput(filePath: string): ValidatedReadPath {
  const trimmed = (filePath || '').trim();
  if (!trimmed) {
    throw new Error('Path must not be empty');
  }

  const posixPath = trimmed.replace(/\\/g, '/');
  const withoutTrailingSlash = posixPath.replace(/\/+$/, '');

  if (withoutTrailingSlash === '' || withoutTrailingSlash === '.') {
    return {
      canonicalInputPath: '.',
      safeRelativePath: null,
    };
  }

  const safeRelativePath = normalizeWorkspaceRelativePath(withoutTrailingSlash);
  return {
    canonicalInputPath: posixPath.endsWith('/') ? `${safeRelativePath}/` : safeRelativePath,
    safeRelativePath,
  };
}

function resolveSessionDirectoryListing(
  sessionFiles: Array<{ path: string }>,
  filePath: string
): { rootPath: string; files: string[] } | null {
  const normalizedInput = normalizePathLike(filePath).replace(/\/+$/, '');
  const isRootRequest = normalizedInput === '' || normalizedInput === '.';
  const prefix = isRootRequest ? '' : `${normalizedInput}/`;
  const matches = sessionFiles
    .map(file => normalizePathLike(file.path))
    .filter(storedPath => (isRootRequest ? true : storedPath.startsWith(prefix)))
    .sort((left, right) => left.localeCompare(right));

  if (matches.length === 0) {
    return null;
  }

  const explicitDirectoryRequest = isRootRequest || normalizePathLike(filePath).endsWith('/');
  if (!explicitDirectoryRequest && !isRootRequest) {
    return {
      rootPath: normalizedInput,
      files: matches,
    };
  }

  return {
    rootPath: isRootRequest ? '.' : normalizedInput,
    files: matches,
  };
}

function resolveSessionFile(sessionID: string, filePath: string) {
  const candidates = new Set<string>();
  const normalized = normalizePathLike(filePath);
  if (normalized) {
    candidates.add(normalized);
  }
  try {
    const safePath = normalizeWorkspaceRelativePath(filePath);
    if (safePath) {
      candidates.add(safePath);
    }
  } catch {
    // Ignore invalid path normalization and keep best-effort candidates.
  }

  for (const candidate of candidates) {
    const exact = FileStorage.getFile(sessionID, candidate);
    if (exact) {
      return exact;
    }
  }

  const sessionFiles = FileStorage.getAllFiles(sessionID);
  for (const file of sessionFiles) {
    const stored = normalizePathLike(file.path);
    for (const candidate of candidates) {
      if (
        stored === candidate ||
        stored.endsWith(`/${candidate}`) ||
        candidate.endsWith(`/${stored}`)
      ) {
        return file;
      }
    }
  }

  return null;
}

export const ReadTool = Tool.define('read', {
  description: 'Read the contents of a file from the filesystem with support for line ranges and large files',
  parameters: readToolSchema,
  async execute(params, ctx: ToolContext<FileOperationMetadata>): Promise<ReadToolResult> {
    let validatedPath: ValidatedReadPath;
    try {
      validatedPath = validateReadPathInput(params.filePath);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        title: 'Invalid Path',
        metadata: {
          filePath: params.filePath,
          error: `PATH_NOT_ALLOWED: ${errorMessage}`,
        } as FileOperationMetadata,
        output: `PATH_NOT_ALLOWED: ${errorMessage}`,
      };
    }

    let filepath = validatedPath.canonicalInputPath;
    let content = '';
    let metadataPath = validatedPath.canonicalInputPath;
    let relativePath = validatedPath.safeRelativePath ?? '.';
    let allowFilesystemFallback = true;

    if (ctx.sessionID) {
      const sessionFiles = FileStorage.getAllFiles(ctx.sessionID);
      const isFrontendAgent = typeof ctx.agent === 'string' && ctx.agent.startsWith('frontend-');
      if (sessionFiles.length > 0) {
        const readBudgetKey = `${ctx.sessionID}:${ctx.messageID}`;
        const budgetState = READ_BUDGET_BY_MESSAGE.get(readBudgetKey) || {
          totalCalls: 0,
          uniquePaths: new Set<string>(),
        };
        budgetState.totalCalls += 1;
        budgetState.uniquePaths.add(normalizeBudgetPath(validatedPath.canonicalInputPath));
        READ_BUDGET_BY_MESSAGE.set(readBudgetKey, budgetState);
        console.log('[ReadTool] Session-aware read', {
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          filePath: validatedPath.canonicalInputPath,
          sessionFiles: sessionFiles.length,
          readCount: budgetState.totalCalls,
          uniquePathCount: budgetState.uniquePaths.size,
        });
        if (READ_BUDGET_BY_MESSAGE.size > 500) {
          const oldestKey = READ_BUDGET_BY_MESSAGE.keys().next().value;
          if (oldestKey) {
            READ_BUDGET_BY_MESSAGE.delete(oldestKey);
          }
        }
        if (
          budgetState.totalCalls > MAX_READ_CALLS_PER_MESSAGE ||
          budgetState.uniquePaths.size > MAX_UNIQUE_READ_PATHS_PER_MESSAGE
        ) {
          console.warn('[ReadTool] Read budget exceeded', {
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            filePath: validatedPath.canonicalInputPath,
            readCount: budgetState.totalCalls,
            uniquePathCount: budgetState.uniquePaths.size,
          });
          return {
            title: 'Read Budget Exceeded',
            metadata: {
              filePath: validatedPath.canonicalInputPath,
              error: `READ_BUDGET_EXCEEDED: Maximum ${MAX_READ_CALLS_PER_MESSAGE} read calls or ${MAX_UNIQUE_READ_PATHS_PER_MESSAGE} unique paths allowed per iteration when session artifacts exist`,
            } as FileOperationMetadata,
            output: `READ_BUDGET_EXCEEDED: You already used ${budgetState.totalCalls} read calls across ${budgetState.uniquePaths.size} unique paths in this iteration. Stop reading and use apply_diff to modify session artifacts.`,
          };
        }
      }

      const sessionFile = resolveSessionFile(ctx.sessionID, validatedPath.canonicalInputPath);
      if (sessionFile) {
        content = sessionFile.content;
        metadataPath = sessionFile.path;
        relativePath = sessionFile.path;
        allowFilesystemFallback = false;
      } else {
        if (sessionFiles.length === 0 && isFrontendAgent) {
          return {
            title: 'Write Structure First',
            metadata: {
              filePath: validatedPath.canonicalInputPath,
              relativePath: validatedPath.canonicalInputPath,
              error:
                'WRITE_FIRST_REQUIRED: session has no artifacts yet; create runtime structure files before read',
            } as FileOperationMetadata,
            output:
              'WRITE_FIRST_REQUIRED: Session artifacts are empty. Create structure-first runtime artifacts (manifest, host entry, framework entry, and core src roots) using write/apply_diff before calling read.',
          };
        }

        const directoryListing = resolveSessionDirectoryListing(
          sessionFiles,
          validatedPath.canonicalInputPath
        );
        if (directoryListing) {
          return {
            title: `${directoryListing.rootPath} (session files)`,
            metadata: {
              filePath: directoryListing.rootPath,
              relativePath: directoryListing.rootPath,
              lineCount: directoryListing.files.length,
              truncated: false,
            } as FileOperationMetadata,
            output: `<files>\n${directoryListing.files
              .map((filePath, index) => `${(index + 1).toString().padStart(5, '0')}| ${filePath}`)
              .join('\n')}\n</files>\n\n(Listed ${directoryListing.files.length} files under ${directoryListing.rootPath})`,
          };
        }

        if (validatedPath.safeRelativePath) {
          const hasSessionFiles = sessionFiles.length > 0;
          if (hasSessionFiles) {
            allowFilesystemFallback = false;
          }
        }
      }
    }

    if (!content && allowFilesystemFallback) {
      if (!validatedPath.safeRelativePath) {
        return {
          title: 'Invalid Path',
          metadata: {
            filePath: validatedPath.canonicalInputPath,
            relativePath,
            error: 'PATH_NOT_ALLOWED: Directory path is not allowed for filesystem reads',
          } as FileOperationMetadata,
          output: 'PATH_NOT_ALLOWED: Directory path is not allowed for filesystem reads',
        };
      }
      filepath = resolvePathWithinBase(process.cwd(), validatedPath.safeRelativePath);
      metadataPath = filepath;
      relativePath = validatedPath.safeRelativePath;
    }

    try {
      if (!content && !allowFilesystemFallback) {
        return {
          title: 'File Not Found',
          metadata: {
            filePath: metadataPath,
            relativePath,
            error: 'File does not exist in current session artifacts',
          } as FileOperationMetadata,
          output: `Error: File not found in session artifacts: ${metadataPath}`,
        };
      }

      if (!content) {
        // Check if file exists
        try {
          await fs.access(filepath);
        } catch {
          return {
            title: 'File Not Found',
            metadata: {
              filePath: filepath,
              error: 'File does not exist',
            } as FileOperationMetadata,
            output: `Error: File not found: ${filepath}`,
          };
        }

        // Read file content
        content = await fs.readFile(filepath, 'utf-8');
      }

      const lines = content.split('\n');

      const offset = params.offset || 0;
      const limit = params.limit || 2000;

      // Validate offset
      if (offset < 0 || offset >= lines.length) {
        return {
          title: path.basename(metadataPath),
          metadata: {
            filePath: metadataPath,
            relativePath,
            lineCount: lines.length,
            error: `Invalid offset: ${offset}. File has ${lines.length} lines (0-${lines.length - 1})`,
          } as FileOperationMetadata,
          output: `Error: Offset ${offset} is out of bounds. File has ${lines.length} lines.`,
        };
      }

      // Extract lines
      const selectedLines = lines.slice(offset, offset + limit);

      // Format output with line numbers
      let output = '<file>\n';
      output += selectedLines
        .map((line, idx) => `${(idx + offset + 1).toString().padStart(5, '0')}| ${line}`)
        .join('\n');
      output += '\n</file>';

      // Add truncation message if needed
      if (lines.length > offset + selectedLines.length) {
        output += `\n\n(File has ${lines.length} lines total. Showing lines ${offset}-${offset + selectedLines.length - 1}. Use offset parameter to read more.)`;
      }

      return {
        title: path.basename(metadataPath),
        metadata: {
          filePath: metadataPath,
          relativePath,
          lineCount: lines.length,
          truncated: lines.length > offset + selectedLines.length,
        } as FileOperationMetadata,
        output,
      };
    } catch (error) {
      return {
        title: 'Read Error',
        metadata: {
          filePath: metadataPath,
          error: String(error),
        } as FileOperationMetadata,
        output: `Failed to read file: ${error}`,
      };
    }
  },
  formatValidationError(error: z.ZodError) {
    return `Invalid parameters for read tool: ${error.issues.map((e: z.ZodIssue) => e.message).join(', ')}`;
  },
});
