/**
 * Project Validator - Validation and completion logic for generated projects
 */

import type {
  ValidationResult,
  CompletionRequest,
  CompletionResult,
  ValidatorConfig,
  ProjectTemplate,
  RequiredFile,
} from '@ai-frontend/shared-types';
import { FileStorage } from '../storage/file-storage';
import { getRequiredFiles, isSupportedProjectTemplate, matchesRequiredFile } from './required-files';
import { LLMService } from '../llm/service';
import { CodeQualityChecker } from './code-quality-checker';
import { SelfRepairAgent } from './self-repair-agent';
import { v4 as uuidv4 } from 'uuid';

/**
 * Dead lock detection state
 */
interface DeadLockState {
  /** Previous missing files set (as JSON string for comparison) */
  previousMissingFiles: string;
  /** Same missing files count */
  sameMissingFilesCount: number;
  /** Last attempt with new files generated */
  lastAttemptWithNewFiles: number;
}

/**
 * Default validator configuration
 */
const DEFAULT_CONFIG: ValidatorConfig = {
  maxRetries: 8,
  retryDelay: 1500,
  checkRecommended: false,
  autoRetry: true,
};

function createInvalidTemplateRequirement(template: string): RequiredFile {
  return {
    path: `invalid-template:${template}`,
    critical: true,
    description: `Unsupported project template: ${template}`,
  };
}

/**
 * Project Validator namespace
 */
export namespace ProjectValidator {
  /**
   * Current configuration
   */
  let config: ValidatorConfig = { ...DEFAULT_CONFIG };

  function calculateRetryDelay(attempt: number): number {
    const baseDelay = Math.max(config.retryDelay || 1000, 500);
    const exponential = baseDelay * Math.pow(2, Math.max(0, attempt - 1));
    const capped = Math.min(exponential, 15000);
    const jitter = Math.floor(Math.random() * 400);
    return capped + jitter;
  }

  /**
   * Configure the validator
   */
  export function configure(options: Partial<ValidatorConfig>): void {
    config = { ...config, ...options };
  }

  /**
   * Validate project files
   */
  export function validate(sessionID: string, template: string): ValidationResult {
    if (!isSupportedProjectTemplate(template)) {
      return {
        isValid: false,
        missingCritical: [createInvalidTemplateRequirement(template)],
        missingRecommended: [],
        presentFiles: [],
      };
    }

    const requiredFiles = getRequiredFiles(template);
    const allFiles = FileStorage.getAllFiles(sessionID);
    const filePaths = new Set(allFiles.map(f => f.path));

    const missingCritical: RequiredFile[] = [];
    const missingRecommended: RequiredFile[] = [];
    const presentFiles: string[] = [];

    for (const required of requiredFiles) {
      const isPresent = Array.from(filePaths).some(path =>
        matchesRequiredFile(path, required)
      );

      if (isPresent) {
        presentFiles.push(required.path);
      } else if (required.critical) {
        missingCritical.push(required);
      } else if (config.checkRecommended) {
        missingRecommended.push(required);
      }
    }

    return {
      isValid: missingCritical.length === 0,
      missingCritical,
      missingRecommended,
      presentFiles,
    };
  }

  /**
   * Check if validation is in a deadlock (no progress)
   */
  function isInDeadLock(
    result: ValidationResult,
    state: DeadLockState,
    attemptNumber: number
  ): boolean {
    const currentMissingFiles = JSON.stringify(result.missingCritical.map(f => f.path));

    // Check if same files are missing for 5+ attempts
    if (currentMissingFiles === state.previousMissingFiles) {
      state.sameMissingFilesCount++;
    } else {
      state.sameMissingFilesCount = 0;
      state.previousMissingFiles = currentMissingFiles;
    }

    // Stop if same files missing for 5 attempts
    if (state.sameMissingFilesCount >= 5) {
      console.warn(
        `[ProjectValidator] Deadlock detected: same ${result.missingCritical.length} files ` +
        `missing for ${state.sameMissingFilesCount} consecutive attempts`
      );
      return true;
    }

    // Check if no new files generated in last 10 attempts
    if (attemptNumber - state.lastAttemptWithNewFiles > 10) {
      console.warn(
        `[ProjectValidator] No progress detected: no new files generated ` +
        `in last ${attemptNumber - state.lastAttemptWithNewFiles} attempts`
      );
      return true;
    }

    return false;
  }

  /**
   * Generate enhanced completion prompt with code quality requirements
   */
  export function generateCompletionPrompt(request: CompletionRequest): string {
    const { missingFiles, userMessage, template, attemptNumber } = request;

    let prompt = `The following required files for the ${template} project are missing:\n\n`;

    for (const file of missingFiles) {
      prompt += `- ${file.path}: ${file.description}\n`;
    }

    prompt += `\nOriginal user request: "${userMessage}"\n`;
    prompt += `\nPlease generate these missing files using the write tool.`;

    if (attemptNumber > 1) {
      prompt += `\n\n## ⚠️ IMPORTANT: Retry Attempt ${attemptNumber}`;

      prompt += `\n\nPrevious attempts failed to generate all required files. You MUST create ALL the missing files listed above. Do NOT stop until all files are generated.`;

      prompt += `\n\n## CRITICAL: Code Quality Requirements`;
      prompt += `\n\nYou MUST generate complete, production-ready code:`;
      prompt += `\n1. NO placeholders - Do NOT use "TODO", "FIXME", "// implement later", etc.`;
      prompt += `\n2. NO empty functions - All functions must have actual implementations`;
      prompt += `\n3. NO stub code - Generate real, working code`;
      prompt += `\n4. Complete imports - All imports must have corresponding files`;
      prompt += `\n5. Proper TypeScript types - Use proper types, no 'any' unless absolutely necessary`;
      prompt += `\n6. Proper error handling - Include try-catch where appropriate`;

      prompt += `\n\nCommon issues to avoid:`;
      prompt += `\n- Don't forget to create the files`;
      prompt += `\n- Don't leave placeholders or TODOs`;
      prompt += `\n- Generate complete, working code`;
    }

    return prompt;
  }

  /**
   * Attempt to complete missing files
   */
  export async function complete(
    request: CompletionRequest
  ): Promise<CompletionResult> {
    const { sessionID, template, missingFiles, agentId } = request;

    console.log(`[ProjectValidator] Starting completion for session ${sessionID}`);

    // Generate completion prompt
    const completionPrompt = generateCompletionPrompt(request);

    // Track files generated during completion
    const initialFileCount = FileStorage.getAllFiles(sessionID).length;

    try {
      // Call LLM to generate missing files
      const result = await LLMService.stream({
        sessionID,
        messageID: `completion-${uuidv4()}`,
        agentId: agentId || 'frontend-creator',
        userMessage: completionPrompt,
        messages: [{ role: 'user', content: completionPrompt }],
        onToolResult: (toolResult) => {
          // Save files during completion
          if (toolResult.toolName === 'write') {
            const parseResult = FileStorage.parseFilesFromToolResult(toolResult.output);
            if (parseResult.success && parseResult.files.length > 0) {
              FileStorage.saveFiles(sessionID, parseResult.files);
            }
          }
        },
      });

      // Consume the stream
      for await (const _delta of result.textStream) {
        // Consume but ignore text deltas
      }

      await result.text;
      await result.toolCalls;

      // Validate again
      const validationResult = validate(sessionID, template);

      return {
        success: validationResult.isValid,
        filesGenerated: FileStorage.getAllFiles(sessionID).length - initialFileCount,
        remainingMissing: validationResult.missingCritical,
      };
    } catch (error) {
      console.error('[ProjectValidator] Completion failed:', error);
      return {
        success: false,
        filesGenerated: FileStorage.getAllFiles(sessionID).length - initialFileCount,
        remainingMissing: missingFiles,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Validate and complete with unlimited retries
   * Continues until validation passes AND code quality checks pass (or deadlock detected)
   */
  export async function validateAndComplete(
    sessionID: string,
    template: string,
    userMessage: string,
    agentId: string
  ): Promise<ValidationResult> {
    let result = validate(sessionID, template);
    if (!isSupportedProjectTemplate(template)) {
      return result;
    }

    let attempt = 0;

    // Dead lock detection state
    const deadlockState: DeadLockState = {
      previousMissingFiles: '',
      sameMissingFilesCount: 0,
      lastAttemptWithNewFiles: 0,
    };

    while (!result.isValid && config.autoRetry && attempt < config.maxRetries) {
      attempt++;

      if (result.missingCritical.length === 0) {
        break;
      }

      // Check for deadlock (no progress)
      if (isInDeadLock(result, deadlockState, attempt)) {
        console.warn('[ProjectValidator] Stopping due to deadlock detection');
        break;
      }

      console.log(
        `[ProjectValidator] 🔁 Attempt ${attempt}: ` +
        `${result.missingCritical.length} critical files missing`
      );

      // Wait before retry with exponential backoff + jitter.
      const waitTime = calculateRetryDelay(attempt);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Track initial file count
      const initialFileCount = FileStorage.getAllFiles(sessionID).length;

      // Attempt completion
      const completionResult = await complete({
        sessionID,
        template: template as ProjectTemplate,
        missingFiles: result.missingCritical,
        userMessage,
        attemptNumber: attempt,
        agentId,
      });

      // Check if new files were generated
      const currentFileCount = FileStorage.getAllFiles(sessionID).length;
      if (currentFileCount > initialFileCount) {
        deadlockState.lastAttemptWithNewFiles = attempt;
        console.log(`[ProjectValidator] ✨ Generated ${currentFileCount - initialFileCount} new files`);
      }

      if (!completionResult.success) {
        console.error('[ProjectValidator] ❌ Completion attempt failed:', completionResult.error);
      }

      // Re-validate
      result = validate(sessionID, template);
    }

    // Log file validation result
    if (result.isValid) {
      console.log(`[ProjectValidator] ✅ File validation successful after ${attempt} attempts`);
    } else {
      console.warn(
        `[ProjectValidator] ⚠️  File validation incomplete after ${attempt} attempts. ` +
        `Still missing ${result.missingCritical.length} critical files: ` +
        result.missingCritical.map(f => f.path).join(', ')
      );
    }

    // If files are valid, run validation with self-repair
    if (result.isValid) {
      console.log('[ProjectValidator] 🔧 Running validation with self-repair...');

      try {
        // Run self-repair agent
        const repairResult = await SelfRepairAgent.repair(
          sessionID,
          template,
          userMessage,
          agentId,
          {
            maxAttempts: 5,
            timeoutPerAttempt: 120000, // 2 minutes per attempt
            enabledTools: ['read', 'apply_diff', 'write'],
            onProgress: (progress) => {
              console.log(
                `[ProjectValidator] Repair progress: Attempt ${progress.attemptNumber}/5 - ` +
                `${progress.stage}: ${progress.message}`
              );
            },
          }
        );

        if (repairResult.success) {
          console.log(
            `[ProjectValidator] ✅ Self-repair successful after ${repairResult.totalAttempts} attempts`
          );
        } else {
          console.warn(
            `[ProjectValidator] ⚠️  Self-repair incomplete after ${repairResult.totalAttempts} attempts`
          );

          if (repairResult.reason) {
            console.warn(`  Reason: ${repairResult.reason}`);
          }

          if (repairResult.remainingErrors && repairResult.remainingErrors.length > 0) {
            console.warn(`  Remaining errors: ${repairResult.remainingErrors.length}`);
            repairResult.remainingErrors.slice(0, 5).forEach(err => {
              console.warn(`    • ${err.category}: ${err.message}`);
              if (err.file) {
                console.warn(`      at ${err.file}${err.line ? `:${err.line}` : ''}`);
              }
            });

            if (repairResult.remainingErrors.length > 5) {
              console.warn(`    ... and ${repairResult.remainingErrors.length - 5} more errors`);
            }
          }
        }
      } catch (error) {
        console.error('[ProjectValidator] ❌ Self-repair failed:', error);
        // Don't fail the entire validation if self-repair itself fails
        // The project may still be functional despite repair errors
      }
    }

    return result;
  }

  /**
   * Reset configuration to defaults
   */
export function reset(): void {
    config = { ...DEFAULT_CONFIG };
  }
}
