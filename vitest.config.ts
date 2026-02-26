// Vitest 配置

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 全局变量
    globals: true,

    // 测试环境
    environment: 'node',

    // 设置超时时间
    testTimeout: 10000,

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],

      // 覆盖率目标
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,

      // 排除目录
      exclude: [
        'node_modules/',
        'dist/',
        'frontend/dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types/**',
        '**/constants.ts',
        '**/utils/logger.ts'
      ]
    },

    // 包含的测试文件模式
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'backend/src/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.{ts,tsx}'
    ],

    // 排除的测试文件
    exclude: ['node_modules/', 'dist/', 'frontend/']
  }
})
