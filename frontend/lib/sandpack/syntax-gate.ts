import { transform } from '@babel/standalone';

export interface SyntaxGateError {
  filePath: string;
  line?: number;
  column?: number;
  message: string;
}

export interface SyntaxGateResult {
  ok: boolean;
  errors: SyntaxGateError[];
}

function shouldCheckSyntax(filePath: string): boolean {
  return /\.(t|j)sx?$/.test(filePath);
}

function parseLineColumn(message: string): { line?: number; column?: number } {
  const match = message.match(/(\d+):(\d+)/);
  if (!match) {
    return {};
  }

  return {
    line: Number(match[1]),
    column: Number(match[2]),
  };
}

export function runSyntaxGate(files: Record<string, string>, touchedFiles: string[]): SyntaxGateResult {
  const errors: SyntaxGateError[] = [];
  const candidates = touchedFiles.filter(shouldCheckSyntax);

  for (const filePath of candidates) {
    const source = files[filePath];
    if (typeof source !== 'string') {
      continue;
    }

    try {
      transform(source, {
        ast: false,
        code: false,
        sourceType: 'module',
        presets: ['typescript', 'react'],
        filename: filePath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const { line, column } = parseLineColumn(message);
      errors.push({
        filePath,
        line,
        column,
        message,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
