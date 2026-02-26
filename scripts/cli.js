#!/usr/bin/env node
/**
 * Thin JS wrapper for the TypeScript CLI.
 * Avoids shell string interpolation and forwards args safely.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const cliScript = path.join(__dirname, 'cli.ts');
const args = process.argv.slice(2);

const result = spawnSync('tsx', [cliScript, ...args], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(`[ERROR] Failed to start cli.ts: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

