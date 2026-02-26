/**
 * Repair System Types
 *
 * Internal types for the self-repair system
 */

import type { ParsedError, ToolCallSummary } from '@ai-frontend/shared-types';

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
 * Repair attempt
 */
export interface RepairAttempt {
  /** Attempt number */
  attemptNumber: number;
  /** Errors found in this attempt */
  errorsFound: ParsedError[];
  /** Tool calls made */
  toolCalls: ToolCallSummary[];
  /** Success flag */
  success: boolean;
  /** Duration in milliseconds */
  duration: number;
  /** Number of errors fixed */
  errorsFixed: number;
}
