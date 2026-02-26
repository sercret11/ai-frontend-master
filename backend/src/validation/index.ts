/**
 * Validation module exports
 */

// Existing validators
export { ProjectValidator } from './project-validator';
export {
  getRequiredFiles,
  getFileRequirementSet,
  isSupportedProjectTemplate,
  matchesRequiredFile,
  SUPPORTED_PROJECT_TEMPLATES,
} from './required-files';
export { CodeQualityChecker } from './code-quality-checker';

// Self-repair system
export { ErrorClassifier } from './error-classifier';
export { CommandRunner } from './command-runner';
export { ErrorContextBuilder } from './error-context-builder';
export { SelfRepairAgent } from './self-repair-agent';
export { DependencyCache } from './dependency-cache';
export { DependencyValidator } from './dependency-validator';
export { PlaywrightContextManager, playwrightContextManager } from './playwright-context-manager';
