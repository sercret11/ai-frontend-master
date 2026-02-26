#!/usr/bin/env node

import { spawnSync } from 'child_process'

function detectPythonCommand() {
  const candidates = [
    { program: 'python3', prefixArgs: [] },
    { program: 'python', prefixArgs: [] },
    { program: 'py', prefixArgs: ['-3'] },
    { program: 'py', prefixArgs: [] },
  ]

  for (const candidate of candidates) {
    const result = spawnSync(candidate.program, [...candidate.prefixArgs, '--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    if (result.error || result.status !== 0) {
      continue
    }

    const output = `${result.stdout || ''}${result.stderr || ''}`
    if (/Python\s+\d+\.\d+\.\d+/i.test(output)) {
      return candidate
    }
  }

  return null
}

function main() {
  const [scriptPath, ...scriptArgs] = process.argv.slice(2)

  if (!scriptPath) {
    console.error('[ERROR] Missing python script path.')
    process.exit(1)
  }

  const python = detectPythonCommand()
  if (!python) {
    console.error('[ERROR] Python 3.8+ was not found in PATH.')
    process.exit(1)
  }

  const result = spawnSync(python.program, [...python.prefixArgs, scriptPath, ...scriptArgs], {
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  process.exit(result.status ?? 1)
}

main()
