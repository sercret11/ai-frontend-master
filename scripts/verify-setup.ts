#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'fs';
import { dirname, join, normalize } from 'path';
import { fileURLToPath } from 'url';

type CheckResult = {
  ok: boolean;
  message: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const REQUIRED_FILES = ['package.json', 'tsconfig.json', 'vitest.config.ts'] as const;
const REQUIRED_DIRECTORIES = ['backend/src', 'frontend', 'shared-types/types', 'scripts'] as const;

function pass(message: string): CheckResult {
  return { ok: true, message };
}

function fail(message: string): CheckResult {
  return { ok: false, message };
}

function checkRequiredPaths(): CheckResult[] {
  const results: CheckResult[] = [];

  for (const filePath of REQUIRED_FILES) {
    if (existsSync(join(projectRoot, filePath))) {
      results.push(pass(`Found required file: ${filePath}`));
    } else {
      results.push(fail(`Missing required file: ${filePath}`));
    }
  }

  for (const directoryPath of REQUIRED_DIRECTORIES) {
    if (existsSync(join(projectRoot, directoryPath))) {
      results.push(pass(`Found required directory: ${directoryPath}`));
    } else {
      results.push(fail(`Missing required directory: ${directoryPath}`));
    }
  }

  return results;
}

function extractScriptReferences(command: string): string[] {
  const references: string[] = [];
  const regex = /\b(?:node|tsx|python3|python|bash)\s+((?:\.\/)?scripts\/[^\s&|;]+)/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(command)) !== null) {
    const rawPath = match[1];
    if (!rawPath) continue;

    const normalizedPath = normalize(rawPath.replace(/^\.\//, ''));
    references.push(normalizedPath);
  }

  return references;
}

function checkPackageScriptReferences(): CheckResult[] {
  const packageJsonPath = join(projectRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return [fail('Cannot validate package scripts because package.json is missing.')];
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts || {};
  const missingReferences: string[] = [];

  for (const [scriptName, command] of Object.entries(scripts)) {
    const references = extractScriptReferences(command);
    for (const scriptPath of references) {
      if (!existsSync(join(projectRoot, scriptPath))) {
        missingReferences.push(`${scriptName} -> ${scriptPath}`);
      }
    }
  }

  if (missingReferences.length === 0) {
    return [pass('All script references in package.json are valid.')];
  }

  return missingReferences.map(reference => fail(`Missing script reference: ${reference}`));
}

function printResults(results: CheckResult[]): void {
  for (const result of results) {
    const prefix = result.ok ? '[OK]' : '[ERROR]';
    console.log(`${prefix} ${result.message}`);
  }
}

function main(): void {
  const results = [...checkRequiredPaths(), ...checkPackageScriptReferences()];
  printResults(results);

  const hasErrors = results.some(result => !result.ok);
  if (hasErrors) {
    process.exitCode = 1;
    return;
  }

  console.log('[OK] verify-setup completed successfully.');
}

main();
