/**
 * Dependency Validator - 主动依赖检测器
 *
 * 通过扫描代码中的 import 语句与 package.json 对比，
 * 主动发现缺失的依赖，而不是等待编译失败。
 */

import { promises as fs } from 'fs';
import path from 'path';
import { glob } from 'glob';
import type { StoredFile } from '@ai-frontend/shared-types';

/**
 * Built-in Node.js modules that don't need installation
 */
const BUILTIN_MODULES = new Set([
  'fs', 'fs/promises', 'path', 'os', 'http', 'https', 'events', 'stream', 'util',
  'child_process', 'crypto', 'buffer', 'querystring', 'url', 'net',
  'tls', 'dns', 'zlib', 'cluster', 'readline', 'vm', 'assert', 'timers',
  'console', 'process', 'module', 'util/types', 'worker_threads',
  // Note: 'react' is NOT a built-in module, it needs to be installed
]);

/**
 * Scan result from dependency validation
 */
export interface ScanResult {
  /** Missing packages (dependencies) */
  missingPackages: string[];
  /** Missing dev packages (devDependencies) */
  missingDevPackages: string[];
  /** All imports found in code */
  allImports: string[];
  /** Installed dependencies from package.json */
  installedDependencies: string[];
  /** Installed devDependencies from package.json */
  installedDevDependencies: string[];
  /** Files scanned */
  filesScanned: number;
}

/**
 * Package.json structure
 */
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Common packages that are typically devDependencies
 */
const DEV_DEPENDENCY_HINTS = new Set([
  'tailwindcss', 'postcss', 'autoprefixer',
  'typescript', '@types/', 'eslint', 'prettier',
  'vitest', 'jest', '@testing-library/', 'cypress',
  'sass', 'less', 'stylus',
  'vite', 'webpack', 'rollup', 'esbuild',
  '@babel/', 'babel',
]);

/**
 * DependencyValidator namespace
 */
export namespace DependencyValidator {
  /**
   * Normalize import path to npm package name.
   *
   * Examples:
   * - react-dom/client -> react-dom
   * - @scope/pkg/sub/path -> @scope/pkg
   */
  export function normalizeImportPackage(importPath: string): string {
    if (!importPath || importPath.startsWith('.') || importPath.startsWith('/')) {
      return importPath;
    }

    if (importPath.startsWith('@')) {
      const [scope, pkg] = importPath.split('/');
      if (scope && pkg) {
        return `${scope}/${pkg}`;
      }
      return importPath;
    }

    return importPath.split('/')[0] || importPath;
  }

  /**
   * Scan all files for imports and detect missing dependencies
   */
  export async function scanImports(sessionID: string): Promise<ScanResult> {
    console.log(`[DependencyValidator] Starting dependency scan for session ${sessionID}`);

    // Import FileStorage dynamically to avoid circular dependencies
    const { FileStorage } = await import('../storage/file-storage');
    const files = FileStorage.getAllFiles(sessionID);

    // Only scan code files
    const codeFiles = files.filter(f =>
      f.path.endsWith('.ts') ||
      f.path.endsWith('.tsx') ||
      f.path.endsWith('.js') ||
      f.path.endsWith('.jsx')
    );

    console.log(`[DependencyValidator] Scanning ${codeFiles.length} code files`);

    // Extract all imports
    const allImports = new Set<string>();
    for (const file of codeFiles) {
      const imports = extractImportsFromFile(file.content);
      imports.forEach(imp => allImports.add(imp));
    }

    console.log(`[DependencyValidator] Found ${allImports.size} unique imports`);

    // Read package.json
    const packageJson = await readPackageJson(sessionID, files);
    const installedDeps = Object.keys(packageJson.dependencies || {});
    const installedDevDeps = Object.keys(packageJson.devDependencies || {});
    const allInstalled = new Set([...installedDeps, ...installedDevDeps]);

    // Detect missing dependencies
    const missingPackageSet = new Set<string>();
    const missingDevPackageSet = new Set<string>();

    for (const imp of allImports) {
      const packageName = normalizeImportPackage(imp);

      // Skip built-in modules
      if (BUILTIN_MODULES.has(packageName)) {
        continue;
      }

      // Skip relative imports
      if (packageName.startsWith('.') || packageName.startsWith('/')) {
        continue;
      }

      // Skip if already installed
      if (allInstalled.has(packageName)) {
        continue;
      }

      // Check if it's likely a dev dependency
      if (isLikelyDevDependency(packageName)) {
        missingDevPackageSet.add(packageName);
      } else {
        missingPackageSet.add(packageName);
      }
    }

    const missingPackages = Array.from(missingPackageSet);
    const missingDevPackages = Array.from(missingDevPackageSet);

    console.log(`[DependencyValidator] Scan complete:
  - ${allImports.size} unique imports
  - ${installedDeps.length} dependencies
  - ${installedDevDeps.length} devDependencies
  - ${missingPackages.length} missing dependencies
  - ${missingDevPackages.length} missing devDependencies`);

    if (missingPackages.length > 0) {
      console.log(`[DependencyValidator] ❌ Missing dependencies: ${missingPackages.join(', ')}`);
    }
    if (missingDevPackages.length > 0) {
      console.log(`[DependencyValidator] ❌ Missing devDependencies: ${missingDevPackages.join(', ')}`);
    }

    return {
      missingPackages,
      missingDevPackages,
      allImports: Array.from(allImports),
      installedDependencies: installedDeps,
      installedDevDependencies: installedDevDeps,
      filesScanned: codeFiles.length,
    };
  }

  /**
   * Extract import statements from a single file
   */
  export function extractImportsFromFile(content: string): string[] {
    const imports: string[] = [];

    // Pattern 1: import ... from 'package'
    // Matches: import React from 'react', import { Button } from '@mui/material'
    const importFromRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importFromRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Pattern 2: import 'package' (side-effect imports)
    // Matches: import 'react', import './styles.css'
    const importRegex = /import\s+['"]([^'"]+)['"]/g;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Pattern 3: require('package')
    // Matches: const fs = require('fs'), const { exec } = require('child_process')
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Pattern 4: dynamic import()
    // Matches: import('lodash'), await import('module')
    const dynamicImportRegex = /import\(['"]([^'"]+)['"]\)/g;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  /**
   * Read package.json from session files
   */
  async function readPackageJson(sessionID: string, files?: StoredFile[]): Promise<PackageJson> {
    let fileList = files;

    if (!fileList) {
      const { FileStorage } = await import('../storage/file-storage');
      fileList = FileStorage.getAllFiles(sessionID);
    }

    const packageJsonFile = fileList?.find(f => f.path === 'package.json');

    if (!packageJsonFile) {
      console.warn(`[DependencyValidator] No package.json found for session ${sessionID}`);
      return { dependencies: {}, devDependencies: {} };
    }

    try {
      return JSON.parse(packageJsonFile.content);
    } catch (error) {
      console.error(`[DependencyValidator] Failed to parse package.json:`, error);
      return { dependencies: {}, devDependencies: {} };
    }
  }

  /**
   * Check if a package is likely a dev dependency
   */
  function isLikelyDevDependency(packageName: string): boolean {
    // Check against known dev dependency hints
    for (const hint of DEV_DEPENDENCY_HINTS) {
      if (packageName === hint || packageName.startsWith(hint)) {
        return true;
      }
    }

    // Common pattern: @types/* packages are always dev dependencies
    if (packageName.startsWith('@types/')) {
      return true;
    }

    return false;
  }

  /**
   * Get installed dependencies from package.json
   */
  export async function getInstalledDependencies(sessionID: string): Promise<{
    dependencies: string[];
    devDependencies: string[];
  }> {
    const packageJson = await readPackageJson(sessionID);

    return {
      dependencies: Object.keys(packageJson.dependencies || {}),
      devDependencies: Object.keys(packageJson.devDependencies || {}),
    };
  }

  /**
   * Validate a single package (check if it's installed)
   */
  export async function validatePackage(
    sessionID: string,
    packageName: string
  ): Promise<{
    installed: boolean;
    isDevDependency: boolean;
  }> {
    const { dependencies, devDependencies } = await getInstalledDependencies(sessionID);

    const inDeps = dependencies.includes(packageName);
    const inDevDeps = devDependencies.includes(packageName);

    return {
      installed: inDeps || inDevDeps,
      isDevDependency: inDevDeps,
    };
  }
}
