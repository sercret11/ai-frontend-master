/**
 * Bash Tool - Execute controlled shell commands
 *
 * Security model:
 * - command must be plain text without shell operators
 * - executable must be in allowlist
 * - execution never uses shell interpolation
 * - cwd must remain in workspace
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { z } from 'zod';
import { Tool } from '../tool';
import type {
  CommandExecutionMetadata,
  ToolContext,
  ToolExecutionResult,
} from '@ai-frontend/shared-types';

const DEFAULT_ALLOWED_COMMANDS = [
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'node',
  'tsx',
  'python',
  'python3',
  'git',
];

const SHELL_OPERATOR_PATTERN = /[;&|`<>$]|[\r\n]/;
const TOKEN_PATTERN = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s]+)/g;
const INLINE_EXECUTION_FLAGS: Record<string, Set<string>> = {
  node: new Set(['-e', '--eval', '-p', '--print']),
  python: new Set(['-c']),
  python3: new Set(['-c']),
  pwsh: new Set(['-c', '-command', '-encodedcommand', '-enc']),
  powershell: new Set(['-c', '-command', '-encodedcommand', '-enc']),
  'powershell.exe': new Set(['-c', '-command', '-encodedcommand', '-enc']),
};

const bashToolSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      'Command to execute. Must start with an allowlisted executable and may not contain shell operators.'
    ),
  cwd: z.string().optional().describe('Working directory (defaults to workspace root)'),
  timeout: z.number().int().positive().max(120000).optional().describe('Timeout in milliseconds (default 30000, max 120000)'),
});

type BashToolResult = ToolExecutionResult<CommandExecutionMetadata>;

function resolveAllowedCommands(): Set<string> {
  const raw = process.env.BASH_ALLOWED_COMMANDS;
  if (!raw?.trim()) {
    return new Set(DEFAULT_ALLOWED_COMMANDS);
  }
  const values = raw
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
  return new Set(values.length > 0 ? values : DEFAULT_ALLOWED_COMMANDS);
}

function parseCommandTokens(command: string): string[] {
  const tokens: string[] = [];
  const trimmed = command.trim();

  if (!trimmed) {
    return tokens;
  }

  const matches = trimmed.matchAll(TOKEN_PATTERN);
  for (const match of matches) {
    const token = match[1] ?? match[2] ?? match[3] ?? '';
    if (token) {
      tokens.push(token);
    }
  }

  return tokens;
}

function findBlockedInlineExecutionFlag(
  executable: string,
  args: string[]
): string | null {
  const blockedFlags = INLINE_EXECUTION_FLAGS[executable.toLowerCase()];
  if (!blockedFlags || args.length === 0) {
    return null;
  }

  for (const arg of args) {
    const normalizedArg = arg.toLowerCase();
    if (blockedFlags.has(normalizedArg)) {
      return arg;
    }

    const flagWithValueMatch = normalizedArg.match(/^(-{1,2}[a-z0-9-]+)[:=].+$/i);
    if (flagWithValueMatch && blockedFlags.has(flagWithValueMatch[1])) {
      return arg;
    }
  }

  return null;
}

function resolveWorkspaceCwd(inputCwd?: string): { cwd: string; workspaceRoot: string } {
  const workspaceRoot = path.resolve(process.cwd());
  const requested = inputCwd?.trim();
  const candidate = !requested
    ? workspaceRoot
    : path.isAbsolute(requested)
      ? path.resolve(requested)
      : path.resolve(workspaceRoot, requested);

  const relative = path.relative(workspaceRoot, candidate);
  const outsideWorkspace =
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);

  if (outsideWorkspace) {
    throw new Error(`cwd must stay within workspace root: ${workspaceRoot}`);
  }

  return { cwd: candidate, workspaceRoot };
}

function resolveExecutableForPlatform(executable: string): string {
  if (os.platform() !== 'win32') {
    return executable;
  }

  if (['npm', 'npx', 'pnpm', 'yarn'].includes(executable.toLowerCase())) {
    return `${executable}.cmd`;
  }

  return executable;
}

async function runCommand(
  executable: string,
  args: string[],
  cwd: string,
  timeout: number
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    if (timeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeout);
    }

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (resolved) return;
      resolved = true;
      reject(error);
    });

    child.on('close', code => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (resolved) return;
      resolved = true;
      resolve({
        exitCode: typeof code === 'number' ? code : -1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

export const BashTool = Tool.define('bash', {
  description:
    'Execute controlled shell commands with strict allowlist and no shell interpolation.',
  parameters: bashToolSchema,
  async execute(
    params,
    _ctx: ToolContext<CommandExecutionMetadata>
  ): Promise<BashToolResult> {
    const startTime = Date.now();
    const allowedCommands = resolveAllowedCommands();
    const { cwd } = resolveWorkspaceCwd(params.cwd);
    const timeout = params.timeout ?? 30000;
    const platform = os.platform();

    const rawCommand = params.command.trim();
    if (SHELL_OPERATOR_PATTERN.test(rawCommand)) {
      throw new Error('command contains shell operators and is not allowed');
    }

    const tokens = parseCommandTokens(rawCommand);
    if (tokens.length === 0) {
      throw new Error('command must include an executable');
    }

    const executable = tokens[0];
    const executableLower = executable.toLowerCase();
    if (!allowedCommands.has(executableLower)) {
      throw new Error(
        `command "${executable}" is not allowlisted. Allowed: ${Array.from(allowedCommands).join(', ')}`
      );
    }

    const args = tokens.slice(1);
    const blockedFlag = findBlockedInlineExecutionFlag(executable, args);
    if (blockedFlag) {
      throw new Error(
        `inline interpreter execution is blocked: ${executable} ${blockedFlag}`
      );
    }

    const resolvedExecutable = resolveExecutableForPlatform(executable);

    try {
      const result = await runCommand(resolvedExecutable, args, cwd, timeout);
      const duration = Date.now() - startTime;
      const outputParts: string[] = [
        `Platform: ${platform}`,
        `Command: ${executable} ${args.join(' ')}`.trim(),
      ];
      if (result.stdout) {
        outputParts.push(`STDOUT:\n${result.stdout}`);
      }
      if (result.stderr) {
        outputParts.push(`STDERR:\n${result.stderr}`);
      }
      if (!result.stdout && !result.stderr) {
        outputParts.push('(Command produced no output)');
      }
      if (result.timedOut) {
        outputParts.push(`Timed out after ${timeout}ms`);
      }

      return {
        title:
          result.exitCode === 0
            ? `Bash: ${executable}`
            : `Bash Error: ${executable}`,
        metadata: {
          command: rawCommand,
          executedCommand: `${resolvedExecutable} ${args.join(' ')}`.trim(),
          platform,
          cwd,
          duration,
          exitCode: result.exitCode,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
          timedOut: result.timedOut,
        } as CommandExecutionMetadata,
        output: outputParts.join('\n\n'),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      return {
        title: `Bash Error: ${executable}`,
        metadata: {
          command: rawCommand,
          executedCommand: `${resolvedExecutable} ${args.join(' ')}`.trim(),
          platform,
          cwd,
          duration,
          exitCode: -1,
          error: message,
        } as CommandExecutionMetadata,
        output: `Command failed: ${message}`,
      };
    }
  },
});
