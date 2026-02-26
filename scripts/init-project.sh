#!/bin/bash

################################################################################
# Project Initialization Script
#
# Creates a complete cross-platform project structure with:
# - Directory structure for all platforms
# - Package.json with dependencies
# - Configuration files (TypeScript, Tailwind, etc.)
# - Git repository initialization
# - Initial components and examples
#
# Usage:
#   bash scripts/init-project.sh [project-name] [options]
#
# Options:
#   --platforms <list>    Platforms to include (web,mobile,miniprogram,desktop)
#   --with-ui             Include shadcn/ui setup
#   --with-auth           Include authentication setup
#
# Examples:
#   bash scripts/init-project.sh my-app
#   bash scripts/init-project.sh my-app --platforms web,mobile --with-ui
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
PROJECT_NAME="${1:-my-cross-platform-app}"
PLATFORMS="web,mobile,miniprogram,desktop"
WITH_UI=false
WITH_AUTH=false

# Parse arguments
shift 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case $1 in
    --platforms)
      PLATFORMS="$2"
      shift 2
      ;;
    --with-ui)
      WITH_UI=true
      shift
      ;;
    --with-auth)
      WITH_AUTH=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Convert platforms to array
IFS=',' read -ra PLATFORM_ARRAY <<< "$PLATFORMS"

echo -e "${BLUE}+------------------------------------------------------------+${NC}"
echo -e "${BLUE}|       Cross-Platform Project Initialization               |${NC}"
echo -e "${BLUE}+------------------------------------------------------------+${NC}"
echo ""
echo -e "${GREEN}Project Name:${NC} $PROJECT_NAME"
echo -e "${GREEN}Platforms:${NC}    ${PLATFORM_ARRAY[*]}"
echo -e "${GREEN}Include UI:${NC}   $WITH_UI"
echo -e "${GREEN}Include Auth:${NC} $WITH_AUTH"
echo ""

################################################################################
# Helper Functions
################################################################################

print_step() {
  echo -e "\n${BLUE}> $1${NC}"
}

print_success() {
  echo -e "${GREEN}+ $1${NC}"
}

print_error() {
  echo -e "${RED}x $1${NC}"
}

create_directory() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    print_success "Created directory: $dir"
  fi
}

################################################################################
# Step 1: Create Project Directory
################################################################################

print_step "Creating project directory..."

PROJECT_DIR="$(pwd)/$PROJECT_NAME"

if [ -d "$PROJECT_DIR" ]; then
  print_error "Directory already exists: $PROJECT_DIR"
  exit 1
fi

create_directory "$PROJECT_DIR"
cd "$PROJECT_DIR"

################################################################################
# Step 2: Create Directory Structure
################################################################################

print_step "Creating directory structure..."

# Core directories
create_directory "shared/types"
create_directory "shared/constants"
create_directory "shared/utils"
create_directory "shared/hooks"
create_directory "shared/atomic/ui-web"
create_directory "shared/atomic/ui-mobile"
create_directory "shared/atomic/ui-miniprogram"
create_directory "shared/composables"
create_directory "shared/api"

# Platform-specific directories
if [[ " ${PLATFORM_ARRAY[*]} " =~ " web " ]]; then
  create_directory "web/app"
  create_directory "web/components"
  create_directory "web/pages"
  create_directory "web/public"
  create_directory "web/styles"
fi

if [[ " ${PLATFORM_ARRAY[*]} " =~ " mobile " ]]; then
  create_directory "mobile/src/components"
  create_directory "mobile/src/screens"
  create_directory "mobile/src/navigation"
  create_directory "mobile/android"
  create_directory "mobile/ios"
fi

if [[ " ${PLATFORM_ARRAY[*]} " =~ " miniprogram " ]]; then
  create_directory "miniprogram/pages"
  create_directory "miniprogram/components"
  create_directory "miniprogram/src"
fi

if [[ " ${PLATFORM_ARRAY[*]} " =~ " desktop " ]]; then
  create_directory "desktop/main"
  create_directory "desktop/renderer"
  create_directory "desktop/preload"
fi

# Additional directories
create_directory "scripts"
create_directory "tests"
create_directory "docs"
create_directory "assets"
create_directory ".github/workflows"

################################################################################
# Step 3: Create package.json
################################################################################

print_step "Creating package.json..."

cat > package.json << EOF
{
  "name": "$PROJECT_NAME",
  "version": "0.1.0",
  "private": true,
  "description": "Cross-platform application built with shared architecture",
  "workspaces": [
    "web",
    "mobile",
    "desktop",
    "miniprogram",
    "shared"
  ],
  "scripts": {
    "dev": "npm run dev:web",
    "dev:web": "npm run dev --workspace=web",
    "dev:mobile": "npm run dev --workspace=mobile",
    "dev:desktop": "npm run dev --workspace=desktop",
    "build": "npm run build --workspaces",
    "build:web": "npm run build --workspace=web",
    "build:mobile": "npm run build --workspace=mobile",
    "build:desktop": "npm run build --workspace=desktop",
    "lint": "eslint . --ext .ts,.tsx,.js,.jsx",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md}\"",
    "type-check": "tsc --noEmit",
    "test": "jest",
    "clean": "rm -rf node_modules **/node_modules **/dist **/.next"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.50.0",
    "eslint-config-prettier": "^9.0.0",
    "eslint-plugin-react": "^7.33.0",
    "prettier": "^3.0.0",
    "typescript": "^5.2.0",
    "tsx": "^4.0.0"
  },
  "engines": {
    "node": ">=18.0.0",
    "npm": ">=9.0.0"
  }
}
EOF

print_success "Created package.json"

################################################################################
# Step 4: Create TypeScript Configuration
################################################################################

print_step "Creating TypeScript configuration..."

cat > tsconfig.json << EOF
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowJs": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["shared/*"],
      "@web/*": ["web/*"],
      "@mobile/*": ["mobile/*"],
      "@desktop/*": ["desktop/*"],
      "@miniprogram/*": ["miniprogram/*"]
    }
  },
  "exclude": ["node_modules", "dist", "build", ".next"]
}
EOF

print_success "Created tsconfig.json"

################################################################################
# Step 5: Create Shared Types
################################################################################

print_step "Creating shared types..."

cat > shared/types/index.ts << EOF
/**
 * Shared type definitions for all platforms
 */

// Common UI types
export interface BaseProps {
  className?: string
  testID?: string
}

export interface ButtonProps extends BaseProps {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  onPress?: () => void
  children: React.ReactNode
}

export interface InputProps extends BaseProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'email' | 'password' | 'number'
  error?: string
  disabled?: boolean
}

export interface CardProps extends BaseProps {
  title?: string
  subtitle?: string
  children: React.ReactNode
  elevation?: number
}

// API types
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}

export interface User {
  id: string
  email: string
  name: string
  avatar?: string
  createdAt: string
  updatedAt: string
}

// Navigation types
export interface Route {
  path: string
  component: React.ComponentType
  title?: string
  icon?: string
}

export interface Tab {
  id: string
  title: string
  icon: string
  screen: React.ComponentType
}
EOF

print_success "Created shared/types/index.ts"

################################################################################
# Step 6: Create Configuration Files
################################################################################

print_step "Creating configuration files..."

# ESLint configuration
cat > .eslintrc.js << EOF
module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2020: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
}
EOF

# Prettier configuration
cat > .prettierrc << EOF
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
EOF

# .gitignore
cat > .gitignore << EOF
# Dependencies
node_modules/
.pnp
.pnp.js

# Build outputs
dist/
build/
.next/
out/
*.log

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Testing
coverage/

# Misc
.cache/
.temp/
EOF

print_success "Created configuration files"

################################################################################
# Step 7: Setup UI Framework (optional)
################################################################################

if [ "$WITH_UI" = true ]; then
  print_step "Setting up shadcn/ui..."

  cat > components.json << EOF
{
  "\$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "web/styles/globals.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
EOF

  print_success "Created components.json for shadcn/ui"
fi

################################################################################
# Step 8: Create Initial Components
################################################################################

print_step "Creating initial components..."

# Web Button component
if [[ " ${PLATFORM_ARRAY[*]} " =~ " web " ]]; then
  cat > web/components/Button.tsx << EOF
import React from 'react'
import { ButtonProps } from '@shared/types'

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  onPress,
  children,
  className = '',
  testID = 'button',
}) => {
  const baseStyles = 'rounded-lg font-medium transition-colors disabled:opacity-50'
  const variantStyles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',
    outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50',
    ghost: 'text-blue-600 hover:bg-blue-50',
  }
  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  }

  return (
    <button
      className={\`\${baseStyles} \${variantStyles[variant]} \${sizeStyles[size]} \${className}\`}
      disabled={disabled || loading}
      onClick={onPress}
      data-testid={testID}
    >
      {loading ? 'Loading...' : children}
    </button>
  )
}

export default Button
EOF

  print_success "Created web/components/Button.tsx"
fi

# Mobile Button component
if [[ " ${PLATFORM_ARRAY[*]} " =~ " mobile " ]]; then
  cat > mobile/src/components/Button.tsx << EOF
import React from 'react'
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { ButtonProps } from '@shared/types'

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  onPress,
  children,
  testID = 'button',
}) => {
  const getVariantStyle = () => {
    switch (variant) {
      case 'primary':
        return styles.primary
      case 'secondary':
        return styles.secondary
      case 'outline':
        return styles.outline
      default:
        return styles.primary
    }
  }

  const getSizeStyle = () => {
    switch (size) {
      case 'sm':
        return styles.small
      case 'lg':
        return styles.large
      default:
        return styles.medium
    }
  }

  return (
    <TouchableOpacity
      style={[styles.button, getVariantStyle(), getSizeStyle(), disabled && styles.disabled]}
      disabled={disabled || loading}
      onPress={onPress}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.text}>{typeof children === 'string' ? children : 'Button'}</Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#2563eb',
  },
  secondary: {
    backgroundColor: '#e5e7eb',
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#2563eb',
  },
  small: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  medium: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  large: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    color: '#fff',
    fontWeight: '600',
  },
})

export default Button
EOF

  print_success "Created mobile/src/components/Button.tsx"
fi

################################################################################
# Step 9: Setup Git Repository
################################################################################

print_step "Setting up Git repository..."

git init > /dev/null 2>&1 && print_success "Initialized Git repository"

# Create initial commit
git add . > /dev/null 2>&1
git commit -m "Initial commit: Cross-platform project setup" > /dev/null 2>&1
print_success "Created initial commit"

################################################################################
# Step 10: Create Documentation
################################################################################

print_step "Creating documentation..."

cat > README.md << EOF
# $PROJECT_NAME

Cross-platform application built with shared architecture.

## Platforms

EOF

for platform in "${PLATFORM_ARRAY[@]}"; do
  echo "- $platform" >> README.md
done

cat >> README.md << EOF

## Getting Started

### Installation

\`\`\`bash
npm install
\`\`\`

### Development

\`\`\`bash
# Start all platforms
npm run dev

# Start specific platform
npm run dev:web    # Web application
npm run dev:mobile # Mobile application
npm run dev:desktop # Desktop application
\`\`\`

### Building

\`\`\`bash
npm run build
\`\`\`

## Project Structure

\`\`\`
.
|-- shared/              # Shared code across all platforms
|   |-- types/           # TypeScript type definitions
|   |-- constants/       # Shared constants
|   |-- utils/           # Utility functions
|   |-- hooks/           # React hooks
|   |-- atomic/          # Atomic UI components
|   |-- composables/     # Vue composables
|   `-- api/             # API clients
|-- web/                 # Web application (Next.js/React)
|-- mobile/              # Mobile application (React Native)
|-- desktop/             # Desktop application (Electron/Tauri)
|-- miniprogram/         # Miniprogram (Taro/Vue)
|-- scripts/             # Build and utility scripts
|-- tests/               # Test files
`-- docs/                # Documentation
\`\`\`

## Scripts

- \`npm run dev\` - Start development server
- \`npm run build\` - Build for production
- \`npm run lint\` - Run linter
- \`npm run format\` - Format code
- \`npm run test\` - Run tests

## License

MIT
EOF

print_success "Created README.md"

cat > docs/ARCHITECTURE.md << EOF
# Architecture Documentation

## Overview

This project uses a shared architecture pattern where common code is placed in the \`shared/\` directory and platform-specific code lives in their respective directories.

## Shared Layer

The shared layer contains:

- **Types**: TypeScript definitions used across all platforms
- **Constants**: Shared configuration and constants
- **Utils**: Common utility functions
- **Hooks**: React hooks (shared by web, mobile, desktop)
- **Composables**: Vue composables (shared by miniprogram)
- **Atomic UI**: Platform-specific UI components with shared interfaces
- **API**: API clients and data fetching logic

## Platform Layers

Each platform has its own directory with platform-specific code:

- **web**: React/Next.js application
- **mobile**: React Native application
- **desktop**: Electron/Tauri application
- **miniprogram**: Taro/Vue miniprogram

## Component Architecture

Components follow the atomic design pattern:

1. **Atomic**: Smallest reusable components (Button, Input, etc.)
2. **Molecular**: Combinations of atomic components
3. **Organism**: Complex UI sections

Each platform has its own implementation of atomic components, but they share the same Props interfaces from \`shared/types\`.

## Data Flow

1. API calls are made from \`shared/api/\`
2. Data flows to components through hooks/composables
3. UI components render based on shared types
4. User interactions trigger updates through shared handlers

## Best Practices

1. Keep platform-specific code out of shared/
2. Use TypeScript for all shared code
3. Write tests for shared utilities
4. Document complex logic in comments
5. Follow naming conventions consistently
EOF

print_success "Created docs/ARCHITECTURE.md"

################################################################################
# Step 11: Installation Instructions
################################################################################

echo ""
echo -e "${BLUE}+------------------------------------------------------------+${NC}"
echo -e "${BLUE}|                      Setup Complete!                      |${NC}"
echo -e "${BLUE}+------------------------------------------------------------+${NC}"
echo ""
echo -e "${GREEN}Project created at:${NC} $PROJECT_DIR"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo -e "  1. ${BLUE}cd $PROJECT_NAME${NC}"
echo -e "  2. ${BLUE}npm install${NC}    # Install dependencies"
echo -e "  3. ${BLUE}npm run dev${NC}    # Start development server"
echo ""
echo -e "${YELLOW}Available Commands:${NC}"
echo -e "  ${BLUE}npm run dev:web${NC}     - Start web development"
echo -e "  ${BLUE}npm run dev:mobile${NC}  - Start mobile development"
echo -e "  ${BLUE}npm run dev:desktop${NC} - Start desktop development"
echo -e "  ${BLUE}npm run build${NC}       - Build all platforms"
echo -e "  ${BLUE}npm run lint${NC}        - Run linter"
echo -e "  ${BLUE}npm run test${NC}        - Run tests"
echo ""
echo -e "${GREEN}Happy coding!${NC}"
echo ""
