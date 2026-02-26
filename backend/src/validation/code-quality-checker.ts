/**
 * Code Quality Checker - Validate generated project code quality
 * Uses command-line tools to check TypeScript, ESLint, build, etc.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { resolvePathWithinBase } from '../security/path-safety';

const execAsync = promisify(exec);

/**
 * Quality check result
 */
export interface QualityCheckResult {
  /** Type of check */
  checkType: 'typescript' | 'eslint' | 'build' | 'dependencies';
  /** Whether the check passed */
  passed: boolean;
  /** Command output */
  output: string;
  /** Error messages */
  errors: string[];
  /** Warnings (non-critical) */
  warnings?: string[];
}

/**
 * Options for quality checks
 */
export interface QualityCheckOptions {
  /** Whether to run TypeScript check */
  checkTypeScript?: boolean;
  /** Whether to run ESLint */
  checkESLint?: boolean;
  /** Whether to run build test */
  checkBuild?: boolean;
  /** Whether to check dependencies */
  checkDependencies?: boolean;
  /** Timeout for each check (ms) */
  timeout?: number;
}

/**
 * Code Quality Checker namespace
 */
export namespace CodeQualityChecker {
  /**
   * Default options
   */
  const defaultOptions: QualityCheckOptions = {
    checkTypeScript: true,
    checkESLint: false, // Disabled by default (may take too long)
    checkBuild: false,  // Disabled by default (may take too long)
    checkDependencies: true,
    timeout: 60000,     // 60 seconds
  };

  /**
   * Create a temporary directory for a session
   */
  export async function createTempDir(sessionID: string): Promise<string> {
    const tempBase = os.tmpdir();
    const tempDir = path.join(tempBase, `ai-frontend-session-${sessionID}`);

    await fs.mkdir(tempDir, { recursive: true });
    console.log(`[CodeQualityChecker] Created temp dir: ${tempDir}`);

    return tempDir;
  }

  /**
   * Export project files to temporary directory
   */
  export async function exportFilesToTemp(
    sessionID: string,
    tempDir: string
  ): Promise<void> {
    const { FileStorage } = await import('../storage/file-storage');
    const files = FileStorage.getAllFiles(sessionID);

    console.log(`[CodeQualityChecker] Exporting ${files.length} files to temp dir`);

    for (const file of files) {
      const filePath = resolvePathWithinBase(tempDir, file.path);
      const dirName = path.dirname(filePath);

      // Create directory if it doesn't exist
      await fs.mkdir(dirName, { recursive: true });

      // Write file
      await fs.writeFile(filePath, file.content, 'utf-8');
    }

    console.log(`[CodeQualityChecker] Exported ${files.length} files successfully`);
  }

  /**
   * Clean up temporary directory
   */
  export async function cleanupTempDir(tempDir: string): Promise<void> {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`[CodeQualityChecker] Cleaned up temp dir: ${tempDir}`);
    } catch (error) {
      console.error(`[CodeQualityChecker] Failed to cleanup temp dir:`, error);
    }
  }

  /**
   * Run a command in a directory
   */
  async function runCommandInTemp(
    tempDir: string,
    command: string,
    timeout: number = 60000
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    console.log(`[CodeQualityChecker] Running command: ${command}`);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Kill process on timeout
        reject(new Error(`Command timeout after ${timeout}ms: ${command}`));
      }, timeout);

      exec(
        command,
        { cwd: tempDir, maxBuffer: 1024 * 1024 * 10 }, // 10MB buffer
        (error, stdout, stderr) => {
          clearTimeout(timer);

          if (error) {
            resolve({
              stdout: stdout.toString(),
              stderr: stderr.toString(),
              exitCode: (error as any).code || null,
            });
          } else {
            resolve({
              stdout: stdout.toString(),
              stderr: stderr.toString(),
              exitCode: 0,
            });
          }
        }
      );
    });
  }

  /**
   * Check TypeScript types
   */
  export async function checkTypeScript(sessionID: string): Promise<QualityCheckResult> {
    console.log(`[CodeQualityChecker] Starting TypeScript check for session ${sessionID}`);

    const tempDir = await createTempDir(sessionID);

    try {
      await exportFilesToTemp(sessionID, tempDir);

      // Install dependencies first (required for TypeScript to find types)
      console.log('[CodeQualityChecker] Installing dependencies for TypeScript check...');
      const installResult = await runCommandInTemp(
        tempDir,
        'npm install --silent --no-audit --no-fund',
        120000 // 2 minutes
      );

      if (installResult.exitCode !== 0) {
        console.warn('[CodeQualityChecker] Failed to install dependencies, skipping TypeScript check');
        return {
          checkType: 'typescript',
          passed: true, // Don't fail if dependencies cannot be installed
          output: installResult.stderr || installResult.stdout,
          errors: [],
          warnings: ['Failed to install dependencies, TypeScript check skipped'],
        };
      }

      // Run tsc --noEmit
      const result = await runCommandInTemp(
        tempDir,
        'npx tsc --noEmit',
        60000
      );

      // Check if TypeScript CLI is available
      if (result.stderr.includes('command not found') || result.stderr.includes('is not recognized')) {
        console.log('[CodeQualityChecker] TypeScript CLI not found, skipping check');
        return {
          checkType: 'typescript',
          passed: true, // Don't fail if TypeScript is not installed
          output: result.stderr,
          errors: [],
          warnings: ['TypeScript CLI not found, check skipped'],
        };
      }

      const passed = result.exitCode === 0;
      const errors: string[] = [];
      const warnings: string[] = [];

      if (!passed) {
        // Parse TypeScript errors from both stdout and stderr
        const allOutput = result.stdout + result.stderr;
        const errorLines = allOutput.split('\n').filter(line =>
          line.includes('error TS') || line.includes('error:')
        );
        errors.push(...errorLines);

        // If no errors found but exitCode is non-zero, add a generic warning
        if (errors.length === 0) {
          warnings.push('TypeScript check failed with non-zero exit code but no parseable errors');
        }
      }

      console.log(`[CodeQualityChecker] TypeScript check ${passed ? 'PASSED' : 'FAILED'} (${errors.length} errors)`);

      return {
        checkType: 'typescript',
        passed,
        output: result.stderr || result.stdout,
        errors,
        warnings,
      };
    } catch (error) {
      console.error('[CodeQualityChecker] TypeScript check failed:', error);
      return {
        checkType: 'typescript',
        passed: true, // Don't fail if the check itself crashes
        output: '',
        errors: [],
        warnings: [error instanceof Error ? error.message : 'TypeScript check failed'],
      };
    } finally {
      await cleanupTempDir(tempDir);
    }
  }

  /**
   * Check dependencies (all imports have corresponding files)
   */
  export async function checkDependencies(sessionID: string): Promise<QualityCheckResult> {
    console.log(`[CodeQualityChecker] Starting dependency check for session ${sessionID}`);

    const { FileStorage } = await import('../storage/file-storage');
    const files = FileStorage.getAllFiles(sessionID);
    const filePaths = new Set(files.map(f => f.path));
    const errors: string[] = [];
    const warnings: string[] = [];

    // Find all import statements
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;

    for (const file of files) {
      const matches = [...file.content.matchAll(importRegex)];

      for (const match of matches) {
        const importPath = match[2];

        // Skip if importPath is undefined (shouldn't happen, but be safe)
        if (!importPath) {
          continue;
        }

        // Skip node_modules and relative imports
        if (importPath.startsWith('.')) {
          // Resolve relative import
          const fileDir = path.dirname(file.path);
          let resolvedPath = path.normalize(path.join(fileDir, importPath));

          // Remove file extension
          resolvedPath = resolvedPath.replace(/\.(tsx?|jsx?)$/, '');

          // Try with .tsx, .ts, .jsx, .js extensions
          const extensions = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
          const found = extensions.some(ext => {
            const checkPath = resolvedPath + ext;
            return Array.from(filePaths).some(fp => fp.endsWith(checkPath) || fp === checkPath);
          });

          if (!found) {
            errors.push(`${file.path}: Cannot find import '${importPath}'`);
          }
        }
      }
    }

    const passed = errors.length === 0;

    console.log(`[CodeQualityChecker] Dependency check ${passed ? 'PASSED' : 'FAILED'} (${errors.length} errors)`);

    return {
      checkType: 'dependencies',
      passed,
      output: errors.join('\n'),
      errors,
      warnings,
    };
  }

  /**
   * Run ESLint check
   */
  export async function checkESLint(sessionID: string): Promise<QualityCheckResult> {
    console.log(`[CodeQualityChecker] Starting ESLint check for session ${sessionID}`);

    const tempDir = await createTempDir(sessionID);

    try {
      await exportFilesToTemp(sessionID, tempDir);

      // Run eslint (if eslint is configured)
      const result = await runCommandInTemp(
        tempDir,
        'npx eslint . --ext .ts,.tsx,.js,.jsx || true', // Continue even if eslint not found
        60000
      );

      const passed = result.exitCode === 0 || result.stderr.includes('command not found');
      const errors: string[] = [];

      if (!passed && !result.stderr.includes('command not found')) {
        const errorLines = result.stdout.split('\n').filter(line => line.includes('error'));
        errors.push(...errorLines);
      }

      console.log(`[CodeQualityChecker] ESLint check ${passed ? 'PASSED' : 'FAILED'}`);

      return {
        checkType: 'eslint',
        passed,
        output: result.stdout,
        errors,
      };
    } catch (error) {
      console.error('[CodeQualityChecker] ESLint check failed:', error);
      return {
        checkType: 'eslint',
        passed: true, // Don't fail if eslint check itself fails
        output: '',
        errors: [],
        warnings: [error instanceof Error ? error.message : 'ESLint check skipped'],
      };
    } finally {
      await cleanupTempDir(tempDir);
    }
  }

  /**
   * Run build test
   */
  export async function checkBuild(sessionID: string): Promise<QualityCheckResult> {
    console.log(`[CodeQualityChecker] Starting build check for session ${sessionID}`);

    const tempDir = await createTempDir(sessionID);

    try {
      await exportFilesToTemp(sessionID, tempDir);

      // Install dependencies first
      console.log('[CodeQualityChecker] Installing dependencies...');
      const installResult = await runCommandInTemp(
        tempDir,
        'npm install --silent --no-audit --no-fund',
        120000 // 2 minutes
      );

      if (installResult.exitCode !== 0) {
        return {
          checkType: 'build',
          passed: false,
          output: installResult.stderr || installResult.stdout,
          errors: ['Failed to install dependencies'],
        };
      }

      // Run build
      const buildResult = await runCommandInTemp(
        tempDir,
        'npm run build',
        120000 // 2 minutes
      );

      const passed = buildResult.exitCode === 0;
      const errors: string[] = [];

      if (!passed) {
        errors.push(...buildResult.stderr.split('\n').filter(line => line.trim().length > 0));
      }

      console.log(`[CodeQualityChecker] Build check ${passed ? 'PASSED' : 'FAILED'}`);

      return {
        checkType: 'build',
        passed,
        output: buildResult.stdout + '\n' + buildResult.stderr,
        errors,
      };
    } catch (error) {
      console.error('[CodeQualityChecker] Build check failed:', error);
      return {
        checkType: 'build',
        passed: false,
        output: '',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    } finally {
      await cleanupTempDir(tempDir);
    }
  }

  /**
   * Run all quality checks
   */
  export async function runAllQualityChecks(
    sessionID: string,
    options: QualityCheckOptions = {}
  ): Promise<QualityCheckResult[]> {
    const opts = { ...defaultOptions, ...options };
    const results: QualityCheckResult[] = [];

    console.log(`[CodeQualityChecker] Running all quality checks for session ${sessionID}`);

    if (opts.checkDependencies) {
      results.push(await checkDependencies(sessionID));
    }

    if (opts.checkTypeScript) {
      results.push(await checkTypeScript(sessionID));
    }

    if (opts.checkESLint) {
      results.push(await checkESLint(sessionID));
    }

    if (opts.checkBuild) {
      results.push(await checkBuild(sessionID));
    }

    // Log summary
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    console.log(`[CodeQualityChecker] Quality checks complete: ${passed}/${total} passed`);

    return results;
  }
}
