/**
 * Repair System Types
 *
 * Types for the LLM-based self-repair validation system.
 * All repairs are performed by the LLM agent calling tools, not hardcoded logic.
 */

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  /** Missing npm package dependency */
  MISSING_DEPENDENCY = 'missing_dependency',
  /** TypeScript type error */
  TYPE_ERROR = 'type_error',
  /** Import/export error */
  IMPORT_ERROR = 'import_error',
  /** Syntax error */
  SYNTAX_ERROR = 'syntax_error',
  /** Build compilation error */
  BUILD_ERROR = 'build_error',
  /** Configuration error (tsconfig, vite.config, etc.) */
  CONFIG_ERROR = 'config_error',
  /** Unknown error type */
  UNKNOWN = 'unknown'
}

/**
 * Parsed and classified error from command output
 */
export interface ParsedError {
  /** Error category classification */
  category: ErrorCategory;
  /** File where error occurred (if applicable) */
  file?: string;
  /** Line number (1-based) */
  line?: number;
  /** Column number */
  column?: number;
  /** Error message */
  message: string;
  /** Error code (e.g., TS2307, ERESOLVE) */
  code?: string;
  /** Raw error line from command output */
  raw: string;
  /** Suggested fix hint (for display only, not used for actual fixing) */
  suggestedFix?: string;
  /** Missing package name (for missing dependency errors) */
  missingPackage?: string;
  /** Missing type definition (for @types/* errors) */
  missingTypes?: string;
}

/**
 * File context for LLM repair
 */
export interface FileContext {
  /** File path */
  path: string;
  /** File content */
  content: string;
  /** Programming language */
  language: string;
  /** Error line contexts */
  errorLines: ErrorLineContext[];
}

/**
 * Error line context with surrounding lines
 */
export interface ErrorLineContext {
  /** Line number (1-based) */
  lineNumber: number;
  /** Content of the error line */
  content: string;
  /** Lines before the error (for context) */
  contextBefore: string[];
  /** Lines after the error (for context) */
  contextAfter: string[];
}

/**
 * Complete error context for LLM agent
 */
export interface ErrorContext {
  /** Session ID */
  sessionID: string;
  /** Project template */
  template?: string;
  /** Error summary (e.g., "Found 3 missing dependencies and 2 type errors") */
  summary: string;
  /** All parsed errors */
  errors: ParsedError[];
  /** File contexts for files with errors */
  fileContexts: FileContext[];
  /** Related files that may need attention */
  relatedFiles?: string[];
  /** Timestamp when context was built */
  timestamp: number;
}

/**
 * Repair attempt result
 */
export interface RepairAttempt {
  /** Attempt number (1-indexed) */
  attemptNumber: number;
  /** Errors found at start of attempt */
  errorsFound: ParsedError[];
  /** Tool calls made during this attempt */
  toolCalls: ToolCallSummary[];
  /** Whether this attempt was successful (no errors remaining) */
  success: boolean;
  /** Duration of attempt in milliseconds */
  duration: number;
  /** Number of errors fixed (reduction from previous attempt) */
  errorsFixed?: number;
}

/**
 * Tool call summary
 */
export interface ToolCallSummary {
  /** Tool name (write, edit, read, etc.) */
  toolName: string;
  /** Tool call ID */
  callID: string;
  /** Timestamp when tool was called */
  timestamp: number;
  /** File affected (if applicable) */
  file?: string;
  /** Whether tool call succeeded */
  success?: boolean;
  /** Error if tool call failed */
  error?: string;
}

/**
 * Complete repair session
 */
export interface RepairSession {
  /** Session ID */
  sessionID: string;
  /** Current attempt number */
  attemptNumber: number;
  /** Maximum allowed attempts */
  maxAttempts: number;
  /** Session start timestamp */
  startTime: number;
  /** Session end timestamp (if completed) */
  endTime?: number;
  /** Session status */
  status: RepairSessionStatus;
  /** All repair attempts */
  attempts: RepairAttempt[];
  /** Final result */
  result?: RepairResult;
}

/**
 * Repair session status
 */
export type RepairSessionStatus =
  | 'running'     // Repair loop is active
  | 'success'     // All errors fixed
  | 'failed'      // Could not fix all errors
  | 'max_retries'; // Reached max attempts without success

/**
 * Final repair result
 */
export interface RepairResult {
  /** Whether repair was successful */
  success: boolean;
  /** Total number of attempts made */
  totalAttempts: number;
  /** Reason for failure (if not successful) */
  reason?: string;
  /** Remaining errors (if failed) */
  remainingErrors?: ParsedError[];
  /** All tool calls made across all attempts */
  allToolCalls?: ToolCallSummary[];
}

/**
 * Options for repair process
 */
export interface RepairOptions {
  /** Maximum number of repair attempts (default: 5) */
  maxAttempts?: number;
  /** Timeout per attempt in milliseconds (default: 120000 = 2 minutes) */
  timeoutPerAttempt?: number;
  /** Tools enabled for LLM agent (default: read, write, edit) */
  enabledTools?: string[];
  /** Progress callback */
  onProgress?: (progress: RepairProgress) => void;
  /** Session ID for tracking */
  sessionID: string;
  /** Project template */
  template?: string;
  /** Original user message */
  userMessage?: string;
}

/**
 * Repair progress update
 */
export interface RepairProgress {
  /** Current attempt number */
  attemptNumber: number;
  /** Current stage */
  stage: RepairStage;
  /** Progress message */
  message: string;
  /** Number of errors fixed in this attempt */
  errorsFixed?: number;
  /** Number of errors remaining */
  errorsRemaining?: number;
  /** Current action being performed */
  currentAction?: string;
}

/**
 * Repair stage
 */
export type RepairStage =
  | 'analyzing'    // Analyzing errors from command output
  | 'repairing'    // LLM agent is repairing
  | 'validating'   // Running validation commands
  | 'complete';    // Repair complete (success or failed)

/**
 * Validation result with repair information
 */
export interface ValidationResultWithRepair {
  /** Whether validation passed */
  isValid: boolean;
  /** Whether all errors were repaired */
  allErrorsRepaired?: boolean;
  /** Number of dependency repairs made */
  dependencyRepairs?: number;
  /** Number of type errors found */
  typeErrorsFound?: number;
  /** Number of build errors found */
  buildErrorsFound?: number;
  /** Repair session details */
  repairSession?: RepairSession;
  /** Remaining errors (if validation failed) */
  remainingErrors?: ParsedError[];
  /** Validation errors */
  errors?: ValidationError[];
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Error type */
  type: string;
  /** Error message */
  message: string;
  /** File path (if applicable) */
  file?: string;
  /** Line number (if applicable) */
  line?: number;
}

/**
 * Dependency cache entry
 */
export interface DependencyCacheEntry {
  /** Hash of package.json content */
  hash: string;
  /** Path to cached node_modules */
  nodeModulesPath: string;
  /** Package.json content */
  packageJson: Record<string, any>;
  /** Timestamp when cache was created */
  createdAt: number;
  /** Size in bytes */
  size: number;
}

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
 * Repair iteration result
 */
export interface RepairIterationResult {
  /** Attempt number */
  attemptNumber: number;
  /** Tool calls made during this iteration */
  toolCalls: ToolCallSummary[];
  /** Whether iteration completed successfully */
  success: boolean;
  /** Duration of iteration in milliseconds */
  duration: number;
  /** Errors remaining after this iteration */
  remainingErrors?: number;
}

/**
 * Helper to check if error is repairable by LLM
 */
export function isRepairable(error: ParsedError): boolean {
  return (
    error.category === ErrorCategory.MISSING_DEPENDENCY ||
    error.category === ErrorCategory.TYPE_ERROR ||
    error.category === ErrorCategory.IMPORT_ERROR ||
    error.category === ErrorCategory.SYNTAX_ERROR
  );
}

/**
 * Helper to check if errors are related to missing packages
 */
export function isMissingPackageError(error: ParsedError): boolean {
  return (
    error.category === ErrorCategory.MISSING_DEPENDENCY ||
    error.message.includes('Cannot find module') ||
    error.message.includes('Cannot find import') ||
    error.code === 'TS2307' ||
    error.code === 'ERR_MODULE_NOT_FOUND'
  );
}

/**
 * Helper to extract package name from error message
 */
export function extractPackageName(error: ParsedError): string | null {
  // Match patterns like:
  // - Cannot find module 'package-name'
  // - Cannot find import 'package-name'
  // - error TS2307: Cannot find module 'package-name'
  const patterns = [
    /Cannot find module ['"]([^'"]+)['"]/,
    /Cannot find import ['"]([^'"]+)['"]/,
    /error TS2307: Cannot find module ['"]([^'"]+)['"]/,
  ];

  for (const pattern of patterns) {
    const match = error.message.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  // Check explicit missingPackage field
  if (error.missingPackage) {
    return error.missingPackage;
  }

  return null;
}
