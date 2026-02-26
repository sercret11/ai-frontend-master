// 上下文压缩系统 - 基于 opencode-dev session/compaction.ts
import type { Message, Session, CompactionCheckpoint, CompactionResult, ContextMessage } from '../types/index.js';
import { Token } from '../utils/text/token.js';
import { Log } from '../logging/log.js';

const log = Log.create({ service: 'compaction' });

export class ContextCompactor {
  private compressionThreshold: number = 0.8;
  private minSavings: number = 20000;

  configure(config: { compressionThreshold?: number; minSavings?: number }): void {
    if (config.compressionThreshold !== undefined) {
      this.compressionThreshold = config.compressionThreshold;
    }
    if (config.minSavings !== undefined) {
      this.minSavings = config.minSavings;
    }
  }

  async shouldCompact(context: Session, maxTokensOverride?: number): Promise<boolean> {
    const { maxTokens, currentTokens } = this.getTokenCounts(context, maxTokensOverride);
    const threshold = maxTokens * this.compressionThreshold;

    return currentTokens > threshold;
  }

  async compact(context: Session): Promise<CompactionResult> {
    log.info('Starting context compaction', {
      sessionID: context.id,
      messageCount: context.messages.length,
    });

    const summary = await this.generateSummary(context);

    // 检查是否满足最小节省要求
    if (summary.savedTokens < this.minSavings) {
      log.debug('Compaction skipped: insufficient token savings', {
        savedTokens: summary.savedTokens,
        minSavings: this.minSavings,
      });

      const originalContent = context.messages.map(m => m.content).join('\n');

      return {
        compressed: false,
        originalContent,
        compressedContent: originalContent,
        checkpoint: {
          id: this.generateID(),
          timestamp: Date.now(),
          summary: '',
          topics: [],
          actionItems: [],
          technicalDecisions: [],
          messageCount: context.messages.length,
          savedTokens: 0,
          originalSize: context.messages.reduce((sum, m) => sum + (m.content?.length || 0), 0),
          compressedSize: 0,
          ratio: 0,
        },
        messages: context.messages,
        savedTokens: 0,
      };
    }

    const originalSize = context.messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);

    const checkpoint: CompactionCheckpoint = {
      id: this.generateID(),
      timestamp: Date.now(),
      summary: summary.text,
      topics: summary.topics,
      actionItems: summary.actionItems,
      technicalDecisions: summary.decisions,
      messageCount: context.messages.length,
      savedTokens: summary.savedTokens,
      originalSize,
      compressedSize: summary.text.length,
      ratio: summary.text.length / originalSize,
    };

    const compacted = context.messages.map(msg => ({
      ...msg,
      compacted: true,
      compactedAt: checkpoint.timestamp,
    }));

    const compactionMessage: Message = {
      id: this.generateID(),
      sessionID: context.id,
      role: 'system',
      content:
        '[Context Compaction - ' +
        new Date(checkpoint.timestamp).toLocaleString() +
        ']\n\n' +
        checkpoint.summary,
      createdAt: checkpoint.timestamp,
      timestamp: checkpoint.timestamp,
    };

    const messages = [compactionMessage, ...compacted];

    return {
      compressed: true,
      originalContent: context.messages.map(m => m.content).join('\n'),
      compressedContent: messages.map(m => m.content).join('\n'),
      checkpoint,
      messages,
      savedTokens: checkpoint.savedTokens,
    };
  }

  private async generateSummary(context: Session): Promise<any> {
    const userMessages = context.messages.filter(m => m.role === 'user');
    const assistantMessages = context.messages.filter(m => m.role === 'assistant');

    const topics = this.extractTopics(userMessages);
    const actionItems = this.extractActionItems(assistantMessages);
    const decisions = this.extractTechnicalDecisions(context.messages);

    const summary = this.formatSummary({
      topics,
      actionItems,
      decisions,
      messageCount: context.messages.length,
    });

    const originalTokens = this.countMessagesTokens(context.messages);
    const summaryTokens = Token.estimate(summary);
    const savedTokens = originalTokens - summaryTokens;

    return {
      text: summary,
      topics,
      actionItems,
      decisions,
      savedTokens,
    };
  }

  private extractTopics(messages: ContextMessage[]): string[] {
    const topics = new Set<string>();

    for (const msg of messages) {
      const techStack = msg.content.match(
        /(React|Vue|Angular|Next\.js|Nuxt|Svelte|TypeScript|JavaScript)/gi
      );
      if (techStack) {
        techStack.forEach(t => topics.add(t));
      }

      const platforms = msg.content.match(/(web|mobile|desktop|miniprogram)/gi);
      if (platforms) {
        platforms.forEach(p => topics.add(p.toLowerCase()));
      }
    }

    return Array.from(topics);
  }

  private extractActionItems(messages: ContextMessage[]): string[] {
    const actionItems: string[] = [];

    for (const msg of messages) {
      const codeBlocks = msg.content.match(/```[\s\S]*?```/g);
      if (codeBlocks) {
        actionItems.push('Generated ' + codeBlocks.length + ' code block(s)');
      }
    }

    return actionItems;
  }

  private extractTechnicalDecisions(messages: ContextMessage[]): string[] {
    const decisions: string[] = [];

    for (const msg of messages) {
      const matches = msg.content.match(/(?:决定|决策|选择|使用|采用)[:：]\s*([^\n]+)/gi);
      if (matches) {
        decisions.push(...matches.map(m => m.trim()));
      }
    }

    return decisions;
  }

  private formatSummary(data: any): string {
    const parts: string[] = [];

    parts.push('## 会话摘要');
    parts.push('- 总消息数: ' + data.messageCount);
    parts.push('- 主题: ' + (data.topics.join(', ') || '未识别'));

    if (data.actionItems.length > 0) {
      parts.push('\n## 已完成的任务');
      data.actionItems.slice(0, 10).forEach((item: string) => {
        parts.push('- ' + item);
      });
    }

    if (data.decisions.length > 0) {
      parts.push('\n## 技术决策');
      data.decisions.slice(0, 5).forEach((decision: string) => {
        parts.push('- ' + decision);
      });
    }

    return parts.join('\n');
  }

  private getTokenCounts(context: Session, maxTokensOverride?: number): any {
    const maxTokens =
      typeof maxTokensOverride === 'number' && Number.isFinite(maxTokensOverride) && maxTokensOverride > 0
        ? maxTokensOverride
        : context.config?.maxTokens || 180000;
    const currentTokens = this.countMessagesTokens(context.messages);

    return { maxTokens, currentTokens };
  }

  private countMessagesTokens(messages: ContextMessage[]): number {
    return messages.reduce((sum, msg) => sum + (msg.tokens || Token.estimate(msg.content)), 0);
  }

  private generateID(): string {
    return 'compact-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }
}
