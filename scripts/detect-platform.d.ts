#!/usr/bin/env tsx
/**
 * Platform Detection Script
 *
 * Detects the platform type (Web, Desktop, Mobile, Miniprogram) by analyzing:
 * - package.json dependencies
 * - Configuration files (next.config.js, pages.json, etc.)
 * - Directory structure (android/, ios/, etc.)
 *
 * Usage:
 *   tsx scripts/detect-platform.ts
 *   or
 *   node --loader tsx scripts/detect-platform.ts
 */
interface PlatformInfo {
    platform: string;
    confidence: number;
    framework: string;
    filePatterns: string[];
    recommendations: string[];
}
interface DetectionResult {
    detectedPlatforms: PlatformInfo[];
    packageJson: {
        dependencies: string[];
        devDependencies: string[];
    };
    configFiles: string[];
    directories: string[];
}
/**
 * Main detection function
 */
declare function detectPlatform(root?: string): DetectionResult;
export { detectPlatform, PlatformInfo, DetectionResult };
//# sourceMappingURL=detect-platform.d.ts.map