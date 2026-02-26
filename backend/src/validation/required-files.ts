/**
 * Required file definitions for different project templates
 */

import type { FileRequirementSet, ProjectTemplate, RequiredFile } from '@ai-frontend/shared-types';

/**
 * Next.js 14 App Router required files
 */
const nextJsRequiredFiles: RequiredFile[] = [
  {
    path: 'package.json',
    critical: true,
    description: 'Project dependencies and scripts configuration',
  },
  {
    path: 'tsconfig.json',
    critical: true,
    description: 'TypeScript configuration',
  },
  {
    path: 'next.config.js',
    critical: false,
    description: 'Next.js framework configuration',
  },
  {
    path: 'app/layout.tsx',
    critical: true,
    description: 'Root layout component (required for Next.js App Router)',
    template: 'root-layout',
  },
  {
    path: 'app/page.tsx',
    critical: true,
    description: 'Home page component (entry point)',
    template: 'home-page',
  },
  {
    path: 'tailwind.config.ts',
    critical: false,
    description: 'Tailwind CSS configuration',
  },
  {
    path: 'postcss.config.js',
    critical: false,
    description: 'PostCSS configuration for Tailwind',
  },
  {
    path: 'app/globals.css',
    critical: true,
    description: 'Global styles (imported by layout.tsx)',
    template: 'globals-css',
  },
];

/**
 * React + Vite required files
 */
const reactViteRequiredFiles: RequiredFile[] = [
  {
    path: 'package.json',
    critical: true,
    description: 'Project dependencies and scripts configuration',
  },
  {
    path: 'tsconfig.json',
    critical: true,
    description: 'TypeScript configuration',
  },
  {
    path: 'vite.config.ts',
    critical: true,
    description: 'Vite build configuration',
  },
  {
    path: 'index.html',
    critical: true,
    description: 'HTML entry point',
    template: 'index-html',
  },
  {
    path: 'src/main.tsx',
    critical: true,
    description: 'React application entry point',
    template: 'main-tsx',
  },
  {
    path: 'src/App.tsx',
    critical: true,
    description: 'Root App component',
    template: 'app-tsx',
  },
  {
    path: 'src/index.css',
    critical: true,
    description: 'Global styles (imported by main.tsx)',
    template: 'index-css',
  },
];

/**
 * React Native required files
 */
const reactNativeRequiredFiles: RequiredFile[] = [
  {
    path: 'package.json',
    critical: true,
    description: 'Project dependencies and scripts configuration',
  },
  {
    path: 'tsconfig.json',
    critical: true,
    description: 'TypeScript configuration',
  },
  {
    path: 'App.tsx',
    critical: true,
    description: 'Root application component',
    template: 'app-rn',
  },
];

/**
 * UniApp required files
 */
const uniappRequiredFiles: RequiredFile[] = [
  {
    path: 'package.json',
    critical: true,
    description: 'Project dependencies and scripts configuration',
  },
  {
    path: 'pages.json',
    critical: true,
    description: 'UniApp page routing configuration',
  },
  {
    path: 'pages/index/index.vue',
    critical: true,
    description: 'Home page component',
    template: 'uniapp-home',
  },
  {
    path: 'App.vue',
    critical: true,
    description: 'Root application component',
    template: 'uniapp-app',
  },
];

/**
 * File requirement sets by template
 */
export const FILE_REQUIREMENTS: Record<ProjectTemplate, FileRequirementSet> = {
  'next-js': {
    template: 'next-js',
    requiredFiles: nextJsRequiredFiles,
  },
  'react-vite': {
    template: 'react-vite',
    requiredFiles: reactViteRequiredFiles,
  },
  'react-native': {
    template: 'react-native',
    requiredFiles: reactNativeRequiredFiles,
  },
  'uniapp': {
    template: 'uniapp',
    requiredFiles: uniappRequiredFiles,
  },
};

export const SUPPORTED_PROJECT_TEMPLATES = Object.keys(FILE_REQUIREMENTS) as ProjectTemplate[];

export function isSupportedProjectTemplate(template: string): template is ProjectTemplate {
  return SUPPORTED_PROJECT_TEMPLATES.includes(template as ProjectTemplate);
}

/**
 * Get required files for a template
 */
export function getRequiredFiles(template: string): RequiredFile[] {
  if (!isSupportedProjectTemplate(template)) {
    return [];
  }
  const requirements = FILE_REQUIREMENTS[template];
  return requirements?.requiredFiles || [];
}

/**
 * Get file requirement set for a template
 */
export function getFileRequirementSet(template: string): FileRequirementSet | undefined {
  if (!isSupportedProjectTemplate(template)) {
    return undefined;
  }
  return FILE_REQUIREMENTS[template];
}

/**
 * Check if a file path matches a required file pattern
 */
export function matchesRequiredFile(filePath: string, requiredFile: RequiredFile): boolean {
  // Exact match
  if (filePath === requiredFile.path) {
    return true;
  }

  // Suffix match (handles cases like 'my-app/app/layout.tsx')
  if (filePath.endsWith(requiredFile.path)) {
    return true;
  }

  return false;
}
