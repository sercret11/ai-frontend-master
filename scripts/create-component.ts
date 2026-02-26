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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

// const __filename = fileURLToPath(import.meta.url)
// const dirnameValue = dirname(__filename)

interface ComponentConfig {
  name: string
  platforms: Platform[]
  directory: string
  propsType?: string
  description?: string
}

type Platform = 'web' | 'mobile' | 'miniprogram' | 'ios'

interface PropDefinition {
  name: string
  type: string
  required: boolean
  description?: string
  defaultValue?: string
}

/**
 * Parse command line arguments
 */
function parseArgs(): ComponentConfig {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error('Usage: tsx scripts/create-component.ts <ComponentName> [options]')
    console.error('')
    console.error('Options:')
    console.error('  --platforms <list>    Comma-separated platforms (web,mobile,miniprogram,ios)')
    console.error('  --dir <path>          Output directory (default: components)')
    console.error('  --props <Type>        Props type name from shared/types')
    console.error('  --desc <text>         Component description')
    console.error('')
    console.error('Examples:')
    console.error('  tsx scripts/create-component.ts Button')
    console.error('  tsx scripts/create-component.ts Card --platforms web,mobile')
    console.error('  tsx scripts/create-component.ts Modal --props ModalProps --dir components/ui')
    process.exit(1)
  }

  const componentName = args[0]!

  const config: ComponentConfig = {
    name: componentName,
    platforms: ['web', 'mobile', 'miniprogram', 'ios'],
    directory: 'components',
    propsType: undefined,
    description: undefined
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!

    if (arg === '--platforms' && args[i + 1]) {
      config.platforms = args[i + 1]!.split(',') as Platform[]
      i++
    } else if (arg === '--dir' && args[i + 1]) {
      config.directory = args[i + 1]!
      i++
    } else if (arg === '--props' && args[i + 1]) {
      config.propsType = args[i + 1]!
      i++
    } else if (arg === '--desc' && args[i + 1]) {
      config.description = args[i + 1]!
      i++
    }
  }

  return config
}

/**
 * Find shared/types directory
 */
function findTypesDir(): string | null {
  const possiblePaths = [
    join(process.cwd(), 'shared/types'),
    join(process.cwd(), 'types'),
    join(process.cwd(), 'src/types'),
    join(process.cwd(), 'src/shared/types')
  ]

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path
    }
  }

  return null
}

/**
 * Parse Props definition from TypeScript file
 */
function parsePropsDefinition(typesDir: string, typeName: string): PropDefinition[] {
  const propsFile = join(typesDir, `${typeName.toLowerCase()}.ts`)

  if (!existsSync(propsFile)) {
    console.warn(`⚠️  Props file not found: ${propsFile}`)
    console.warn(`   Using default props instead`)
    return getDefaultProps(typeName)
  }

  try {
    const content = readFileSync(propsFile, 'utf-8')

    // Simple parsing for interface/ type definitions
    // This is a basic implementation - a full parser would use TypeScript compiler API
    const props: PropDefinition[] = []

    // Match interface properties
    const interfaceRegex = /interface\s+\w+\s*{([^}]+)}/
    const match = content.match(interfaceRegex)

    if (match && match[1]) {
      const properties = match[1].split(';').filter(p => p.trim())

      properties.forEach(prop => {
        const trimmed = prop.trim()
        if (!trimmed) return

        const parts = trimmed.split(':')
        if (parts.length >= 2 && parts[0] !== undefined) {
          const name = parts[0].trim().replace('?', '')
          const typePart = parts[1] ?? ''
          const typePartTrimmed = typePart.trim()
          const typePartSplit = typePartTrimmed.split('=')
          const type = typePartSplit[0]?.trim() || 'any'
          const hasQuestionMark = prop.includes('?')
          const required = !hasQuestionMark

          if (name) {
            props.push({
              name,
              type,
              required,
              description: ''
            })
          }
        }
      })
    }

    return props.length > 0 ? props : getDefaultProps(typeName)
  } catch (error) {
    console.error(`[ERROR] Failed to parse props file: ${error}`)
    return getDefaultProps(typeName)
  }
}

/**
 * Get default props for a component
 */
function getDefaultProps(componentName: string): PropDefinition[] {
  const commonProps: PropDefinition[] = [
    { name: 'className', type: 'string', required: false, defaultValue: "''" },
    { name: 'style', type: 'React.CSSProperties', required: false, defaultValue: '{}' },
    { name: 'testID', type: 'string', required: false, defaultValue: "''" }
  ]

  const specificProps: Record<string, PropDefinition[]> = {
    Button: [
      { name: 'children', type: 'ReactNode', required: true },
      { name: 'variant', type: "'primary' | 'secondary' | 'outline'", required: false, defaultValue: "'primary'" },
      { name: 'size', type: "'sm' | 'md' | 'lg'", required: false, defaultValue: "'md'" },
      { name: 'disabled', type: 'boolean', required: false, defaultValue: 'false' },
      { name: 'onPress', type: '() => void', required: false },
      ...commonProps
    ],
    Card: [
      { name: 'children', type: 'ReactNode', required: true },
      { name: 'title', type: 'string', required: false },
      { name: 'subtitle', type: 'string', required: false },
      { name: 'elevation', type: 'number', required: false, defaultValue: '0' },
      ...commonProps
    ],
    Input: [
      { name: 'value', type: 'string', required: true },
      { name: 'onChange', type: '(value: string) => void', required: true },
      { name: 'placeholder', type: 'string', required: false },
      { name: 'error', type: 'string', required: false },
      { name: 'disabled', type: 'boolean', required: false, defaultValue: 'false' },
      ...commonProps
    ]
  }

  return specificProps[componentName] || commonProps
}

/**
 * Generate React component (Web/Desktop)
 */
function generateReactComponent(config: ComponentConfig, props: PropDefinition[]): string {
  const { name, description } = config
  const componentName = name
  const propsInterface = name + 'Props'

  // Generate props interface
  const propsInterfaceCode = `export interface ${propsInterface} {\n` +
    props.map(p =>
      `  ${p.name}${p.required ? '' : '?'}: ${p.type}${p.defaultValue ? ` // ${p.defaultValue}` : ''}`
    ).join('\n') +
    '\n}'

  // Generate component
  const componentCode = `import React from 'react'
${description ? `/**\n * ${description}\n */\n` : ''}${propsInterfaceCode}

export const ${componentName}: React.FC<${propsInterface}> = (${props.map(p => p.name).join(', ')}) => {
  return (
    <div className="${name.toLowerCase()}" testID={testID}>
      {/* TODO: Implement ${name} component */}
      {children && <>{children}</>}
    </div>
  )
}

export default ${componentName}
`

  return componentCode
}

/**
 * Generate React Native component (Mobile)
 */
function generateReactNativeComponent(config: ComponentConfig, props: PropDefinition[]): string {
  const { name, description } = config
  const componentName = name
  const propsInterface = name + 'Props'

  // Generate props interface
  const propsInterfaceCode = `export interface ${propsInterface} {\n` +
    props.map(p =>
      `  ${p.name}${p.required ? '' : '?'}: ${p.type}${p.defaultValue ? ` // ${p.defaultValue}` : ''}`
    ).join('\n') +
    '\n}'

  // Generate component
  const componentCode = `import React from 'react'
import { View, StyleSheet, ViewStyle } from 'react-native'
${description ? `/**\n * ${description}\n */\n` : ''}${propsInterfaceCode}

export const ${componentName}: React.FC<${propsInterface}> = (${props.map(p => p.name).join(', ')}) => {
  return (
    <View style={styles.container} testID={testID}>
      {/* TODO: Implement ${name} component */}
      {children && <>{children}</>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    // Add styles here
  } as ViewStyle
})

export default ${componentName}
`

  return componentCode
}

/**
 * Generate Vue component (Miniprogram)
 */
function generateVueComponent(config: ComponentConfig, props: PropDefinition[]): string {
  const { name, description } = config
  const componentName = name

  // Generate props
  const propsDefinition = props.map(p => {
    const optional = !p.required
    return `  ${p.name}: {
    type: ${getTypeScriptToVueType(p.type)},
    ${optional ? 'required: false,' : 'required: true,'}
    ${p.defaultValue ? `default: ${p.defaultValue}` : ''}
  }`
  }).join('\n')

  // Generate component
  const componentCode = `<template>
  <view class="${name.toLowerCase()}" :data-testid="testID">
    <!-- TODO: Implement ${name} component -->
    <slot v-if="$slots.default"></slot>
  </view>
</template>

${description ? `<!--\n  ${description}\n-->\n` : ''}<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: '${componentName}',
  props: {
${propsDefinition}
  },
  setup(props, { slots }) {
    return {}
  }
})
</script>

<style scoped>
.${name.toLowerCase()} {
  /* Add styles here */
}
</style>
`

  return componentCode
}

/**
 * Generate SwiftUI component (iOS)
 */
function generateSwiftUIComponent(config: ComponentConfig, props: PropDefinition[]): string {
  const { name, description } = config
  const componentName = name

  // Generate SwiftUI struct
  const propsCode = props.map(p => {
    const swiftType = getTypeScriptToSwiftType(p.type)
    const defaultValue = p.defaultValue ? ` = ${swiftType}(${p.defaultValue})` : ''
    return `    var ${p.name}: ${swiftType}${defaultValue}`
  }).join('\n')

  // Generate component
  const componentCode = `import SwiftUI
${description ? `/**\n * ${description}\n */\n` : ''}struct ${componentName}: View {
${propsCode}

    var body: some View {
        // TODO: Implement ${name} component
        Text("${name}")
            .accessibility(identifier: testID)
    }
}

#Preview {
    ${componentName}()
}
`

  return componentCode
}

/**
 * Convert TypeScript type to Vue type
 */
function getTypeScriptToVueType(tsType: string): string {
  const typeMap: Record<string, string> = {
    'string': 'String',
    'number': 'Number',
    'boolean': 'Boolean',
    'ReactNode': 'Object',
    'React.CSSProperties': 'Object',
    '() => void': 'Function'
  }

  // Handle array types
  if (tsType.includes('[]') || tsType.includes('Array<')) {
    return 'Array'
  }

  // Handle union types
  if (tsType.includes('|')) {
    return 'String' // Simplification
  }

  return typeMap[tsType] || 'Object'
}

/**
 * Convert TypeScript type to Swift type
 */
function getTypeScriptToSwiftType(tsType: string): string {
  const typeMap: Record<string, string> = {
    'string': 'String',
    'number': 'Double',
    'boolean': 'Bool',
    'ReactNode': 'AnyView',
    'React.CSSProperties': 'Any',
    '() => void': '(() -> Void)?'
  }

  // Handle array types
  if (tsType.includes('[]') || tsType.includes('Array<')) {
    return '[Any]'
  }

  // Handle union types
  if (tsType.includes('|')) {
    return 'String' // Simplification
  }

  return typeMap[tsType] || 'Any'
}

/**
 * Generate index.ts export file
 */
function generateIndexFile(componentName: string, platforms: Platform[]): string {
  const exports: string[] = []

  if (platforms.includes('web')) {
    exports.push(`export { default as ${componentName} } from './${componentName}.web'`)
  }
  if (platforms.includes('mobile')) {
    exports.push(`export { default as ${componentName}Mobile } from './${componentName}.mobile'`)
  }
  if (platforms.includes('miniprogram')) {
    exports.push(`export { default as ${componentName}Mini } from './${componentName}.mini.vue'`)
  }
  if (platforms.includes('ios')) {
    exports.push(`// SwiftUI component: ${componentName}.swift`)
  }

  return exports.join('\n') + '\n'
}

/**
 * Create directory if it doesn't exist
 */
function ensureDirectory(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Write component file
 */
function writeComponentFile(filePath: string, content: string): void {
  ensureDirectory(filePath)

  try {
    writeFileSync(filePath, content, 'utf-8')
    console.log(`[OK] Created: ${filePath}`)
  } catch (error) {
    console.error(`[ERROR] Failed to create ${filePath}: ${error}`)
  }
}

/**
 * Main generation function
 */
function generateComponent(config: ComponentConfig): void {
  console.log(`\n[INFO] Generating component: ${config.name}`)
  console.log(`   Platforms: ${config.platforms.join(', ')}`)
  console.log(`   Directory: ${config.directory}\n`)

  // Find types directory
  const typesDir = findTypesDir()
  if (typesDir) {
    console.log(`[OK] Found types directory: ${typesDir}`)
  } else {
    console.log(`[WARN] No types directory found, using default props`)
  }

  // Parse props
  const props = config.propsType && typesDir
    ? parsePropsDefinition(typesDir, config.propsType)
    : getDefaultProps(config.name)

  console.log(`[INFO] Props: ${props.length} properties\n`)

  // Generate components for each platform
  const baseDir = join(process.cwd(), config.directory)

  config.platforms.forEach(platform => {
    switch (platform) {
      case 'web':
        const webCode = generateReactComponent(config, props)
        writeComponentFile(join(baseDir, `${config.name}.web.tsx`), webCode)
        break

      case 'mobile':
        const mobileCode = generateReactNativeComponent(config, props)
        writeComponentFile(join(baseDir, `${config.name}.mobile.tsx`), mobileCode)
        break

      case 'miniprogram':
        const vueCode = generateVueComponent(config, props)
        writeComponentFile(join(baseDir, `${config.name}.mini.vue`), vueCode)
        break

      case 'ios':
        const swiftCode = generateSwiftUIComponent(config, props)
        writeComponentFile(join(baseDir, `${config.name}.swift`), swiftCode)
        break
    }
  })

  // Generate index.ts
  const indexCode = generateIndexFile(config.name, config.platforms)
  writeComponentFile(join(baseDir, 'index.ts'), indexCode)

  console.log(`\n[OK] Component generation complete!`)
  console.log(`\n[INFO] Next steps:`)
  console.log(`   1. Implement component logic in generated files`)
  console.log(`   2. Add styles and variations`)
  console.log(`   3. Write tests for each platform`)
  console.log(`   4. Update index.ts exports as needed`)
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const config = parseArgs()
    generateComponent(config)
  } catch (error) {
    console.error(`\n[ERROR] ${error}`)
    process.exit(1)
  }
}

export { generateComponent, ComponentConfig, Platform }
