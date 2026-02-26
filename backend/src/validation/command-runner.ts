/**
 * Command Runner - Run shell commands with timeout and output capture
 *
 * This module provides utilities to run shell commands (npm, tsc, build)
 * in a controlled environment with timeout and output buffering.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { resolvePathWithinBase } from '../security/path-safety';
import { parseSync } from 'oxc-parser';

const execAsync = promisify(exec);

/**
 * Command execution result
 */
export interface CommandResult {
  /** Command that was executed */
  command: string;
  /** Exit code (0 = success) */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Execution duration in milliseconds */
  duration: number;
  /** Whether command timed out */
  timedOut: boolean;
}

/**
 * Command executor options
 */
export interface CommandOptions {
  /** Working directory */
  cwd: string;
  /** Timeout in milliseconds (default: 60000 = 1 minute) */
  timeout?: number;
  /** Maximum buffer size for output (default: 10MB) */
  maxBuffer?: number;
  /** Environment variables to pass to command */
  env?: Record<string, string>;
}

/**
 * CommandRunner namespace
 */
export namespace CommandRunner {
  const CODE_FILE_REGEX = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;

  async function collectCodeFiles(dir: string, baseDir: string = dir): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 跳过依赖目录与缓存目录，缩短 L0 检查耗时
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        files.push(...(await collectCodeFiles(fullPath, baseDir)));
      } else if (entry.isFile() && CODE_FILE_REGEX.test(entry.name)) {
        files.push(path.relative(baseDir, fullPath));
      }
    }

    return files;
  }

  /**
   * Create a temporary directory for validation
   */
  export async function createValidationDir(sessionID: string): Promise<string> {
    const tempBase = os.tmpdir();
    const tempDir = path.join(tempBase, `ai-frontend-validation-${sessionID}`);
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * Export session files to a directory
   */
  export async function exportSessionFiles(
    sessionID: string,
    targetDir: string
  ): Promise<void> {
    const { FileStorage } = await import('../storage/file-storage');
    const files = FileStorage.getAllFiles(sessionID);

    for (const file of files) {
      const filePath = resolvePathWithinBase(targetDir, file.path);
      const dirName = path.dirname(filePath);

      await fs.mkdir(dirName, { recursive: true });
      await fs.writeFile(filePath, file.content, 'utf-8');
    }

    console.log(`[CommandRunner] Exported ${files.length} files to ${targetDir}`);
  }

  /**
   * L0 语法检查（秒级）：使用 OXC 解析器快速检查语法错误
   */
  export async function runL0SyntaxCheck(
    sessionID: string,
    options?: Partial<CommandOptions>
  ): Promise<CommandResult> {
    const tempDir = options?.cwd || await createValidationDir(sessionID);
    await exportSessionFiles(sessionID, tempDir);
    const startTime = Date.now();

    try {
      const files = await collectCodeFiles(tempDir);
      const errors: string[] = [];

      for (const relativePath of files) {
        const absolutePath = path.join(tempDir, relativePath);
        const source = await fs.readFile(absolutePath, 'utf-8');
        try {
          const parsed = parseSync(relativePath, source, {
            sourceType: 'unambiguous',
            astType: 'ts',
            showSemanticErrors: false,
          }) as any;
          if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
            parsed.errors.slice(0, 3).forEach((error: any) => {
              errors.push(`${relativePath}: ${String(error?.message || error)}`);
            });
          }
        } catch (error) {
          errors.push(
            `${relativePath}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return {
        command: 'l0-syntax-check',
        exitCode: errors.length > 0 ? 1 : 0,
        stdout: `Checked ${files.length} source file(s)`,
        stderr: errors.slice(0, 20).join('\n'),
        duration: Date.now() - startTime,
        timedOut: false,
      };
    } catch (error) {
      return {
        command: 'l0-syntax-check',
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        timedOut: false,
      };
    }
  }

  /**
   * Execute a command with timeout
   */
  export async function execute(
    command: string,
    options: CommandOptions
  ): Promise<CommandResult> {
    const {
      cwd,
      timeout = 60000,
      maxBuffer = 10 * 1024 * 1024, // 10MB
      env = {},
    } = options;

    const startTime = Date.now();

    console.log(`[CommandRunner] Executing: ${command}`);
    console.log(`[CommandRunner] Working directory: ${cwd}`);
    console.log(`[CommandRunner] Timeout: ${timeout}ms`);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`[CommandRunner] Command timed out after ${timeout}ms: ${command}`);
        resolve({
          command,
          exitCode: -1,
          stdout: '',
          stderr: `Command timed out after ${timeout}ms`,
          duration: timeout,
          timedOut: true,
        });
      }, timeout);

      exec(
        command,
        {
          cwd,
          maxBuffer,
          env: { ...process.env, ...env },
        },
        async (error, stdout, stderr) => {
          clearTimeout(timer);
          const duration = Date.now() - startTime;

          // 详细输出日志
          const stdoutStr = stdout.toString();
          const stderrStr = stderr.toString();
          const stdoutLines = stdoutStr.split('\n').length;
          const stderrLines = stderrStr.split('\n').length;
          const stdoutBytes = Buffer.byteLength(stdoutStr, 'utf8');
          const stderrBytes = Buffer.byteLength(stderrStr, 'utf8');
          const exitCode = error ? (error as any).code || 1 : 0;

          console.log(`[CommandRunner] ✅ Execution complete`);
          console.log(`[CommandRunner] Command: ${command}`);
          console.log(`[CommandRunner] Exit code: ${exitCode}`);
          console.log(`[CommandRunner] Duration: ${duration}ms`);
          console.log(`[CommandRunner] Stdout: ${stdoutLines} lines, ${stdoutBytes} bytes`);
          console.log(`[CommandRunner] Stderr: ${stderrLines} lines, ${stderrBytes} bytes`);

          // 保存调试文件
          try {
            const debugDir = path.join(os.tmpdir(), 'ai-frontend-debug');
            await fs.mkdir(debugDir, { recursive: true });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const debugFile = path.join(debugDir, `command-${timestamp}.log`);
            await fs.writeFile(debugFile, `
Command: ${command}
Exit Code: ${exitCode}
Duration: ${duration}ms
Working Directory: ${cwd}

=== STDOUT (${stdoutLines} lines, ${stdoutBytes} bytes) ===
${stdoutStr}

=== STDERR (${stderrLines} lines, ${stderrBytes} bytes) ===
${stderrStr}
`, 'utf8');
            console.log(`[CommandRunner] Debug output saved to: ${debugFile}`);
          } catch (debugError) {
            console.warn(`[CommandRunner] Failed to save debug output:`, debugError);
          }

          resolve({
            command,
            exitCode,
            stdout: stdoutStr,
            stderr: stderrStr,
            duration,
            timedOut: false,
          });
        }
      );
    });
  }

  /**
   * Run npm install
   */
  export async function runNpmInstall(
    sessionID: string,
    options?: Partial<CommandOptions>
  ): Promise<CommandResult> {
    const tempDir = options?.cwd || await createValidationDir(sessionID);
    await exportSessionFiles(sessionID, tempDir);

    const command = process.platform === 'win32'
      ? 'npm install --include=dev --silent --no-audit --no-fund'
      : 'npm install --include=dev --silent --no-audit --no-fund --prefer-offline';

    return execute(command, {
      ...options,
      cwd: tempDir,
      timeout: 180000, // 3 minutes for install
    });
  }

  /**
   * Run TypeScript check
   */
  export async function runTsc(
    sessionID: string,
    options?: Partial<CommandOptions>
  ): Promise<CommandResult> {
    const tempDir = options?.cwd || await createValidationDir(sessionID);
    await exportSessionFiles(sessionID, tempDir);

    return execute('npx tsc --noEmit', {
      ...options,
      cwd: tempDir,
      timeout: 60000,
    });
  }

  /**
   * Run build
   */
  export async function runBuild(
    sessionID: string,
    options?: Partial<CommandOptions>
  ): Promise<CommandResult> {
    const tempDir = options?.cwd || await createValidationDir(sessionID);
    await exportSessionFiles(sessionID, tempDir);

    return execute('npm run build', {
      ...options,
      cwd: tempDir,
      timeout: 120000, // 2 minutes
    });
  }

  /**
   * Run ESLint
   */
  export async function runEslint(
    sessionID: string,
    options?: Partial<CommandOptions>
  ): Promise<CommandResult> {
    const tempDir = options?.cwd || await createValidationDir(sessionID);
    await exportSessionFiles(sessionID, tempDir);

    // Try to run eslint, but continue if not found
    const result = await execute('npx eslint . --ext .ts,.tsx,.js,.jsx || true', {
      ...options,
      cwd: tempDir,
      timeout: 60000,
    });

    // If eslint is not found, treat as success (not critical)
    if (result.stderr.includes('command not found') || result.stderr.includes('is not recognized')) {
      console.log('[CommandRunner] ESLint not found, skipping');
      return {
        ...result,
        exitCode: 0,
        timedOut: false,
      };
    }

    return result;
  }

  /**
   * Clean up temporary directory
   */
  export async function cleanup(tempDir: string): Promise<void> {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`[CommandRunner] Cleaned up temp dir: ${tempDir}`);
    } catch (error) {
      console.warn(`[CommandRunner] Failed to cleanup temp dir: ${tempDir}`, error);
    }
  }

  /**
   * Run all validation commands
   */
  export async function runAllValidation(
    sessionID: string,
    options?: Partial<CommandOptions>
  ): Promise<{
    npmInstall: CommandResult;
    typeCheck: CommandResult;
    build: CommandResult;
    eslint?: CommandResult;
  }> {
    console.log(`[CommandRunner] Running all validation commands for session ${sessionID}`);

    const npmInstall = await runNpmInstall(sessionID, options);

    // Only run type check if npm install succeeded
    const typeCheck = npmInstall.exitCode === 0
      ? await runTsc(sessionID, options)
      : { ...npmInstall, command: 'tsc --noEmit (skipped due to npm install failure)' };

    // Only run build if type check passed
    const build = typeCheck.exitCode === 0
      ? await runBuild(sessionID, options)
      : { ...typeCheck, command: 'npm run build (skipped due to type check failure)' };

    console.log(`[CommandRunner] Validation results:
  - npm install: exitCode ${npmInstall.exitCode}, ${npmInstall.duration}ms
  - tsc --noEmit: exitCode ${typeCheck.exitCode}, ${typeCheck.duration}ms
  - npm run build: exitCode ${build.exitCode}, ${build.duration}ms
`);

    return {
      npmInstall,
      typeCheck,
      build,
    };
  }

  /**
   * Run pre-build validation checks
   * Catches configuration errors and missing dependencies early
   */
  export async function runPreBuildChecks(
    sessionID: string,
    template: string,
    options?: Partial<CommandOptions>
  ): Promise<CommandResult[]> {
    const checks: CommandResult[] = [];
    let tempDir = options?.cwd;

    if (!tempDir) {
      tempDir = await createValidationDir(sessionID);
      await exportSessionFiles(sessionID, tempDir);
    }

    console.log(`[CommandRunner] Running pre-build checks for ${template} project`);

    // 针对 Next.js 项目
    if (template === 'next-js') {
      // 检查 1: 核心脚手架文件是否存在（不依赖 npm install）
      try {
        console.log(`[CommandRunner] Running: next scaffold file check`);
        const lintResult = await execute(
          `node -e "const fs=require('fs'); const files=['package.json','next.config.js','app/layout.tsx']; const miss=files.filter(f=>!fs.existsSync(f)); if(miss.length){console.error('Missing files: '+miss.join(',')); process.exit(1);} console.log('Next scaffold files are present');"`,
          {
            cwd: tempDir!,
            timeout: 30000,
          }
        );
        checks.push({ ...lintResult, command: 'next scaffold file check' });
        console.log(
          `[CommandRunner] next scaffold file check: exitCode ${lintResult.exitCode}, ${lintResult.duration}ms`
        );

        // 如果检查失败，输出 stderr 以便诊断
        if (lintResult.exitCode !== 0) {
          console.log(`[CommandRunner] next scaffold check errors:\n${lintResult.stderr}`);
        }
      } catch (error) {
        console.warn('[CommandRunner] next scaffold file check failed:', error);
      }

      // 检查 2: package.json scripts 是否包含核心 next 命令
      try {
        console.log(`[CommandRunner] Running: next scripts check`);
        const infoResult = await execute(
          `node -e "const pkg=require('./package.json'); const scripts=pkg.scripts||{}; const required=['dev','build']; const miss=required.filter(k=>!scripts[k]); if(miss.length){console.error('Missing scripts: '+miss.join(',')); process.exit(1);} console.log('Next scripts are present');"`,
          {
            cwd: tempDir!,
            timeout: 10000,
          }
        );
        checks.push({ ...infoResult, command: 'next scripts check' });
        console.log(`[CommandRunner] next scripts check: exitCode ${infoResult.exitCode}`);
      } catch (error) {
        console.warn('[CommandRunner] next scripts check failed:', error);
      }
    }

    // 针对 React Vite 项目
    if (template === 'react-vite') {
      // 检查: 核心脚手架文件是否存在（不依赖 npm install）
      try {
        console.log(`[CommandRunner] Running: vite scaffold file check`);
        const versionResult = await execute(
          `node -e "const fs=require('fs'); const files=['package.json','vite.config.ts','src/main.tsx']; const miss=files.filter(f=>!fs.existsSync(f)); if(miss.length){console.error('Missing files: '+miss.join(',')); process.exit(1);} console.log('Vite scaffold files are present');"`,
          {
            cwd: tempDir!,
            timeout: 10000,
          }
        );
        checks.push({ ...versionResult, command: 'vite scaffold file check' });
        console.log(`[CommandRunner] vite scaffold file check: exitCode ${versionResult.exitCode}`);
      } catch (error) {
        console.warn('[CommandRunner] vite scaffold file check failed:', error);
      }
    }

    console.log(`[CommandRunner] Pre-build checks complete: ${checks.length} checks executed`);

    return checks;
  }
}
