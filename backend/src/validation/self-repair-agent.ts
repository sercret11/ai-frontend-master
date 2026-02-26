/**
 * Self-Repair Agent - LLM-based intelligent error repair orchestration
 *
 * This module orchestrates the self-repair loop where:
 * 1. Run validation commands to capture errors
 * 2. Build error context for LLM
 * 3. Invoke LLM agent to analyze and fix errors
 * 4. Track tool calls and save results
 * 5. Re-validate until success or max iterations
 */

import { v4 as uuidv4 } from 'uuid';
import { ParsedError, ErrorContext, RepairResult, RepairSession, RepairSessionStatus, RepairProgress, RepairIterationResult, ErrorCategory, ToolCallSummary, PermissionRequest } from '@ai-frontend/shared-types';
import { ErrorClassifier } from './error-classifier';
import { ErrorContextBuilder } from './error-context-builder';
import { CommandRunner } from './command-runner';
import { DependencyValidator } from './dependency-validator';
import { createErrorFingerprint } from './error-fingerprint';
import {
  formatSearchHints,
  searchAugmentedRepair,
  type VisualDiffBundleRef,
} from './search-augmented-repair';
import { config } from '../config';
import { LLMService } from '../llm/service';
import { ToolRegistry } from '../tool/registry';
import { enforcePermission } from '../tool/permission-policy';
import type { RepairAttempt } from './repair-types';
import { FileStorage } from '../storage/file-storage';
import { createContractBundle, formatContractBundle } from '../orchestration/contract-freezer';
import path from 'path';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { playwrightContextManager } from './playwright-context-manager';

/**
 * Self-Repair Agent namespace
 */
export namespace SelfRepairAgent {
  type RepairStrategyProfile = 'default' | 'imports-first' | 'types-first' | 'build-first';

  interface RepairSnapshot {
    files: Array<{ path: string; content: string; language: string }>;
    errorCount: number;
    fingerprint: string;
    capturedAt: number;
  }

  function createRepairSnapshot(sessionID: string, errorCount: number, fingerprint: string): RepairSnapshot {
    const files = FileStorage.getAllFiles(sessionID).map(file => ({
      path: file.path,
      content: file.content,
      language: file.language,
    }));
    return {
      files,
      errorCount,
      fingerprint,
      capturedAt: Date.now(),
    };
  }

  function rollbackToSnapshot(sessionID: string, snapshot: RepairSnapshot): void {
    FileStorage.deleteFiles(sessionID);
    if (snapshot.files.length > 0) {
      FileStorage.saveFiles(sessionID, snapshot.files);
    }
    console.warn(
      `[SelfRepairAgent] Rolled back to snapshot captured at ${new Date(snapshot.capturedAt).toISOString()}`
    );
  }

  function resolveStrategyProfile(repeatCount: number): RepairStrategyProfile {
    if (repeatCount >= 4) return 'build-first';
    if (repeatCount >= 3) return 'types-first';
    if (repeatCount >= 2) return 'imports-first';
    return 'default';
  }

  function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}\n...<truncated>`;
  }

  function getSessionPackageJson(sessionID: string): string | null {
    const file = FileStorage.getAllFiles(sessionID).find(item => item.path === 'package.json');
    if (!file) return null;
    return file.content;
  }

  function buildDependencySignature(sessionID: string): string {
    const packageJson = getSessionPackageJson(sessionID);
    if (!packageJson) {
      return 'no-package-json';
    }

    try {
      const parsed = JSON.parse(packageJson) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const payload = {
        dependencies: Object.entries(parsed.dependencies || {}).sort(([left], [right]) =>
          left.localeCompare(right)
        ),
        devDependencies: Object.entries(parsed.devDependencies || {}).sort(([left], [right]) =>
          left.localeCompare(right)
        ),
      };
      return createHash('sha1').update(JSON.stringify(payload)).digest('hex');
    } catch {
      return createHash('sha1').update(packageJson).digest('hex');
    }
  }

  function createSkippedCommandResult(command: string): ReturnType<typeof createCommandResult> {
    return createCommandResult(command, 0, '', '', 0, false);
  }

  function createCommandResult(
    command: string,
    exitCode: number,
    stdout: string,
    stderr: string,
    duration: number,
    timedOut: boolean
  ) {
    return {
      command,
      exitCode,
      stdout,
      stderr,
      duration,
      timedOut,
    };
  }

  async function runL2RuntimeValidation(sessionID: string): Promise<ReturnType<typeof createCommandResult>> {
    const url = (process.env['SELF_REPAIR_PLAYWRIGHT_URL'] || '').trim();
    if (!url) {
      return createSkippedCommandResult('playwright-runtime-check (skipped: SELF_REPAIR_PLAYWRIGHT_URL missing)');
    }

    const result = await playwrightContextManager.runRuntimeCheck(sessionID, url, 5000);
    if (result.ok) {
      return createCommandResult(
        'playwright-runtime-check',
        0,
        'runtime check passed',
        '',
        0,
        false
      );
    }

    return createCommandResult(
      'playwright-runtime-check',
      1,
      '',
      result.error || 'runtime check failed',
      0,
      false
    );
  }

  function collectLocalTypeDefinitions(sessionID: string): string {
    const files = FileStorage.getAllFiles(sessionID)
      .filter(file => file.path.endsWith('.d.ts'))
      .slice(0, 10);
    if (files.length === 0) return '';

    const blocks: string[] = [];
    for (const file of files) {
      const snippet = truncateText(file.content, 800);
      blocks.push(`${file.path}\n${snippet}`);
    }
    return blocks.join('\n\n');
  }

  async function collectInstalledTypeHints(
    sessionID: string,
    dependencyNames: string[]
  ): Promise<string> {
    if (dependencyNames.length === 0) return '';

    let tempDir: string | null = null;
    try {
      tempDir = await CommandRunner.createValidationDir(sessionID);
      await CommandRunner.exportSessionFiles(sessionID, tempDir);
      const npmResult = await CommandRunner.runNpmInstall(sessionID, { cwd: tempDir });
      if (npmResult.exitCode !== 0) {
        return `npm install failed while preparing type hints: ${truncateText(
          npmResult.stderr || npmResult.stdout || 'unknown error',
          600
        )}`;
      }

      const lines: string[] = [];
      const nodeModulesDir = path.join(tempDir, 'node_modules');
      const visited = new Set<string>();
      const maxFiles = 12;

      for (const dependencyName of dependencyNames.slice(0, 12)) {
        const depPath = path.join(nodeModulesDir, ...dependencyName.split('/'));
        if (visited.has(depPath)) continue;
        visited.add(depPath);

        const dtsCandidates: string[] = [
          path.join(depPath, 'index.d.ts'),
          path.join(depPath, 'dist', 'index.d.ts'),
          path.join(depPath, 'types', 'index.d.ts'),
        ];

        for (const candidate of dtsCandidates) {
          try {
            const stat = await fs.stat(candidate);
            if (!stat.isFile()) continue;
            const content = await fs.readFile(candidate, 'utf-8');
            const relative = path.relative(tempDir, candidate).replace(/\\/g, '/');
            lines.push(`${relative}\n${truncateText(content, 500)}`);
            break;
          } catch {
            // Ignore missing path candidates.
          }
        }

        if (lines.length >= maxFiles) break;
      }

      return lines.join('\n\n');
    } catch (error) {
      return `failed to collect installed type hints: ${
        error instanceof Error ? error.message : String(error)
      }`;
    } finally {
      if (tempDir) {
        await CommandRunner.cleanup(tempDir);
      }
    }
  }

  async function buildStrategyContext(
    sessionID: string,
    strategy: RepairStrategyProfile,
    errors: ParsedError[],
    cache: Map<string, string>
  ): Promise<string> {
    const cacheKey = `${sessionID}:${strategy}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) || '';
    }

    if (strategy === 'default') {
      return '';
    }

    const sections: string[] = [`[StrategyContext] profile=${strategy}`];

    if (strategy === 'imports-first') {
      const packageJson = getSessionPackageJson(sessionID);
      if (packageJson) {
        sections.push('[package.json]');
        sections.push('```json');
        sections.push(truncateText(packageJson, 12000));
        sections.push('```');

        try {
          const parsed = JSON.parse(packageJson) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
          };
          const dependencyNames = [
            ...Object.keys(parsed.dependencies || {}),
            ...Object.keys(parsed.devDependencies || {}),
          ];

          const localTypes = collectLocalTypeDefinitions(sessionID);
          if (localTypes) {
            sections.push('[LocalTypeDefinitions]');
            sections.push('```ts');
            sections.push(localTypes);
            sections.push('```');
          }

          const installedHints = await collectInstalledTypeHints(sessionID, dependencyNames);
          if (installedHints) {
            sections.push('[InstalledTypeHints]');
            sections.push('```ts');
            sections.push(installedHints);
            sections.push('```');
          }
        } catch {
          sections.push('package.json parse failed while preparing imports-first strategy context.');
        }
      }
    } else if (strategy === 'types-first') {
      const bundle = createContractBundle(sessionID);
      sections.push(formatContractBundle(bundle));
    } else if (strategy === 'build-first') {
      const tails = errors
        .slice(0, 4)
        .map(error => (error.raw || error.message || '').split('\n').slice(-4).join('\n'))
        .filter(Boolean);
      if (tails.length > 0) {
        sections.push('[BuildErrorTails]');
        sections.push('```text');
        sections.push(truncateText(tails.join('\n\n---\n\n'), 8000));
        sections.push('```');
      }
    }

    const context = sections.join('\n');
    cache.set(cacheKey, context);
    return context;
  }

  /**
   * Main repair function - runs validation loop with LLM repair
   */
  export async function repair(
    sessionID: string,
    template: string,
    userMessage: string,
    agentId: string,
    options: {
      maxAttempts?: number;
      timeoutPerAttempt?: number;
      enabledTools?: string[];
      visualDiffBundleRef?: VisualDiffBundleRef;
      onProgress?: (progress: RepairProgress) => void;
    } = {}
  ): Promise<RepairResult> {
    const {
      maxAttempts = 5,
      timeoutPerAttempt = 120000, // 2 minutes per attempt
      enabledTools = ['read', 'apply_diff', 'write'],
      visualDiffBundleRef,
      onProgress,
    } = options;

    console.log(`[SelfRepairAgent] Starting repair loop (max ${maxAttempts} attempts)`);

    const session: RepairSession = {
      sessionID,
      attemptNumber: 0,
      maxAttempts,
      startTime: Date.now(),
      status: 'running',
      attempts: [],
    };

    let previousErrorCount = Infinity;
    let previousFingerprint = '';
    let sameFingerprintFailures = 0;
    let pendingSnapshot: RepairSnapshot | null = null;
    let currentStrategy: RepairStrategyProfile = 'default';
    const strategyHistory: RepairStrategyProfile[] = ['default'];
    const strategyContextCache = new Map<string, string>();
    let validationDir: string | null = null;
    let installedDependencySignature: string | null = null;

    while (session.attemptNumber < session.maxAttempts) {
      session.attemptNumber++;

      // 创建临时验证目录（用于后续的所有验证步骤）
      if (!validationDir) {
        validationDir = await CommandRunner.createValidationDir(sessionID);
      }
      const tempDir = validationDir;
      await CommandRunner.exportSessionFiles(sessionID, tempDir);

      // Phase 0: 主动依赖检测 (在运行任何命令之前)
      onProgress?.({
        attemptNumber: session.attemptNumber,
        stage: 'validating',
        message: `Scanning for missing dependencies (attempt ${session.attemptNumber}/${session.maxAttempts})...`,
      });

      console.log(`[SelfRepairAgent] Attempt ${session.attemptNumber}: Scanning for missing dependencies...`);

      const depValidation = await DependencyValidator.scanImports(sessionID);

      if (depValidation.missingPackages.length > 0 || depValidation.missingDevPackages.length > 0) {
        console.log(`[SelfRepairAgent] ❌ Found missing dependencies:`);
        console.log(`  - Packages: ${depValidation.missingPackages.join(', ') || '(none)'}`);
        console.log(`  - DevPackages: ${depValidation.missingDevPackages.join(', ') || '(none)'}`);

        // 转换为错误并修复
        const dependencyErrors: ParsedError[] = [];

        for (const pkg of depValidation.missingPackages) {
          dependencyErrors.push({
            category: ErrorCategory.MISSING_DEPENDENCY,
            message: `Missing dependency: ${pkg}`,
            missingPackage: pkg,
            raw: `Cannot find module '${pkg}'`,
          });
        }

        for (const pkg of depValidation.missingDevPackages) {
          dependencyErrors.push({
            category: ErrorCategory.MISSING_DEPENDENCY,
            message: `Missing devDependency: ${pkg}`,
            missingPackage: pkg,
            raw: `Cannot find module '${pkg}'`,
          });
        }

        // 直接进入 LLM 修复流程
        onProgress?.({
          attemptNumber: session.attemptNumber,
          stage: 'analyzing',
          message: `Analyzing ${dependencyErrors.length} missing dependencies...`,
        });

        const context = await ErrorContextBuilder.build(sessionID, dependencyErrors, template);

        onProgress?.({
          attemptNumber: session.attemptNumber,
          stage: 'repairing',
          message: `Agent is adding ${dependencyErrors.length} missing dependencies...`,
        });

        console.log(`[SelfRepairAgent] Attempt ${session.attemptNumber}: Invoking LLM agent to fix missing dependencies...`);

        const repairResult = await repairSingleIteration(
          sessionID,
          context,
          session.attemptNumber,
          agentId,
          enabledTools,
          undefined
        );

        const attempt: RepairAttempt = {
          attemptNumber: session.attemptNumber,
          errorsFound: dependencyErrors,
          toolCalls: repairResult.toolCalls,
          success: false, // Will be validated in next iteration
          duration: repairResult.duration,
          errorsFixed: 0,
        };

        session.attempts.push(attempt);
        console.log(`[SelfRepairAgent] Attempt ${session.attemptNumber}: Agent made ${repairResult.toolCalls.length} tool calls for missing dependencies`);

        // 修复后继续循环，不执行后续的 npm install/build
        continue;
      }

      // Phase 1: 早期验证检查 (在标准验证之前)
      console.log(`[SelfRepairAgent] Running pre-build checks...`);

      const preBuildChecks = await CommandRunner.runPreBuildChecks(sessionID, template, { cwd: tempDir });

      const earlyErrors = preBuildChecks.flatMap(check =>
        ErrorClassifier.parseBuildErrors(check.stderr, check.stdout)
      );

      if (earlyErrors.length > 0) {
        console.log(`[SelfRepairAgent] ❌ Pre-build checks found ${earlyErrors.length} errors`);

        // 使用早期发现的错误进行修复
        onProgress?.({
          attemptNumber: session.attemptNumber,
          stage: 'analyzing',
          message: `Analyzing ${earlyErrors.length} early errors...`,
        });

        const context = await ErrorContextBuilder.build(sessionID, earlyErrors, template);

        onProgress?.({
          attemptNumber: session.attemptNumber,
          stage: 'repairing',
          message: `Agent is fixing ${earlyErrors.length} early errors...`,
        });

        console.log(`[SelfRepairAgent] Attempt ${session.attemptNumber}: Invoking LLM agent to fix early errors...`);

        const repairResult = await repairSingleIteration(
          sessionID,
          context,
          session.attemptNumber,
          agentId,
          enabledTools,
          undefined
        );

        const attempt: RepairAttempt = {
          attemptNumber: session.attemptNumber,
          errorsFound: earlyErrors,
          toolCalls: repairResult.toolCalls,
          success: false, // Will be validated in next iteration
          duration: repairResult.duration,
          errorsFixed: 0,
        };

        session.attempts.push(attempt);
        console.log(`[SelfRepairAgent] Attempt ${session.attemptNumber}: Agent made ${repairResult.toolCalls.length} tool calls for early errors`);

        // 修复后继续循环，不执行后续的 npm install/build
        continue;
      }

      // Step 2: Run validation commands
      onProgress?.({
        attemptNumber: session.attemptNumber,
        stage: 'validating',
        message: `Running L0/L1/L2 validation (attempt ${session.attemptNumber}/${session.maxAttempts})...`,
      });

      console.log(
        `[SelfRepairAgent] Attempt ${session.attemptNumber}: Running validation commands (L0/L1/L2)...`
      );

      const dependencySignature = buildDependencySignature(sessionID);
      const installRequired = installedDependencySignature !== dependencySignature;
      const npmResult = installRequired
        ? await CommandRunner.runNpmInstall(sessionID, { cwd: tempDir })
        : createSkippedCommandResult('npm install (skipped: dependency signature unchanged)');
      if (npmResult.exitCode === 0) {
        installedDependencySignature = dependencySignature;
      }
      const l0Result =
        npmResult.exitCode === 0
          ? await CommandRunner.runL0SyntaxCheck(sessionID, { cwd: tempDir })
          : createSkippedCommandResult('l0-syntax-check (skipped due to npm install failure)');
      const eslintResult =
        npmResult.exitCode === 0 && l0Result.exitCode === 0
          ? await CommandRunner.runEslint(sessionID, { cwd: tempDir })
          : createSkippedCommandResult('eslint (skipped due to npm/l0 failure)');
      const tscResult =
        npmResult.exitCode === 0 && l0Result.exitCode === 0
          ? await CommandRunner.runTsc(sessionID, { cwd: tempDir })
          : createSkippedCommandResult('tsc --noEmit (skipped due to npm/l0 failure)');

      const buildResult =
        npmResult.exitCode === 0 &&
        l0Result.exitCode === 0 &&
        eslintResult.exitCode === 0 &&
        tscResult.exitCode === 0
          ? await CommandRunner.runBuild(sessionID, { cwd: tempDir })
          : createSkippedCommandResult('npm run build (skipped due to l0/l1 failure)');
      const l2RuntimeResult =
        npmResult.exitCode === 0 &&
        l0Result.exitCode === 0 &&
        eslintResult.exitCode === 0 &&
        tscResult.exitCode === 0 &&
        buildResult.exitCode === 0
          ? await runL2RuntimeValidation(sessionID)
          : createSkippedCommandResult('playwright-runtime-check (skipped due to previous failure)');

      // Step 2: Parse and classify errors
      const l0Errors: ParsedError[] =
        l0Result.exitCode !== 0
          ? [
              {
                category: ErrorCategory.SYNTAX_ERROR,
                message: 'L0 syntax check failed',
                raw: l0Result.stderr || l0Result.stdout,
              },
            ]
          : [];
      const eslintErrors: ParsedError[] =
        eslintResult.exitCode !== 0
          ? [
              {
                category: ErrorCategory.TYPE_ERROR,
                message: 'ESLint validation failed',
                raw: eslintResult.stderr || eslintResult.stdout,
              },
            ]
          : [];
      const l2Errors: ParsedError[] =
        l2RuntimeResult.exitCode !== 0
          ? [
              {
                category: ErrorCategory.BUILD_ERROR,
                message: 'Playwright runtime validation failed',
                raw: l2RuntimeResult.stderr || l2RuntimeResult.stdout,
              },
            ]
          : [];
      const allErrors = [
        ...ErrorClassifier.parseNpmInstallErrors(npmResult.stderr),
        ...l0Errors,
        ...eslintErrors,
        ...ErrorClassifier.parseTypeScriptErrors(tscResult.stderr),
        ...ErrorClassifier.parseBuildErrors(buildResult.stderr, buildResult.stdout),
        ...l2Errors,
      ];

      console.log(`[SelfRepairAgent] Attempt ${session.attemptNumber}: Found ${allErrors.length} total errors`);

      if (pendingSnapshot && allErrors.length > pendingSnapshot.errorCount) {
        console.warn(
          `[SelfRepairAgent] Error count worsened (${allErrors.length} > ${pendingSnapshot.errorCount}), rollback snapshot and switch strategy`
        );
        rollbackToSnapshot(sessionID, pendingSnapshot);
        pendingSnapshot = null;
        continue;
      }
      pendingSnapshot = null;

      // Filter to repairable errors only
      const repairableErrors = allErrors.filter(ErrorClassifier.isRepairableError);

      if (repairableErrors.length === 0) {
        // Success! No repairable errors
        console.log(`[SelfRepairAgent] ✅ Success! No repairable errors after ${session.attemptNumber} attempts`);

        session.status = 'success';
        session.endTime = Date.now();
        session.result = {
          success: true,
          totalAttempts: session.attemptNumber,
        };

        if (validationDir) {
          await CommandRunner.cleanup(validationDir);
          validationDir = null;
        }
        await playwrightContextManager.disposeSession(sessionID);
        return session.result;
      }

      console.log(`[SelfRepairAgent] Attempt ${session.attemptNumber}: ${repairableErrors.length} repairable errors`);

      let repairGuidance = '';
      let strategyContext = '';
      const currentFingerprint = createErrorFingerprint(repairableErrors);
      if (currentFingerprint === previousFingerprint) {
        sameFingerprintFailures += 1;
      } else {
        sameFingerprintFailures = 1;
        previousFingerprint = currentFingerprint;
        currentStrategy = 'default';
      }

      const previousCountBeforeUpdate = previousErrorCount;
      if (repairableErrors.length >= previousErrorCount) {
        console.warn(`[SelfRepairAgent] ⚠️ No progress: ${repairableErrors.length} >= ${previousErrorCount}`);
      }
      previousErrorCount = repairableErrors.length;

      const nextStrategy = resolveStrategyProfile(sameFingerprintFailures);
      if (nextStrategy !== currentStrategy) {
        currentStrategy = nextStrategy;
        strategyHistory.push(nextStrategy);
        console.warn(
          `[SelfRepairAgent] Switched strategy to ${nextStrategy} (same fingerprint failures=${sameFingerprintFailures})`
        );
      }

      if (sameFingerprintFailures >= 3) {
        const searchResult = await searchAugmentedRepair(repairableErrors, {
          allowedDomains: config.selfRepair.searchAllowedDomains,
          visualDiffBundleRef,
          maxVisualPayloadChars: 2400,
        });
        repairGuidance = formatSearchHints(searchResult);
        console.warn(
          `[SelfRepairAgent] Triggered MCP/search-augmented repair for fingerprint=${currentFingerprint}`
        );
      }
      if (currentStrategy !== 'default') {
        strategyContext = await buildStrategyContext(
          sessionID,
          currentStrategy,
          repairableErrors,
          strategyContextCache
        );
      }

      // Step 4: Build error context for LLM
      onProgress?.({
        attemptNumber: session.attemptNumber,
        stage: 'analyzing',
        message: `Analyzing ${repairableErrors.length} errors...`,
      });

      const context = await ErrorContextBuilder.build(sessionID, repairableErrors, template);

      // Step 5: Invoke LLM agent to repair
      onProgress?.({
        attemptNumber: session.attemptNumber,
        stage: 'repairing',
        message: `Agent is repairing ${repairableErrors.length} errors...`,
      });

      console.log(`[SelfRepairAgent] Attempt ${session.attemptNumber}: Invoking LLM agent...`);

      const repairResult = await repairSingleIteration(
        sessionID,
        context,
        session.attemptNumber,
        agentId,
        enabledTools,
        repairGuidance,
        currentStrategy,
        strategyContext
      );

      pendingSnapshot = createRepairSnapshot(
        sessionID,
        repairableErrors.length,
        currentFingerprint
      );

      const attempt: RepairAttempt = {
        attemptNumber: session.attemptNumber,
        errorsFound: repairableErrors,
        toolCalls: repairResult.toolCalls,
        success: repairableErrors.length === 0, // Will be updated after re-validation
        duration: repairResult.duration,
        errorsFixed:
          previousCountBeforeUpdate === Infinity
            ? 0
            : Math.max(previousCountBeforeUpdate - repairableErrors.length, 0),
      };

      session.attempts.push(attempt);

      console.log(`[SelfRepairAgent] Attempt ${session.attemptNumber}: Agent made ${repairResult.toolCalls.length} tool calls`);
    }

    // Max attempts reached
    console.warn(`[SelfRepairAgent] Reached max attempts (${session.maxAttempts})`);

    session.status = 'max_retries';
    session.endTime = Date.now();
    session.result = {
      success: false,
      totalAttempts: session.attemptNumber,
      reason: 'Max attempts reached',
    };

    if (validationDir) {
      await CommandRunner.cleanup(validationDir);
      validationDir = null;
    }
    await playwrightContextManager.disposeSession(sessionID);
    return session.result;
  }

  /**
   * Single repair iteration - call LLM agent once
   */
  async function repairSingleIteration(
    sessionID: string,
    context: ErrorContext,
    attemptNumber: number,
    agentId: string,
    enabledTools: string[],
    repairGuidance?: string,
    strategyProfile: RepairStrategyProfile = 'default',
    strategyContext?: string
  ): Promise<RepairIterationResult> {
    const startTime = Date.now();

    try {
      // 1. Generate repair prompt
      const basePrompt = ErrorContextBuilder.createRepairPrompt(context, attemptNumber);
      const promptSections = [basePrompt];
      if (repairGuidance) {
        promptSections.push(`[RepairGuidance]\n${repairGuidance}`);
      }
      if (strategyProfile !== 'default') {
        promptSections.push(`[RepairStrategy]\nprofile=${strategyProfile}`);
      }
      if (strategyContext && strategyContext.trim().length > 0) {
        promptSections.push(strategyContext);
      }
      const prompt = promptSections.join('\n\n');

      // 2. Call LLM service with tools
      const toolCalls: ToolCallSummary[] = [];
      let toolCallCount = 0;

      // 3. Stream response and handle tool calls
      const response = await LLMService.stream({
        agentId,
        messageID: `repair-${sessionID}-${attemptNumber}-${Date.now()}`,
        userMessage: prompt,
        sessionID,
        onToolCall: async (call) => {
          toolCallCount++;
          console.log(`[SelfRepairAgent] Tool call #${toolCallCount}: ${call.toolName}`);

          const summary: ToolCallSummary = {
            toolName: call.toolName,
            callID: call.callID,
            timestamp: Date.now(),
          };

          toolCalls.push(summary);

          // Execute tool and save result
          try {
            const result = await executeToolCall(sessionID, call);
            summary.success = true;

            // write/apply_diff 工具已在自身执行逻辑中持久化文件
          } catch (error) {
            console.error(`[SelfRepairAgent] Tool call failed:`, error);
            summary.success = false;
            summary.error = error instanceof Error ? error.message : 'Unknown error';
          }
        },
      });

      // 4. Wait for completion
      await response.text;
      await response.toolCalls;

      const duration = Date.now() - startTime;

      console.log(`[SelfRepairAgent] Repair iteration ${attemptNumber} completed: ${toolCallCount} tool calls in ${duration}ms`);

      return {
        attemptNumber,
        toolCalls,
        success: true,
        duration,
      };
    } catch (error) {
      console.error(`[SelfRepairAgent] Repair iteration ${attemptNumber} failed:`, error);

      return {
        attemptNumber,
        toolCalls: [],
        success: false,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a tool call
   */
  async function executeToolCall(
    sessionID: string,
    call: { toolName: string; callID: string; args: Record<string, unknown> }
  ): Promise<any> {
    const tool = await ToolRegistry.getById(call.toolName);

    if (!tool) {
      throw new Error(`Tool not found: ${call.toolName}`);
    }

    // Initialize tool
    const initialized = await tool.init();

    // Execute tool with proper context
    const result = await initialized.execute(call.args, {
      sessionID,
      messageID: call.callID,
      agent: 'self-repair',
      abort: new AbortController().signal,
      callID: call.callID,
      metadata: (input: { title?: string; metadata?: any }) => {
        // Set metadata for tool execution
        console.log(`[SelfRepairAgent] Tool metadata: ${input.title || call.toolName}`);
      },
      ask: async (permission: PermissionRequest) => {
        await enforcePermission(permission, {
          source: 'self-repair',
          agent: 'self-repair',
          sessionID,
          messageID: call.callID,
          callID: call.callID,
          toolName: call.toolName,
        });
      },
      onToolCall: undefined,
    } as any);

    return result;
  }

  /**
   * Get current repair session status
   */
  export async function getSessionStatus(sessionID: string): Promise<RepairSession | null> {
    // This would need to be implemented with session tracking
    // For now, return null
    return null;
  }

  /**
   * Cancel ongoing repair
   */
  export async function cancelRepair(sessionID: string): Promise<boolean> {
    // This would need to be implemented with cancellation tokens
    // For now, return false
    return false;
  }

  /**
   * Check if repair is currently running for a session
   */
  export async function isRepairRunning(sessionID: string): Promise<boolean> {
    return false; // Would need actual implementation
  }

  /**
   * Get repair statistics for a session
   */
  export async function getRepairStats(sessionID: string): Promise<{
    totalAttempts: number;
    successfulAttempts: number;
    totalErrorsFixed: number;
    totalToolCalls: number;
  } | null> {
    return null; // Would need actual implementation
  }
}
