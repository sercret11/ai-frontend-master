/**
 * Error Classifier - Parse and classify errors from command output
 *
 * This module parses error output from various commands (npm install, tsc, build)
 * and classifies them into structured ParsedError objects.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { ErrorCategory, ParsedError } from '@ai-frontend/shared-types';

/**
 * Built-in Node.js modules that don't need installation
 */
const BUILTIN_MODULES = new Set([
  'fs', 'path', 'os', 'http', 'https', 'events', 'stream', 'util',
  'child_process', 'crypto', 'buffer', 'querystring', 'url', 'net',
  'tls', 'dns', 'zlib', 'cluster', 'readline', 'vm', 'assert', 'timers',
  'console', 'process', 'module', 'util', 'util/types',
]);

/**
 * ErrorClassifier namespace
 */
export namespace ErrorClassifier {
  /**
   * Parse npm install errors from output
   */
  export function parseNpmInstallErrors(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Pattern 1: npm ERR! missing peer dependency
      const missingPeerMatch = trimmed.match(/npm ERR!\s+missing peer dependency:\s+(.+)@/);
      if (missingPeerMatch) {
        errors.push({
          category: ErrorCategory.MISSING_DEPENDENCY,
          message: trimmed,
          missingPackage: missingPeerMatch[1],
          raw: line,
        });
        continue;
      }

      // Pattern 2: Cannot find module 'package'
      const notFoundMatch = trimmed.match(/Cannot find module ['"]([^'"]+)['"]/);
      if (notFoundMatch) {
        const pkg = notFoundMatch[1];
        // Check if it's a built-in module
        if (!BUILTIN_MODULES.has(pkg)) {
          errors.push({
            category: ErrorCategory.MISSING_DEPENDENCY,
            message: trimmed,
            missingPackage: pkg,
            raw: line,
          });
        }
        continue;
      }

      // Pattern 3: code ENOENT
      const enoentMatch = trimmed.match(/code ['"]?(ENOENT|ERR_MODULE_NOT_FOUND)['"]?/);
      if (enoentMatch) {
        // Try to extract package name from previous line
        const pkgMatch = lines[lines.indexOf(line) - 1]?.match(/['"]([^'"]+)['"]/);
        if (pkgMatch) {
          errors.push({
            category: ErrorCategory.MISSING_DEPENDENCY,
            message: trimmed,
            missingPackage: pkgMatch[1],
            raw: line,
          });
        }
        continue;
      }

      // Pattern 4: npm ERR! code ERESOLVE
      const eresolveMatch = trimmed.match(/npm ERR!\s+code ERESOLVE/);
      if (eresolveMatch) {
        // Look for the package name in context
        const pkgMatch = trimmed.match(/['"]([^'"]+)['"]\s+is not found/);
        if (pkgMatch) {
          errors.push({
            category: ErrorCategory.MISSING_DEPENDENCY,
            message: trimmed,
            missingPackage: pkgMatch[1],
            raw: line,
          });
        }
        continue;
      }
    }

    console.log(`[ErrorClassifier] Parsed ${errors.length} npm install errors`);
    return errors;
  }

  /**
   * Parse TypeScript compiler errors from output
   */
  export function parseTypeScriptErrors(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes('error')) continue;

      // Pattern 1: file.ts(line,col): error TSXXXX: Message
      const fileErrorMatch = trimmed.match(
        /^(.+)\((\d+),(\d+)\):\s+error TS(\d+):\s+(.+)/
      );
      if (fileErrorMatch) {
        const [, file, lineStr, colStr, code, message] = fileErrorMatch;
        errors.push({
          category: categorizeTSCode(code),
          file,
          line: parseInt(lineStr, 10),
          column: parseInt(colStr, 10),
          code: `TS${code}`,
          message: message,
          raw: line,
        });
        continue;
      }

      // Pattern 2: error TSXXXX: Message (no file location)
      const errorMatch = trimmed.match(/^error TS(\d+):\s+(.+)/);
      if (errorMatch) {
        const [, code, message] = errorMatch;
        errors.push({
          category: categorizeTSCode(code),
          message: message,
          code: `TS${code}`,
          raw: line,
        });
        continue;
      }

      // Pattern 3: Cannot find module 'xxx' or its type declarations
      const cannotFindMatch = trimmed.match(/Cannot find module ['"]([^'"]+)['"](?: or its corresponding type declarations)?/);
      if (cannotFindMatch) {
        const module = cannotFindMatch[1];
        errors.push({
          category: module.startsWith('@types/')
            ? ErrorCategory.TYPE_ERROR
            : ErrorCategory.MISSING_DEPENDENCY,
          message: trimmed,
          missingPackage: module,
          missingTypes: module.startsWith('@types/') ? module : undefined,
          raw: line,
        });
        continue;
      }
    }

    console.log(`[ErrorClassifier] Parsed ${errors.length} TypeScript errors`);
    return errors;
  }

  /**
   * Parse ESLint errors from output
   */
  export function parseESLintErrors(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Pattern: file:line:col error message
      const eslintMatch = trimmed.match(/^([^:]+):(\d+):(\d+):\s+(.+)/);
      if (eslintMatch) {
        const [, file, lineStr, colStr, message] = eslintMatch;
        errors.push({
          category: categorizeESLintMessage(message),
          file,
          line: parseInt(lineStr, 10),
          column: parseInt(colStr, 10),
          message: message,
          raw: line,
        });
        continue;
      }
    }

    console.log(`[ErrorClassifier] Parsed ${errors.length} ESLint errors`);
    return errors;
  }

  /**
   * Parse build errors (Vite/Webpack/Next.js) from output
   */
  export function parseBuildErrors(stderr: string, stdout?: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const output = stderr + (stdout ? '\n' + stdout : '');
    const lines = output.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Pattern 1: Cannot find module 'xxx' (most common missing dependency error)
      const cannotFindModuleMatch = line.match(/Cannot find module ['"]([^'"]+)['"]/);
      if (cannotFindModuleMatch) {
        const module = cannotFindModuleMatch[1];
        errors.push({
          category: ErrorCategory.MISSING_DEPENDENCY,
          message: `Missing dependency: ${module}`,
          missingPackage: module,
          raw: line,
        });
        continue;
      }

      // Pattern 2: Module not found: Error: Cannot find module 'xxx'
      const moduleNotFoundMatch = line.match(/Module not found:\s+(?:Error:\s+)?Cannot find module ['"]?([^'"`\s]+)['"]?/);
      if (moduleNotFoundMatch) {
        const module = moduleNotFoundMatch[1];
        errors.push({
          category: ErrorCategory.MISSING_DEPENDENCY,
          message: `Missing dependency: ${module}`,
          missingPackage: module,
          raw: line,
        });
        continue;
      }

      // Pattern 3: error during build:
      if (line.includes('error during build') || line.includes('ModuleBuildError')) {
        // Look for the actual error message in surrounding lines
        const contextLines = lines.slice(Math.max(0, i - 2), Math.min(i + 10, lines.length));
        const errorMessage = contextLines.join('\n');

        // Try to extract missing dependency from context
        const missingDepMatch = errorMessage.match(/Cannot find module ['"]([^'"]+)['"]/);
        if (missingDepMatch) {
          errors.push({
            category: ErrorCategory.MISSING_DEPENDENCY,
            message: `Build error: missing module ${missingDepMatch[1]}`,
            missingPackage: missingDepMatch[1],
            raw: errorMessage,
          });
        } else {
          errors.push({
            category: ErrorCategory.BUILD_ERROR,
            message: errorMessage,
            raw: line,
          });
        }
        continue;
      }

      // Pattern 4: [plugin] error: message
      const pluginErrorMatch = line.match(/\[([^\]]+)\]\s+error:\s+(.+)/);
      if (pluginErrorMatch) {
        const plugin = pluginErrorMatch[1];
        const errorMsg = pluginErrorMatch[2];

        // Check if it's a missing dependency
        const missingDepMatch = errorMsg.match(/Cannot find module ['"]([^'"]+)['"]/);
        if (missingDepMatch) {
          errors.push({
            category: ErrorCategory.MISSING_DEPENDENCY,
            message: `Plugin ${plugin} error: missing module ${missingDepMatch[1]}`,
            missingPackage: missingDepMatch[1],
            raw: line,
          });
        } else {
          errors.push({
            category: ErrorCategory.BUILD_ERROR,
            message: `Plugin ${plugin} error: ${errorMsg}`,
            raw: line,
          });
        }
        continue;
      }

      // Pattern 5: Failed to load resource (404 errors in dev server)
      const failedResourceMatch = line.match(/Failed to load resource.*?(\d+)?\s*$/);
      if (failedResourceMatch) {
        // Skip 404 errors for resources, they're not critical
        continue;
      }

      // Pattern 6: Error: Cannot find module 'xxx' (in some contexts)
      const errorCannotFindMatch = line.match(/Error:\s+Cannot find module ['"]([^'"]+)['"]/);
      if (errorCannotFindMatch) {
        const module = errorCannotFindMatch[1];
        errors.push({
          category: ErrorCategory.MISSING_DEPENDENCY,
          message: `Missing dependency: ${module}`,
          missingPackage: module,
          raw: line,
        });
        continue;
      }
    }

    console.log(`[ErrorClassifier] Parsed ${errors.length} build errors from ${output.split('\n').length} lines`);
    return errors;
  }

  /**
   * Classify an error line (auto-detect)
   */
  export function classifyError(errorLine: string): ParsedError {
    // Try each parser in order
    let errors = parseNpmInstallErrors(errorLine);
    if (errors.length > 0) return errors[0];

    errors = parseTypeScriptErrors(errorLine);
    if (errors.length > 0) return errors[0];

    errors = parseBuildErrors(errorLine);
    if (errors.length > 0) return errors[0];

    // Default: unknown error
    return {
      category: ErrorCategory.UNKNOWN,
      message: errorLine,
      raw: errorLine,
    };
  }

  /**
   * Group errors by file
   */
  export function groupErrorsByFile(errors: ParsedError[]): Map<string, ParsedError[]> {
    const grouped = new Map<string, ParsedError[]>();

    for (const error of errors) {
      if (error.file) {
        if (!grouped.has(error.file)) {
          grouped.set(error.file, []);
        }
        grouped.get(error.file)!.push(error);
      }
    }

    return grouped;
  }

  /**
   * Get unique files from errors
   */
  export function extractUniqueFiles(errors: ParsedError[]): string[] {
    const files = new Set<string>();

    for (const error of errors) {
      if (error.file) {
        files.add(error.file);
      }
    }

    return Array.from(files);
  }

  /**
   * Get error lines for a specific file
   */
  export function extractErrorLines(errors: ParsedError[], filePath: string): number[] {
    return errors
      .filter(e => e.file === filePath)
      .map(e => e.line!)
      .filter((line, index, self) => self.indexOf(line) === index); // dedup
  }

  /**
   * Categorize TypeScript error code
   */
  function categorizeTSCode(code: string): ErrorCategory {
    // TS2307, TS2304: Cannot find module
    if (code === '2307' || code === '2304') {
      return ErrorCategory.MISSING_DEPENDENCY;
    }
    // TS2345: Type 'X' is not assignable to type 'Y'
    if (code === '2345') {
      return ErrorCategory.TYPE_ERROR;
    }
    // TS1123, TS1002, etc.: Syntax errors
    if (code.startsWith('1') || code === '1002' || code === '1123') {
      return ErrorCategory.SYNTAX_ERROR;
    }
    // TS5023, TS6053, etc.: Config errors
    if (code.startsWith('5') || code.startsWith('6')) {
      return ErrorCategory.CONFIG_ERROR;
    }
    // Default: type error
    return ErrorCategory.TYPE_ERROR;
  }

  /**
   * Categorize ESLint error message
   */
  function categorizeESLintMessage(message: string): ErrorCategory {
    if (message.includes('Missing semicolon')) {
      return ErrorCategory.SYNTAX_ERROR;
    }
    if (message.includes('is not defined') || message.includes('undef')) {
      return ErrorCategory.TYPE_ERROR;
    }
    if (message.includes('Import and export')) {
      return ErrorCategory.IMPORT_ERROR;
    }
    return ErrorCategory.UNKNOWN;
  }

  /**
   * Check if error is repairable by LLM
   */
  export function isRepairableError(error: ParsedError): boolean {
    return (
      error.category === ErrorCategory.MISSING_DEPENDENCY ||
      error.category === ErrorCategory.TYPE_ERROR ||
      error.category === ErrorCategory.IMPORT_ERROR ||
      error.category === ErrorCategory.SYNTAX_ERROR ||
      error.category === ErrorCategory.CONFIG_ERROR
    );
  }

  /**
   * Extract package name from error
   */
  export function extractPackageName(error: ParsedError): string | null {
    if (error.missingPackage) {
      return error.missingPackage;
    }

    // Try to extract from message
    const patterns = [
      /Cannot find module ['"]([^'"]+)['"]/,
      /Cannot find import ['"]([^'"]+)['"]/,
      /error TS2307: Cannot find module ['"]([^'"]+)['"]/,
      /Module not found:\s+['"]?([^'"`\s]+)['"]?/,
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
   * Get errors by category
   */
  export function getErrorsByCategory(errors: ParsedError[]): Map<ErrorCategory, ParsedError[]> {
    const byCategory = new Map<ErrorCategory, ParsedError[]>();

    for (const error of errors) {
      if (!byCategory.has(error.category)) {
        byCategory.set(error.category, []);
      }
      byCategory.get(error.category)!.push(error);
    }

    return byCategory;
  }

  /**
   * Count errors by category
   */
  export function countErrorsByCategory(errors: ParsedError[]): Map<ErrorCategory, number> {
    const counts = new Map<ErrorCategory, number>();

    for (const error of errors) {
      const current = counts.get(error.category) || 0;
      counts.set(error.category, current + 1);
    }

    return counts;
  }

  /**
   * Check if there are any fatal errors (non-repairable)
   */
  export function hasFatalErrors(errors: ParsedError[]): boolean {
    return errors.some(error => !isRepairableError(error));
  }

  /**
   * Get a summary of errors
   */
  export function summarizeErrors(errors: ParsedError[]): string {
    const counts = countErrorsByCategory(errors);
    const parts: string[] = [];

    for (const [category, count] of counts.entries()) {
      parts.push(`${count} ${category.replace(/_/g, ' ')}s`);
    }

    return errors.length === 0
      ? 'No errors found'
      : `Found ${errors.length} errors: ${parts.join(', ')}`;
  }
}
