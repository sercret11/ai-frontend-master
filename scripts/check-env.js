#!/usr/bin/env node

/**
 * Environment check for local development.
 * Checks:
 * - Node.js >= 18.0.0
 * - Python >= 3.8.0 (python3/python/py -3)
 * - tsx available (local or global)
 * - project files and folders
 */

import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(color, tag, message) {
  console.log(`${color}${tag}${COLORS.reset} ${message}`)
}

function success(message) {
  log(COLORS.green, '[OK]', message)
}

function fail(message) {
  log(COLORS.red, '[FAIL]', message)
}

function warn(message) {
  log(COLORS.yellow, '[WARN]', message)
}

function info(message) {
  log(COLORS.blue, '[INFO]', message)
}

function header(message) {
  console.log(`\n${COLORS.bright}${COLORS.cyan}${message}${COLORS.reset}`)
  console.log('-'.repeat(message.length))
}

function runCommand(program, args = ['--version']) {
  try {
    const result = spawnSync(program, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    if (result.error || result.status !== 0) {
      return { available: false, output: null }
    }

    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
    return { available: true, output }
  } catch {
    return { available: false, output: null }
  }
}

function parseVersion(versionString) {
  const match = versionString.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  }
}

function compareVersions(version1, version2) {
  const v1 = parseVersion(version1)
  const v2 = parseVersion(version2)

  if (!v1 || !v2) return 0
  if (v1.major !== v2.major) return v1.major - v2.major
  if (v1.minor !== v2.minor) return v1.minor - v2.minor
  return v1.patch - v2.patch
}

function checkNodeVersion() {
  const requiredVersion = '18.0.0'
  const currentVersion = process.version.replace(/^v/, '')

  if (compareVersions(currentVersion, requiredVersion) >= 0) {
    success(`Node.js version: ${currentVersion} (required >= ${requiredVersion})`)
    return true
  }

  fail(`Node.js version: ${currentVersion} (required >= ${requiredVersion})`)
  info('Install/upgrade Node.js: https://nodejs.org/')
  return false
}

function resolvePythonVersion() {
  const candidates = [
    { program: 'python3', args: ['--version'], label: 'python3' },
    { program: 'python', args: ['--version'], label: 'python' },
    { program: 'py', args: ['-3', '--version'], label: 'py -3' },
    { program: 'py', args: ['--version'], label: 'py' },
  ]

  for (const candidate of candidates) {
    const result = runCommand(candidate.program, candidate.args)
    if (!result.available || !result.output) {
      continue
    }

    const versionMatch = result.output.match(/Python\s+(\d+\.\d+\.\d+)/i)
    if (versionMatch) {
      return {
        command: candidate.label,
        version: versionMatch[1],
      }
    }
  }

  return null
}

function checkPythonVersion() {
  const requiredVersion = '3.8.0'
  const detected = resolvePythonVersion()

  if (!detected) {
    fail('Python not found')
    info('Install Python 3.8+: https://www.python.org/downloads/')
    return false
  }

  if (compareVersions(detected.version, requiredVersion) >= 0) {
    success(`Python version: ${detected.version} (command: ${detected.command}, required >= ${requiredVersion})`)
    return true
  }

  fail(`Python version: ${detected.version} (command: ${detected.command}, required >= ${requiredVersion})`)
  info('Install/upgrade Python: https://www.python.org/downloads/')
  return false
}

function checkTsx() {
  try {
    const localTsx = join(__dirname, '../node_modules/.bin/tsx')
    const localTsxCmd = `${localTsx}.cmd`

    if (existsSync(localTsx) || existsSync(localTsxCmd)) {
      success('tsx installed (local)')
      return true
    }
  } catch {
    // fallthrough to global check
  }

  const globalTsx = runCommand('tsx', ['--version'])
  if (globalTsx.available) {
    success(`tsx installed (global: ${globalTsx.output})`)
    return true
  }

  fail('tsx not found')
  info('Install tsx globally: npm install -g tsx')
  info('Or install locally: npm install -D tsx')
  return false
}

function checkDependencies() {
  const packageJsonPath = join(__dirname, '../package.json')
  if (!existsSync(packageJsonPath)) {
    fail('Missing package.json')
    return false
  }

  success('Found package.json')

  const nodeModulesPath = join(__dirname, '../node_modules')
  if (!existsSync(nodeModulesPath)) {
    fail('Missing node_modules (run npm install)')
    return false
  }

  success('Found node_modules')
  return true
}

function checkScripts() {
  const scripts = [
    'init-project.sh',
    'generate-design-system.py',
    'detect-platform.ts',
    'create-component.ts',
  ]

  let allExist = true
  for (const script of scripts) {
    const scriptPath = join(__dirname, script)
    if (existsSync(scriptPath)) {
      success(`Found script: ${script}`)
    } else {
      fail(`Missing script: ${script}`)
      allExist = false
    }
  }

  return allExist
}

function main() {
  header('FrontendMaster Environment Check')
  console.log('')

  const results = {
    node: checkNodeVersion(),
    python: checkPythonVersion(),
    tsx: checkTsx(),
    dependencies: checkDependencies(),
    scripts: checkScripts(),
  }

  console.log('')
  header('Summary')
  console.log('')

  const totalChecks = Object.keys(results).length
  const passedChecks = Object.values(results).filter(Boolean).length

  info(`Passed: ${passedChecks}/${totalChecks}`)

  if (passedChecks === totalChecks) {
    console.log('')
    success('All checks passed')
    process.exit(0)
  }

  console.log('')
  fail('Some checks failed')

  if (!results.node) {
    console.log('  - Upgrade Node.js: https://nodejs.org/')
  }
  if (!results.python) {
    console.log('  - Install Python: https://www.python.org/downloads/')
  }
  if (!results.tsx) {
    console.log('  - Install tsx: npm install -D tsx')
  }
  if (!results.dependencies) {
    console.log('  - Install dependencies: npm install')
  }

  process.exit(1)
}

main()
