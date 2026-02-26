#!/usr/bin/env tsx
/**
 * Component Generator Script
 *
 * Generates cross-platform components from shared type definitions:
 * - Reads Props definitions from shared/types
 * - Generates React components (Web/Desktop)
 * - Generates React Native components (Mobile)
 * - Generates Vue components (Miniprogram)
 * - Generates SwiftUI components (iOS)
 *
 * Usage:
 *   tsx scripts/create-component.ts ComponentName
 *   tsx scripts/create-component.ts Button --platforms web,mobile
 *   tsx scripts/create-component.ts Card --dir components/ui
 */
interface ComponentConfig {
    name: string;
    platforms: Platform[];
    directory: string;
    propsType?: string;
    description?: string;
}
type Platform = 'web' | 'mobile' | 'miniprogram' | 'ios';
/**
 * Main generation function
 */
declare function generateComponent(config: ComponentConfig): void;
export { generateComponent, ComponentConfig, Platform };
//# sourceMappingURL=create-component.d.ts.map