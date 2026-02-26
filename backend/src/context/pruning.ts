// 上下文剪枝系统 - 基于 opencode-dev
import type { Message, Session, PrunedContext, PruningConfig, ContextMessage } from '../types/index.js';
import { Token } from '../utils/text/token.js';
import { Log } from '../logging/log.js';
import { extractFileSignature } from './ast-extractor.js';

const log = Log.create({ service: 'pruning' });

export class ContextPruner {
  private config: PruningConfig = {
    protectWindow: 40000,
    minSavings: 20000,
    protectedTools: ['skill', 'lsp'],
  };

  /**
   * 执行上下文剪枝（改进：保留结构化信息）
   */
  async prune(context: Session): Promise<PrunedContext> {
    const messages = [...context.messages];
    let savedTokens = 0;
    let prunedCount = 0;

    log.debug('Starting context pruning', {
      sessionID: context.id,
      messageCount: messages.length,
      protectWindow: this.config.protectWindow,
    });

    // 从旧到新扫描
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;

      // 跳过系统消息
      if (msg.role === 'system') continue;

      // 跳过保护窗口内的消息
      if (this.isInProtectedWindow(msg, context, i)) {
        continue;
      }

      // 工具输出剪枝 - check if msg has tool property
      const hasToolCall = msg.parts?.some(p => p.type === 'tool-call');
      const toolCall = msg.parts?.find(p => p.type === 'tool-call');
      const isProtectedTool = toolCall && this.isProtectedTool(toolCall.tool);

      if (hasToolCall && !isProtectedTool) {
        const originalTokens = Token.estimate(msg.content);

        // 改进：保留结构化信息而不仅仅是文本
        const truncatedContent = this.createStructuredTruncation(msg, originalTokens);

        messages[i] = {
          ...msg,
          content: truncatedContent,
          truncated: true,
          truncatedAt: Date.now(),
          // 保留原始 token 计数以便恢复
          originalTokenCount: originalTokens,
        } as any;

        savedTokens += originalTokens - Token.estimate(truncatedContent);
        prunedCount++;
      }
    }

    // 检查是否达到最小节省
    const minSavings = this.config.minSavings || 1000;
    if (savedTokens < minSavings) {
      log.debug('Pruning aborted: insufficient savings', {
        savedTokens,
        minSavings,
      });

      return {
        content: '',
        removed: [],
        kept: [],
        stats: {
          originalTokens: 0,
          prunedTokens: 0,
          savedTokens: 0,
        },
        messages: context.messages,
        savedTokens: 0,
        prunedCount: 0,
      };
    }

    log.info('Context pruning complete', {
      savedTokens,
      prunedCount,
      newMessageCount: messages.length,
    });

    return {
      content: '',
      removed: [],
      kept: [],
      stats: {
        originalTokens: 0,
        prunedTokens: savedTokens,
        savedTokens,
      },
      messages,
      savedTokens,
      prunedCount,
    };
  }

  /**
   * 创建结构化的截断内容（改进版）
   */
  private createStructuredTruncation(msg: ContextMessage, originalTokens: number): string {
    // 提取关键信息
    const parts: string[] = [];

    // 1. 添加摘要信息
    parts.push(`[工具输出已压缩以节省上下文: ${originalTokens} tokens → ~50 tokens]`);

    // 2. 保留关键元数据
    if (msg.parts) {
      const toolCalls = msg.parts.filter(p => p.type === 'tool-call');
      if (toolCalls.length > 0) {
        parts.push(`调用工具: ${toolCalls.map(t => (t as any).tool).join(', ')}`);
      }
    }

    // 3. 保留错误信息（如果有）
    if (
      msg.content.toLowerCase().includes('error') ||
      msg.content.toLowerCase().includes('failed')
    ) {
      const errorLines = msg.content
        .split('\n')
        .filter(
          line => line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')
        )
        .slice(0, 3); // 最多保留 3 行错误信息
      if (errorLines.length > 0) {
        parts.push('错误摘要:');
        parts.push(...errorLines);
      }
    }

    // 4. 保留文件路径（如果有）
    const filePaths = msg.content.match(/[\w-]+\.[\w]+/g);
    if (filePaths && filePaths.length > 0) {
      const uniquePaths = [...new Set(filePaths)].slice(0, 5); // 最多 5 个路径
      if (uniquePaths.length > 0) {
        parts.push(`涉及文件: ${uniquePaths.join(', ')}`);
      }
    }

    // 5. 添加哈希以便验证
    const codeBlockRegex = /```(\w+)?(?:\s+([^\s\n]+))?\n([\s\S]*?)\n```/g;
    let codeBlockMatch: RegExpExecArray | null;
    const astSummaries: string[] = [];
    let blockCount = 0;
    while ((codeBlockMatch = codeBlockRegex.exec(msg.content)) !== null && blockCount < 3) {
      blockCount += 1;
      const lang = (codeBlockMatch[1] || '').toLowerCase();
      const pathHint = codeBlockMatch[2] || `snippet-${blockCount}.ts`;
      const sourceText = codeBlockMatch[3] || '';

      const isCodeCandidate =
        ['ts', 'tsx', 'js', 'jsx', 'typescript', 'javascript'].includes(lang) ||
        /\.(ts|tsx|js|jsx)$/.test(pathHint);
      if (!isCodeCandidate || sourceText.trim().length === 0) {
        continue;
      }

      const digest = extractFileSignature(pathHint, sourceText);
      const chunks: string[] = [];
      if (digest.exports.length > 0) {
        chunks.push(`exports=${digest.exports.slice(0, 8).join(',')}`);
      }
      if (digest.functionSignatures.length > 0) {
        chunks.push(`signatures=${digest.functionSignatures.slice(0, 6).join(',')}`);
      }
      if (digest.interfaceNames.length > 0) {
        chunks.push(`interfaces=${digest.interfaceNames.slice(0, 6).join(',')}`);
      }
      if (digest.mockStructures.length > 0) {
        chunks.push(
          `mockShapes=${digest.mockStructures
            .slice(0, 3)
            .map(item => `${item.name}(${item.keys.slice(0, 6).join('|')})`)
            .join(',')}`
        );
      }
      if (digest.comments.length > 0) {
        chunks.push(
          `comments=${digest.comments
            .slice(0, 3)
            .map(item => item.replace(/\s+/g, ' ').trim())
            .join(' | ')}`
        );
      }
      if (digest.degraded) {
        chunks.push('degraded=true');
      }
      if (chunks.length > 0) {
        astSummaries.push(`${pathHint}: ${chunks.join('; ')}`);
      }
    }
    if (astSummaries.length > 0) {
      parts.push('AST摘要:');
      parts.push(...astSummaries);
    }

    const hash = this.simpleHash(msg.content);
    parts.push(`(内容哈希: ${hash})`);

    return parts.join('\n');
  }

  /**
   * 简单哈希函数用于内容验证
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * 检查消息是否在保护窗口内
   */
  private isInProtectedWindow(_msg: ContextMessage, context: Session, currentIndex: number): boolean {
    let accumulated = 0;

    // 从最新消息向后累加 tokens
    const protectWindow = this.config.protectWindow || 1000;
    for (let i = context.messages.length - 1; i >= currentIndex; i--) {
      const message = context.messages[i];
      if (message) {
        accumulated += Token.estimate(message.content);
      }
      if (accumulated >= protectWindow) {
        return false;
      }
    }

    return true;
  }

  /**
   * 检查工具是否受保护
   */
  private isProtectedTool(toolName?: string): boolean {
    if (!toolName) return false;
    const protectedTools = this.config.protectedTools || [];
    return protectedTools.includes(toolName);
  }

  /**
   * 配置剪枝策略
   */
  configure(config: Partial<PruningConfig>): void {
    this.config = { ...this.config, ...config };

    log.info('Pruning configuration updated', this.config);
  }

  /**
   * 获取当前配置
   */
  getConfig(): PruningConfig {
    return { ...this.config };
  }
}
