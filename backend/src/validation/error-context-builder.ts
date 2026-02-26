/**
 * Error Context Builder - Build structured error context for LLM agent
 *
 * This module builds comprehensive error context including:
 * - Error summaries
 * - File contents with error line contexts
 * - Related files
 */

import { promises as fs } from 'fs';
import path from 'path';
import { ErrorCategory, ParsedError, ErrorContext, FileContext, ErrorLineContext } from '@ai-frontend/shared-types';
import { ErrorClassifier } from './error-classifier';

/**
 * ErrorContextBuilder namespace
 */
export namespace ErrorContextBuilder {
  /**
   * Build complete error context for LLM agent
   */
  export async function build(
    sessionID: string,
    errors: ParsedError[],
    template?: string
  ): Promise<ErrorContext> {
    console.log(`[ErrorContextBuilder] Building context for ${errors.length} errors`);

    // Get unique files from errors
    const filePaths = ErrorClassifier.extractUniqueFiles(errors);
    console.log(`[ErrorContextBuilder] Processing ${filePaths.length} files`);

    // Build file contexts for each file
    const fileContexts: FileContext[] = [];
    for (const filePath of filePaths) {
      const context = await getFileContext(sessionID, filePath, errors);
      fileContexts.push(context);
    }

    // Generate summary
    const summary = summarizeErrors(errors);

    const context: ErrorContext = {
      sessionID,
      template,
      summary,
      errors,
      fileContexts,
      timestamp: Date.now(),
    };

    console.log(`[ErrorContextBuilder] Context built: ${summary}`);
    return context;
  }

  /**
   * Get file context including error lines and surrounding context
   */
  async function getFileContext(
    sessionID: string,
    filePath: string,
    errors: ParsedError[]
  ): Promise<FileContext> {
    // Get file from FileStorage
    const { FileStorage } = await import('../storage/file-storage');
    const files = FileStorage.getAllFiles(sessionID);
    const file = files.find(f => f.path === filePath || f.path.endsWith(filePath));

    if (!file) {
      console.warn(`[ErrorContextBuilder] File not found: ${filePath}`);
      // Return minimal context for missing file
      return {
        path: filePath,
        content: '// File not found - needs to be created',
        language: getLanguageFromPath(filePath),
        errorLines: [],
      };
    }

    // Extract error line numbers for this file
    const errorLineNumbers = ErrorClassifier.extractErrorLines(errors, filePath);

    // Build error line contexts
    const lines = file.content.split('\n');
    const errorLineContexts: ErrorLineContext[] = [];

    for (const lineNumber of errorLineNumbers) {
      const actualLineNumber = lineNumber - 1; // Convert to 0-based
      const contextBefore = lines.slice(
        Math.max(0, actualLineNumber - 3),
        actualLineNumber
      );
      const contextAfter = lines.slice(
        actualLineNumber + 1,
        Math.min(lines.length, actualLineNumber + 4)
      );

      errorLineContexts.push({
        lineNumber,
        content: lines[actualLineNumber] || '',
        contextBefore,
        contextAfter,
      });
    }

    return {
      path: filePath,
      content: file.content,
      language: file.language,
      errorLines: errorLineContexts,
    };
  }

  /**
   * Summarize errors for LLM
   */
  function summarizeErrors(errors: ParsedError[]): string {
    const byCategory = ErrorClassifier.countErrorsByCategory(errors);
    const parts: string[] = [];

    for (const [category, count] of byCategory.entries()) {
      parts.push(`${count} ${category.replace(/_/g, ' ')}s`);
    }

    return `Found ${errors.length} error${errors.length !== 1 ? 's' : ''}: ${parts.join(', ')}`;
  }

  /**
   * Format error context for LLM prompt
   */
  export function formatForLLM(context: ErrorContext): string {
    let prompt = `# Self-Repair Task\n\n`;
    prompt += `Session: ${context.sessionID}\n`;
    prompt += `${context.summary}\n\n`;

    // Errors section
    prompt += `## Errors (${context.errors.length} total)\n\n`;
    for (let i = 0; i < context.errors.length; i++) {
      const error = context.errors[i];
      prompt += `### Error ${i + 1}: ${error.category}\n`;
      prompt += `- **Message**: ${error.message}\n`;
      if (error.file) {
        prompt += `- **File**: ${error.file}\n`;
        if (error.line) prompt += `- **Line**: ${error.line}\n`;
        if (error.column) prompt += `- **Column**: ${error.column}\n`;
      }
      if (error.missingPackage) {
        prompt += `- **Missing Package**: \`${error.missingPackage}\`\n`;
      }
      if (error.code) prompt += `- **Error Code**: ${error.code}\n`;
      prompt += `- **Raw**: \`${error.raw}\`\n`;
      prompt += `\n`;
    }

    // File contexts section
    prompt += `## File Contexts\n\n`;
    for (const fileCtx of context.fileContexts) {
      prompt += `### ${fileCtx.path}\n`;
      prompt += `\`\`\`${fileCtx.language}\n`;

      // If there are error lines, show them with context
      if (fileCtx.errorLines.length > 0) {
        // Show only lines around errors (±3 lines)
        const lines = fileCtx.content.split('\n');
        const allErrorLines = new Set<number>();
        for (const errorLine of fileCtx.errorLines) {
          allErrorLines.add(errorLine.lineNumber);
        }

        const sortedLines = Array.from(allErrorLines).sort((a, b) => a - b);
        for (const lineNum of sortedLines) {
          const startLine = Math.max(1, lineNum - 3);
          const endLine = Math.min(lines.length, lineNum + 4);

          for (let i = startLine - 1; i < endLine - 1; i++) {
            const isErrorLine = i === lineNum - 1;
            const prefix = i + 1 === lineNum ? '> ' : '  ';
            prompt += `${prefix}${lines[i]}\n`;
          }

          prompt += `\n// ... ${
            lines.length - endLine
          } more lines ...\n\n`;
        }
      } else {
        // No specific error lines, show truncated file
        const maxLines = 50;
        const lines = fileCtx.content.split('\n');
        if (lines.length > maxLines) {
          prompt += lines.slice(0, maxLines).join('\n');
          prompt += `\n// ... ${lines.length - maxLines} more lines ...\n`;
        } else {
          prompt += fileCtx.content;
        }
      }

      prompt += `\`\`\`\n\n`;
    }

    return prompt;
  }

  /**
   * Create a concise repair prompt (shorter version)
   */
  export function createRepairPrompt(
    context: ErrorContext,
    attemptNumber: number
  ): string {
    let prompt = `# Self-Repair Task (Attempt ${attemptNumber})\n\n`;
    prompt += `You are in **Self-Repair Mode**. Fix the following validation errors using available tools.\n\n`;
    prompt += `## Error Summary\n${context.summary}\n\n`;

    // Detailed errors (first 10 to avoid context overflow)
    const maxErrors = 10;
    const errorsToShow = context.errors.slice(0, maxErrors);

    prompt += `## Errors (${errorsToShow.length}${context.errors.length > maxErrors ? ` (showing first ${maxErrors})` : ''})\n\n`;
    for (let i = 0; i < errorsToShow.length; i++) {
      const error = errorsToShow[i];
      prompt += `### Error ${i + 1}: ${error.category}\n`;
      prompt += `- **Message**: ${error.message}\n`;
      if (error.file) {
        prompt += `- **File**: ${error.file}\n`;
        if (error.line) prompt += `- **Line**: ${error.line}\n`;
      }
      if (error.missingPackage) {
        prompt += `- **Missing Package**: \`${error.missingPackage}\`\n`;
      }
      prompt += `\n`;
    }

    if (context.errors.length > maxErrors) {
      prompt += `*... and ${context.errors.length - maxErrors} more errors*\n\n`;
    }

    // Available tools
    prompt += `## Available Tools\n`;
    prompt += `- \`read(filePath)\`: Read file content\n`;
    prompt += `- \`write(filePath, content)\`: Write or overwrite file (prefer only for new files)\n`;
    prompt += `- \`apply_diff(filePath, patch)\`: Modify existing file via SEARCH/REPLACE blocks only\n\n`;
    prompt += `### apply_diff required format\n`;
    prompt += '```text\n';
    prompt += '<<<<<<< SEARCH\n';
    prompt += '// include unchanged context lines before/after target\n';
    prompt += '=======\n';
    prompt += '// replacement code\n';
    prompt += '>>>>>>> REPLACE\n';
    prompt += '```\n\n';

    // Repair guidelines
    prompt += `## Repair Guidelines\n`;
    prompt += `1. **Analyze all errors** before fixing\n`;
    prompt += `2. **Fix root causes first** (missing files before imports)\n`;
    prompt += `3. **Use apply_diff first** for edits; do not rewrite whole files\n`;
    prompt += `4. **Minimal changes**: Fix only what's broken\n`;
    prompt += `5. **Best practices**: Follow existing code patterns\n\n`;

    prompt += `Please repair these errors now.\n`;

    return prompt;
  }

  /**
   * Get related files that might need attention
   */
  export async function getRelatedFiles(
    sessionID: string,
    errors: ParsedError[]
  ): Promise<string[]> {
    const related = new Set<string>();

    // Add files mentioned in errors
    for (const error of errors) {
      if (error.file) {
        related.add(error.file);

        // Add parent directories
        const parts = error.file.split('/');
        while (parts.length > 1) {
          parts.pop();
          related.add(parts.join('/'));
        }

        // Add index files in same directory
        const dir = error.file.substring(0, error.file.lastIndexOf('/'));
        related.add(path.join(dir, 'index.ts'));
        related.add(path.join(dir, 'index.tsx'));
        related.add(path.join(dir, 'index.js'));
        related.add(path.join(dir, 'index.jsx'));
      }
    }

    // Add common config files
    related.add('package.json');
    related.add('tsconfig.json');

    // Filter to files that exist in FileStorage
    const { FileStorage } = await import('../storage/file-storage');
    const allFiles = FileStorage.getAllFiles(sessionID);
    const allFilePaths = new Set(allFiles.map(f => f.path));

    return Array.from(related).filter(path => allFilePaths.has(path));
  }

  /**
   * Extract package name from import error
   */
  export function extractPackageName(error: ParsedError): string | null {
    if (error.missingPackage) {
      return error.missingPackage;
    }

    // Try to extract from error message
    const patterns = [
      /Cannot find module ['"]([^'"]+)['"]/,
      /Cannot find import ['"]([^'"]+)['"]/,
      /error TS2307: Cannot find module ['"]([^'"]+)['"]/,
    ];

    for (const pattern of patterns) {
      const match = error.message.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Determine language from file path
   */
  function getLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath);
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.json': 'json',
      '.md': 'markdown',
      '.css': 'css',
      '.scss': 'scss',
      '.less': 'less',
      '.html': 'html',
      '.xml': 'xml',
    };

    return langMap[ext] || 'text';
  }

  /**
   * Check if error is related to missing types
   */
  export function isMissingTypesError(error: ParsedError): boolean {
    return (
      error.category === ErrorCategory.TYPE_ERROR &&
      (error.code === 'TS2307' || error.message.includes('type declarations'))
    );
  }

  /**
   * Suggest @types package for a given package
   */
  export function suggestTypesPackage(packageName: string): string {
    // Some packages have different @types name
    const mappings: Record<string, string> = {
      'node': '',
      'react': 'react',
      'react-dom': 'react-dom',
      'lodash': 'lodash',
    };

    const typesPkg = mappings[packageName] || packageName;
    return typesPkg ? `@types/${typesPkg}` : '';
  }

  /**
   * Get all errors that are repairable
   */
  export function getRepairableErrors(errors: ParsedError[]): ParsedError[] {
    return errors.filter(error =>
      error.category === ErrorCategory.MISSING_DEPENDENCY ||
      error.category === ErrorCategory.TYPE_ERROR ||
      error.category === ErrorCategory.IMPORT_ERROR ||
      error.category === ErrorCategory.SYNTAX_ERROR ||
      error.category === ErrorCategory.CONFIG_ERROR
    );
  }

  /**
   * Get all errors that are fatal (non-repairable)
   */
  export function getFatalErrors(errors: ParsedError[]): ParsedError[] {
    return errors.filter(error => !ErrorClassifier.isRepairableError(error));
  }

  /**
   * Build repair suggestions (as hints, not decisions)
   */
  export function buildSuggestions(errors: ParsedError[]): string[] {
    const suggestions = new Set<string>();

    for (const error of errors) {
      switch (error.category) {
        case ErrorCategory.MISSING_DEPENDENCY:
          const pkg = extractPackageName(error);
          if (pkg) {
            if (error.missingTypes || isMissingTypesError(error)) {
              suggestions.add(`Add @types/${pkg} to devDependencies`);
            } else {
              suggestions.add(`Add ${pkg} to dependencies`);
            }
          }
          break;

        case ErrorCategory.IMPORT_ERROR:
          if (error.file && error.line) {
            suggestions.add(`Fix import path in ${error.file} at line ${error.line}`);
          }
          break;

        case ErrorCategory.TYPE_ERROR:
          if (error.file && error.line) {
            suggestions.add(`Fix type error in ${error.file} at line ${error.line}`);
          }
          break;

        case ErrorCategory.SYNTAX_ERROR:
          if (error.file && error.line) {
            suggestions.add(`Fix syntax error in ${error.file} at line ${error.line}`);
          }
          break;
      }
    }

    return Array.from(suggestions);
  }
}
