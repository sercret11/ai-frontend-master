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
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
/**
 * Platform signatures based on dependencies
 */
const PLATFORM_SIGNATURES = {
    web: {
        dependencies: ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'remix'],
        configs: ['next.config.', 'nuxt.config.', 'vite.config.', 'webpack.config.'],
        dirs: ['public', 'src']
    },
    desktop: {
        dependencies: ['electron', 'tauri', '@tauri-apps'],
        configs: ['electron-builder.', 'tauri.conf.'],
        dirs: ['src-tauri', 'electron']
    },
    mobile: {
        dependencies: ['react-native', '@react-navigation', 'expo', '@expo/vector-icons'],
        configs: ['app.json', 'expo.json', 'react-native.config.'],
        dirs: ['android', 'ios', 'src-tauri']
    },
    miniprogram: {
        dependencies: ['@tarojs/taro', '@tarojs/runtime'],
        configs: ['project.config.json', 'app.json', 'pages.json'],
        dirs: ['miniprogram', 'src/pages']
    }
};
/**
 * Read and parse package.json
 */
function readPackageJson(root) {
    const packagePath = join(root, 'package.json');
    if (!existsSync(packagePath)) {
        return null;
    }
    try {
        const content = readFileSync(packagePath, 'utf-8');
        return JSON.parse(content);
    }
    catch (error) {
        console.error(`Failed to parse package.json: ${error}`);
        return null;
    }
}
/**
 * Get all dependencies from package.json
 */
function getDependencies(packageJson) {
    if (!packageJson)
        return [];
    const deps = [];
    const allDeps = [
        ...Object.keys(packageJson.dependencies || {}),
        ...Object.keys(packageJson.devDependencies || {}),
        ...Object.keys(packageJson.peerDependencies || {})
    ];
    return allDeps;
}
/**
 * Detect platform from dependencies
 */
function detectFromDependencies(dependencies) {
    const platformScores = new Map();
    dependencies.forEach(dep => {
        const lowerDep = dep.toLowerCase();
        for (const [platform, signature] of Object.entries(PLATFORM_SIGNATURES)) {
            for (const keyword of signature.dependencies) {
                if (lowerDep.includes(keyword.toLowerCase())) {
                    const currentScore = platformScores.get(platform) || 0;
                    platformScores.set(platform, currentScore + 1);
                }
            }
        }
    });
    return platformScores;
}
/**
 * Detect platform from configuration files
 */
function detectFromConfigFiles(root) {
    const platformScores = new Map();
    for (const [platform, signature] of Object.entries(PLATFORM_SIGNATURES)) {
        for (const configPattern of signature.configs) {
            const files = readdirSync(root).filter((file) => file.toLowerCase().startsWith(configPattern.replace('.', '')));
            if (files.length > 0) {
                const currentScore = platformScores.get(platform) || 0;
                platformScores.set(platform, currentScore + 2);
            }
        }
    }
    return platformScores;
}
/**
 * Detect platform from directory structure
 */
function detectFromDirectories(root) {
    const platformScores = new Map();
    if (!existsSync(root)) {
        return platformScores;
    }
    const items = readdirSync(root);
    for (const [platform, signature] of Object.entries(PLATFORM_SIGNATURES)) {
        for (const dir of signature.dirs) {
            if (items.includes(dir)) {
                const dirPath = join(root, dir);
                try {
                    if (statSync(dirPath).isDirectory()) {
                        const currentScore = platformScores.get(platform) || 0;
                        platformScores.set(platform, currentScore + 3);
                    }
                }
                catch (error) {
                    // Ignore permission errors
                }
            }
        }
    }
    return platformScores;
}
/**
 * Detect framework from dependencies
 */
function detectFramework(dependencies) {
    const frameworkMap = {
        'next': 'Next.js',
        'nuxt': 'Nuxt.js',
        'remix': 'Remix',
        'react': 'React',
        'vue': 'Vue',
        'angular': 'Angular',
        'svelte': 'Svelte',
        'react-native': 'React Native',
        'expo': 'Expo',
        '@tarojs/taro': 'Taro',
        'electron': 'Electron',
        'tauri': 'Tauri'
    };
    for (const [dep, framework] of Object.entries(frameworkMap)) {
        if (dependencies.some(d => d.toLowerCase().includes(dep))) {
            return framework;
        }
    }
    return 'Unknown';
}
/**
 * Get file pattern recommendations for a platform
 */
function getFilePatterns(platform) {
    const patterns = {
        web: [
            'components/**/*.tsx',
            'pages/**/*.tsx',
            'app/**/*.tsx',
            'src/**/*.{ts,tsx,js,jsx}'
        ],
        desktop: [
            'main/**/*.{ts,js}',
            'preload/**/*.{ts,js}',
            'renderer/**/*.{tsx,jsx}'
        ],
        mobile: [
            'components/**/*.tsx',
            'screens/**/*.tsx',
            'navigation/**/*.{ts,tsx}',
            'android/**/*.{java,kt}',
            'ios/**/*.{swift,m}'
        ],
        miniprogram: [
            'pages/**/*.wxml',
            'components/**/*.wxml',
            'src/**/*.vue',
            'src/**/*.tsx'
        ]
    };
    return patterns[platform] || [];
}
/**
 * Get recommendations for a platform
 */
function getRecommendations(platform, framework) {
    const recommendations = {
        web: [
            `Use Web-specific components in shared/types for Props definitions`,
            `Install shadcn/ui for ${framework}: npx shadcn-ui@latest init`,
            `Configure Tailwind CSS for consistent styling`,
            `Set up responsive design with mobile-first approach`
        ],
        desktop: [
            `Use desktop-specific APIs (electron/tauri) in feature-specific directories`,
            `Implement secure IPC communication between main and renderer`,
            `Package for Windows, macOS, and Linux`,
            `Test on target platforms early in development`
        ],
        mobile: [
            `Use React Native specific components in shared/atomic/ui-mobile`,
            `Implement safe area handling for notched devices`,
            `Test on both iOS and Android emulators`,
            `Use Expo Development Client for faster iteration`
        ],
        miniprogram: [
            `Use Taro cross-platform components in shared/atomic/ui-miniprogram`,
            `Follow platform-specific size and performance guidelines`,
            `Test on WeChat DevTools for miniprogram`,
            `Implement platform-specific APIs (WeChat, Alipay, etc.)`
        ]
    };
    return recommendations[platform] || [];
}
/**
 * Main detection function
 */
function detectPlatform(root = process.cwd()) {
    console.log(`🔍 Detecting platform in: ${root}\n`);
    // Read package.json
    const packageJson = readPackageJson(root);
    const dependencies = getDependencies(packageJson);
    console.log('📦 Dependencies found:');
    if (dependencies.length === 0) {
        console.log('  No package.json found or no dependencies');
    }
    else {
        dependencies.forEach(dep => console.log(`  - ${dep}`));
    }
    console.log();
    // Detect from multiple sources
    const depScores = detectFromDependencies(dependencies);
    const configScores = detectFromConfigFiles(root);
    const dirScores = detectFromDirectories(root);
    // Combine scores
    const combinedScores = new Map();
    [depScores, configScores, dirScores].forEach(scores => {
        scores.forEach((score, platform) => {
            combinedScores.set(platform, (combinedScores.get(platform) || 0) + score);
        });
    });
    // Detect framework
    const framework = detectFramework(dependencies);
    // Build platform info
    const detectedPlatforms = [];
    combinedScores.forEach((score, platform) => {
        if (score > 0) {
            const maxScore = 10; // Maximum possible score
            const confidence = Math.min(score / maxScore, 1);
            detectedPlatforms.push({
                platform,
                confidence: Math.round(confidence * 100),
                framework,
                filePatterns: getFilePatterns(platform),
                recommendations: getRecommendations(platform, framework)
            });
        }
    });
    // Sort by confidence
    detectedPlatforms.sort((a, b) => b.confidence - a.confidence);
    // Get config files and directories
    const configFiles = [];
    const directories = [];
    try {
        const items = readdirSync(root);
        items.forEach(item => {
            const itemPath = join(root, item);
            try {
                const stat = statSync(itemPath);
                if (stat.isFile() && (item.includes('config') || item.includes('.json'))) {
                    configFiles.push(item);
                }
                else if (stat.isDirectory()) {
                    directories.push(item);
                }
            }
            catch (error) {
                // Ignore permission errors
            }
        });
    }
    catch (error) {
        console.error(`Failed to read directory: ${error}`);
    }
    return {
        detectedPlatforms,
        packageJson: {
            dependencies: packageJson?.dependencies ? Object.keys(packageJson.dependencies) : [],
            devDependencies: packageJson?.devDependencies ? Object.keys(packageJson.devDependencies) : []
        },
        configFiles,
        directories
    };
}
/**
 * Format and display results
 */
function displayResults(result) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🎯 PLATFORM DETECTION RESULTS');
    console.log('═══════════════════════════════════════════════════════════════\n');
    if (result.detectedPlatforms.length === 0) {
        console.log('❌ No platform detected');
        console.log('   Make sure you\'re running this script in a project directory');
        console.log('   with package.json and/or configuration files.\n');
        return;
    }
    result.detectedPlatforms.forEach((info, index) => {
        console.log(`${index + 1}. ${info.platform.toUpperCase()} PLATFORM`);
        console.log(`   Confidence: ${info.confidence}%`);
        console.log(`   Framework: ${info.framework}`);
        console.log();
    });
    console.log('───────────────────────────────────────────────────────────────\n');
    // Show detailed info for top platform
    const topPlatform = result.detectedPlatforms[0];
    console.log(`📋 Recommended File Patterns for ${topPlatform.platform.toUpperCase()}:`);
    topPlatform.filePatterns.forEach(pattern => {
        console.log(`   - ${pattern}`);
    });
    console.log();
    console.log('💡 Recommendations:');
    topPlatform.recommendations.forEach(rec => {
        console.log(`   • ${rec}`);
    });
    console.log();
    // Show config files
    if (result.configFiles.length > 0) {
        console.log('⚙️  Configuration Files Found:');
        result.configFiles.forEach(file => {
            console.log(`   - ${file}`);
        });
        console.log();
    }
    // Show directories
    if (result.directories.length > 0) {
        console.log('📁 Directories Found:');
        result.directories.forEach(dir => {
            console.log(`   - ${dir}/`);
        });
        console.log();
    }
    console.log('═══════════════════════════════════════════════════════════════');
}
// Main execution
if (require.main === module) {
    const root = process.argv[2] || process.cwd();
    const result = detectPlatform(root);
    displayResults(result);
}
export { detectPlatform };
//# sourceMappingURL=detect-platform.js.map