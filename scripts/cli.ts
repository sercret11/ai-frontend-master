#!/usr/bin/env tsx

/**
 * FrontendMaster CLI - unified command line entry.
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const log = {
  info: (msg: string) => console.log(chalk.blue('[INFO]'), msg),
  success: (msg: string) => console.log(chalk.green('[OK]'), msg),
  warn: (msg: string) => console.log(chalk.yellow('[WARN]'), msg),
  error: (msg: string) => console.log(chalk.red('[ERROR]'), msg),
  header: (msg: string) => console.log(`\n${chalk.bold.cyan(msg)}\n`),
};

async function checkEnvironment(showWarnings = true) {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodeVersion = process.version.replace('v', '');
  const requiredNode = '18.0.0';

  if (compareVersions(nodeVersion, requiredNode) < 0) {
    errors.push(`Node.js version too low: ${nodeVersion} (required >= ${requiredNode})`);
  }

  const nodeModulesPath = join(__dirname, '../node_modules');
  if (!existsSync(nodeModulesPath)) {
    errors.push('Dependencies are not installed. Please run: npm install');
  }

  if (showWarnings && (errors.length > 0 || warnings.length > 0)) {
    log.header('Environment Check');

    if (errors.length > 0) {
      errors.forEach(err => log.error(err));
      console.log('');
      log.info('Fix the errors above and retry.');
      return false;
    }

    if (warnings.length > 0) {
      warnings.forEach(warn => log.warn(warn));
    }
  }

  return errors.length === 0;
}

function compareVersions(v1: string, v2: string): number {
  const parse = (v: string) => {
    const parts = v.split('.').map(Number);
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  };

  const version1 = parse(v1);
  const version2 = parse(v2);

  if (version1.major !== version2.major) return version1.major - version2.major;
  if (version1.minor !== version2.minor) return version1.minor - version2.minor;
  return version1.patch - version2.patch;
}

interface ExecuteCommandOptions {
  spinner?: string;
  success?: string;
  showOutput?: boolean;
  fail?: string;
}

function resolveInitProjectShell(): { program: string; argsPrefix: string[] } {
  const scriptPath = 'scripts/init-project.sh';

  if (process.platform !== 'win32') {
    return {
      program: 'bash',
      argsPrefix: [scriptPath],
    };
  }

  const bashCandidates = [
    process.env.GIT_BASH_PATH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
  ].filter((candidate): candidate is string => Boolean(candidate));

  const bashFromCandidate = bashCandidates.find(candidate => existsSync(candidate));
  if (bashFromCandidate) {
    return {
      program: bashFromCandidate,
      argsPrefix: [scriptPath],
    };
  }

  const whereResult = spawnSync('where', ['bash'], {
    encoding: 'utf-8',
    shell: false,
  });
  const bashFromPath = whereResult.stdout
    ?.split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);

  if (whereResult.status === 0 && bashFromPath) {
    return {
      program: bashFromPath,
      argsPrefix: [scriptPath],
    };
  }

  throw new Error(
    'Bash runtime not found on Windows. Install Git for Windows or set GIT_BASH_PATH to bash.exe.'
  );
}

function executeCommand(
  commandProgram: string,
  commandArgs: string[] = [],
  options: ExecuteCommandOptions = {}
) {
  const commandForLog = [commandProgram, ...commandArgs].join(' ');
  const spinner = ora({
    text: options.spinner || `Running: ${commandForLog}`,
    color: 'cyan',
  });

  try {
    spinner.start();

    const output = spawnSync(commandProgram, commandArgs, {
      encoding: 'utf-8',
      shell: false,
      cwd: join(__dirname, '..'),
    });

    if (output.error) {
      throw output.error;
    }

    if (output.status !== 0) {
      const error = new Error(`Command failed with exit code ${output.status}`);
      (error as Error & { stderr?: string }).stderr = output.stderr || '';
      throw error;
    }

    spinner.succeed(options.success || 'Completed');

    if (output.stdout && options.showOutput !== false) {
      console.log(output.stdout);
    }

    return output.stdout || '';
  } catch (err: unknown) {
    spinner.fail(options.fail || 'Failed');
    if (err && typeof err === 'object' && 'stderr' in err) {
      console.error(chalk.red(String(err.stderr)));
    }
    throw err;
  }
}

program
  .name('frontend-master')
  .description('Unified CLI for cross-platform frontend development')
  .version('2.0.0')
  .option('-v, --verbose', 'Show verbose output');

program
  .command('create [name]')
  .description('Create a new cross-platform project')
  .option('-p, --platforms <platforms>', 'Target platforms (web,mobile,miniprogram,desktop)', 'web')
  .option('--with-ui', 'Include shadcn/ui setup')
  .option('--with-auth', 'Include auth setup')
  .action(async (name, options) => {
    log.header('Create Project');

    const envOk = await checkEnvironment();
    if (!envOk) {
      process.exit(1);
    }

    if (!name) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Project name:',
          default: 'my-app',
        },
        {
          type: 'checkbox',
          name: 'platforms',
          message: 'Select platforms:',
          choices: [
            { name: 'Web (Next.js)', value: 'web', checked: true },
            { name: 'Mobile (React Native)', value: 'mobile' },
            { name: 'Miniprogram (Taro)', value: 'miniprogram' },
            { name: 'Desktop (Electron)', value: 'desktop' },
          ],
        },
        {
          type: 'confirm',
          name: 'withUi',
          message: 'Include shadcn/ui?',
          default: true,
        },
        {
          type: 'confirm',
          name: 'withAuth',
          message: 'Include auth setup?',
          default: false,
        },
      ]);

      name = answers.name;
      options.platforms = answers.platforms.join(',');
      options.withUi = answers.withUi;
      options.withAuth = answers.withAuth;
    }

    const cmd: string[] = [name];

    if (options.platforms) {
      cmd.push('--platforms', options.platforms);
    }
    if (options.withUi) {
      cmd.push('--with-ui');
    }
    if (options.withAuth) {
      cmd.push('--with-auth');
    }

    try {
      const initShell = resolveInitProjectShell();
      executeCommand(initShell.program, [...initShell.argsPrefix, ...cmd], {
        spinner: `Creating project: ${name}`,
        success: `Project "${name}" created`,
        fail: 'Project creation failed',
      });

      console.log('');
      log.success('Next steps:');
      log.info(`  cd ${name}`);
      log.info('  npm install');
      log.info('  npm run dev');
    } catch (error) {
      if (error instanceof Error && error.message) {
        log.error(error.message);
      }
      process.exit(1);
    }
  });

program
  .command('gen-tokens')
  .description('Generate design-system tokens (color/typography/spacing)')
  .option('-p, --product-type <type>', 'Product type (ecommerce, blog, portfolio, etc.)')
  .option('-o, --output <dir>', 'Output directory', './design-system')
  .action(async options => {
    log.header('Generate Design Tokens');

    const envOk = await checkEnvironment();
    if (!envOk) {
      process.exit(1);
    }

    const cmd = ['scripts/generate-design-system.py'];

    if (options.productType) {
      cmd.push('--product-type', options.productType);
    }
    if (options.output) {
      cmd.push('--output', options.output);
    }

    try {
      executeCommand('node', ['scripts/run-python.js', ...cmd], {
        spinner: 'Generating design system...',
        success: 'Design system generated',
        fail: 'Design system generation failed',
      });
    } catch {
      process.exit(1);
    }
  });

program
  .command('detect')
  .description('Detect platform type of the current project')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async options => {
    log.header('Detect Platform');

    const envOk = await checkEnvironment();
    if (!envOk) {
      process.exit(1);
    }

    const cmd = ['scripts/detect-platform.ts', options.path];

    try {
      executeCommand('tsx', cmd, {
        spinner: 'Detecting platform...',
        success: 'Platform detection completed',
        fail: 'Platform detection failed',
      });
    } catch {
      process.exit(1);
    }
  });

program
  .command('component <name>')
  .description('Create a new component (TypeScript supported)')
  .option('-t, --type <type>', 'Component type (shared, web, mobile, desktop, miniprogram)', 'shared')
  .option('-d, --dir <dir>', 'Target directory')
  .action(async (name, options) => {
    log.header('Create Component');

    const envOk = await checkEnvironment();
    if (!envOk) {
      process.exit(1);
    }

    const cmd = ['scripts/create-component.ts', name, '--type', options.type];

    if (options.dir) {
      cmd.push('--dir', options.dir);
    }

    try {
      executeCommand('tsx', cmd, {
        spinner: `Creating component: ${name}`,
        success: `Component "${name}" created`,
        fail: 'Component creation failed',
      });
    } catch {
      process.exit(1);
    }
  });

program
  .command('check')
  .description('Check local development environment')
  .action(async () => {
    log.header('Environment Check');

    const envOk = await checkEnvironment(true);

    if (envOk) {
      console.log('');
      log.success('Environment looks good');
      console.log('');
      console.log('Available commands:');
      console.log('  frontend-master create <name>    - Create project');
      console.log('  frontend-master gen-tokens       - Generate design tokens');
      console.log('  frontend-master detect           - Detect platform');
      console.log('  frontend-master component <name> - Create component');
      console.log('');
    } else {
      console.log('');
      log.error('Environment check failed');
      process.exit(1);
    }
  });

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
