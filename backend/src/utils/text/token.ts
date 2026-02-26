/**
 * Token Estimation Utility
 *
 * Provides simple token estimation for text content
 */

export namespace Token {
  /**
   * Estimate token count for text
   * Approximation: 1 token ~= 4 characters (for English)
   * For Chinese, 1 token ~= 1.5 characters
   */
  export function estimate(input: string): number {
    if (!input) return 0;

    const text = String(input);

    // Count Chinese characters
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;

    // Count non-Chinese characters
    const nonChineseChars = text.length - chineseChars;

    // Chinese: ~1.5 chars per token, English: ~4 chars per token
    return Math.ceil(chineseChars / 1.5 + nonChineseChars / 4);
  }

  /**
   * Precisely calculate token count (if AI model returns token count)
   */
  export function exactCount(input: string, modelTokens?: number): number {
    if (!input) return 0;
    if (modelTokens !== undefined) return modelTokens;
    return estimate(input);
  }

  /**
   * Count tokens in array of messages
   */
  export function countMessages(messages: Array<{
    content?: string;
    tokens?: number;
  }>): number {
    return messages.reduce((sum, msg) => {
      if (msg.tokens) return sum + msg.tokens;
      if (msg.content) return sum + estimate(msg.content);
      return sum;
    }, 0);
  }

  /**
   * Calculate context window usage rate
   */
  export function getContextUsage(
    messages: Array<{
      content?: string;
      tokens?: number;
    }>,
    maxTokens: number = 128000
  ): {
    used: number;
    remaining: number;
    percentage: number;
  } {
    const used = countMessages(messages);
    const remaining = Math.max(0, maxTokens - used);
    const percentage = maxTokens > 0 ? (used / maxTokens) * 100 : 0;

    return { used, remaining, percentage };
  }
}
