#!/usr/bin/env node
// 增强的上下文工程 CLI 工具
import { Command } from 'commander'
import { EnhancedContextManager } from '../src/context/enhanced-manager.js'
import { Log } from '../src/logging/log.js'
import * as fs from 'fs/promises'
import * as path from 'path'

const log = Log.create({ service: 'cli' })

const program = new Command()

program
  .name('ai-frontend-context')
  .description('AI Frontend Context Engineering CLI')
  .version('2.0.0')

// 初始化上下文管理器
function createManager() {
  const sectionsDir = path.resolve(process.cwd(), 'sections')
  const skillsDir = path.resolve(process.cwd(), 'skills')
  
  return new EnhancedContextManager({
    sectionsDir,
    skillsDir,
    mode: 'lazy',
    enableCache: true,
    cacheConfig: {
      maxSections: 50,
      maxContents: 100,
      maxSkills: 50,
      ttl: 1000 * 60 * 5
    }
  })
}

// 构建上下文命令
program
  .command('build')
  .description('构建优化的上下文')
  .option('-i, --input <text>', '用户输入')
  .option('-m, --mode <mode>', '生成模式 (creator|implementer)', 'creator')
  .option('-p, --platform <platform>', '目标平台', 'web')
  .option('-t, --tech-stack <stack>', '技术栈 (逗号分隔)', 'react,nextjs')
  .option('-s, --session <id>', '会话 ID', 'default')
  .option('--max-tokens <number>', '最大 token 数', '180000')
  .action(async (options) => {
    log.info('Building context', options)
    
    const manager = createManager()
    const techStack = options.techStack.split(',')
    
    const context = await manager.buildContext({
      sessionID: options.session,
      userInput: options.input || '',
      mode: options.mode,
      techStack,
      platform: options.platform,
      maxTokens: parseInt(options.maxTokens)
    })
    
    console.log('\n📊 上下文构建完成\n')
    console.log('Token 使用:')
    console.log('  系统提示词: ' + context.tokens.system + ' tokens')
    console.log('  Sections: ' + context.tokens.sections + ' tokens')
    console.log('  技能: ' + context.tokens.skills + ' tokens')
    console.log('  消息: ' + context.tokens.messages + ' tokens')
    console.log('  ─────────────────')
    console.log('  总计: ' + context.tokens.total + ' tokens\n')
    
    console.log('元数据:')
    console.log('  压缩: ' + (context.metadata.compressed ? '是' : '否'))
    console.log('  剪枝: ' + (context.metadata.pruned ? '是' : '否'))
    console.log('  构建时间: ' + context.metadata.buildTime + 'ms\n')
    
    console.log('已选择的 Sections (' + context.sections.length + '):')
    context.sections.forEach((section: any) => {
      console.log('  - ' + section.name + ' (' + section.tokens + ' tokens)')
    })
    
    console.log('\n已注入的技能 (' + context.skills.length + '):')
    context.skills.forEach((skill: string) => {
      const firstLine = skill.split('\n')[0]
      const preview = firstLine ? firstLine.substring(0, 50) + '...' : '(empty)'
      console.log('  - ' + preview)
    })
  })

// 显示性能统计
program
  .command('stats')
  .description('显示性能统计')
  .action(async () => {
    const manager = createManager()
    const stats = manager.getPerformanceStats()
    
    console.log('\n📈 性能统计\n')
    console.log('构建次数: ' + stats.buildCount)
    console.log('平均构建时间: ' + Math.round(stats.avgBuildTime) + 'ms')
    console.log('缓存命中率: ' + (stats.cacheHitRate * 100).toFixed(1) + '%')
    console.log('缓存大小: ' + stats.cacheSize.total + ' 项')
    console.log('活跃会话: ' + stats.sessions + '\n')
  })

// 清除缓存
program
  .command('clear-cache')
  .description('清除所有缓存')
  .action(async () => {
    const manager = createManager()
    manager.clearCache()
    console.log('✅ 所有缓存已清除\n')
  })

// 验证配置
program
  .command('validate')
  .description('验证项目配置')
  .action(async () => {
    console.log('\n🔍 验证项目配置\n')
    
    const errors: string[] = []
    const warnings: string[] = []
    
    // 检查 prompt-docs 索引
    const promptDocsDir = path.resolve(process.cwd(), 'prompt-docs')
    const indexPath = path.resolve(promptDocsDir, 'index.yaml')
    try {
      await fs.access(indexPath)
      const indexRaw = await fs.readFile(indexPath, 'utf-8')
      const sectionCount = (indexRaw.match(/"id":/g) || []).length
      console.log('✅ prompt-docs/index.yaml: ' + sectionCount + ' 个 sections')

      if (sectionCount === 0) {
        warnings.push('prompt-docs/index.yaml 未包含任何 section')
      }
    } catch {
      errors.push('prompt-docs/index.yaml 不存在')
    }
    
    // 检查 skills 目录
    const skillsDir = path.resolve(process.cwd(), 'skills')
    try {
      await fs.access(skillsDir)
      const files = await fs.readdir(skillsDir)
      const skillFiles = files.filter(f => f.endsWith('.md'))
      console.log('✅ Skills 目录: ' + skillFiles.length + ' 个文件')
    } catch {
      warnings.push('skills 目录不存在 (可选)')
    }
    
    // 检查系统提示词
    const systemPromptPath = path.resolve(promptDocsDir, 'system', 'core-system.md')
    try {
      await fs.access(systemPromptPath)
      const content = await fs.readFile(systemPromptPath, 'utf-8')
      console.log('✅ prompt-docs/system/core-system.md: ' + content.length + ' 字符')
    } catch {
      errors.push('prompt-docs/system/core-system.md 不存在')
    }
    
    // 检查配置文件
    const configPath = path.resolve(process.cwd(), 'ai-frontend.jsonc')
    try {
      await fs.access(configPath)
      console.log('✅ ai-frontend.jsonc 存在')
    } catch {
      warnings.push('ai-frontend.jsonc 不存在 (可选)')
    }
    
    if (errors.length > 0) {
      console.log('\n❌ 错误:')
      errors.forEach(e => console.log('  ' + e))
    }
    
    if (warnings.length > 0) {
      console.log('\n⚠️  警告:')
      warnings.forEach(w => console.log('  ' + w))
    }
    
    if (errors.length === 0) {
      console.log('\n✅ 配置验证通过\n')
    } else {
      console.log('\n❌ 配置验证失败\n')
      process.exit(1)
    }
  })

// 显示帮助
program
  .command('help')
  .description('显示帮助信息')
  .action(() => {
    program.outputHelp()
  })

// 解析命令行参数
program.parseAsync(process.argv)
  .catch(err => {
    log.error('Command failed', { error: err.message })
    process.exit(1)
  })
