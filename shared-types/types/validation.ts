/**
 * Validation types for project file generation and completion
 */

/**
 * Project template type
 */
export type ProjectTemplate = 'next-js' | 'react-vite' | 'react-native' | 'uniapp';

/**
 * Required file definition
 */
export interface RequiredFile {
  /** File path pattern (supports wildcards) */
  path: string;
  /** Whether file is critical for compilation */
  critical: boolean;
  /** Description for AI prompting */
  description: string;
  /** Optional content template identifier */
  template?: string;
}

/**
 * File requirement set for a project type
 */
export interface FileRequirementSet {
  /** Project template type */
  template: ProjectTemplate;
  /** Required files */
  requiredFiles: RequiredFile[];
  /** Optional but recommended files */
  recommendedFiles?: RequiredFile[];
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether all critical files are present */
  isValid: boolean;
  /** Missing critical files */
  missingCritical: RequiredFile[];
  /** Missing recommended files */
  missingRecommended: RequiredFile[];
  /** Present files */
  presentFiles: string[];
}

/**
 * Completion request for AI
 */
export interface CompletionRequest {
  /** Session ID */
  sessionID: string;
  /** Project template */
  template: ProjectTemplate;
  /** Missing files to generate */
  missingFiles: RequiredFile[];
  /** Original user request */
  userMessage: string;
  /** Retry attempt number */
  attemptNumber: number;
  /** Agent ID to use for completion */
  agentId?: string;
}

/**
 * Completion result
 */
export interface CompletionResult {
  /** Whether completion was successful */
  success: boolean;
  /** Files generated in this attempt */
  filesGenerated: number;
  /** Remaining missing files */
  remainingMissing: RequiredFile[];
  /** Error if failed */
  error?: string;
}

/**
 * Validator configuration
 */
export interface ValidatorConfig {
  /** Maximum retry attempts for missing files */
  maxRetries: number;
  /** Delay between retries (ms) */
  retryDelay: number;
  /** Whether to include recommended files in validation */
  checkRecommended: boolean;
  /** Whether to automatically retry on failure */
  autoRetry: boolean;
}
