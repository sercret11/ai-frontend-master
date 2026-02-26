/**
 * Lightweight token estimation tuned for mixed Chinese/English/code content.
 */

const CJK_CHAR_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const LATIN_WORD_REGEX = /[A-Za-z0-9][A-Za-z0-9+.#/_-]*/g;
const CODE_SYMBOL_REGEX = /[{}()[\];=<>:+\-*/.,]/g;

export interface TokenEstimateBreakdown {
  cjkChars: number;
  latinWords: number;
  symbols: number;
  estimatedTokens: number;
}

export function estimateTokenCount(content: string): number {
  if (!content.trim()) return 0;

  const cjkChars = content.match(CJK_CHAR_REGEX)?.length || 0;
  const latinWords = content.match(LATIN_WORD_REGEX)?.length || 0;
  const symbols = content.match(CODE_SYMBOL_REGEX)?.length || 0;

  const estimated = Math.ceil(cjkChars * 1.2 + latinWords * 1.25 + symbols * 0.15);
  return Math.max(1, estimated);
}

export function estimateTokenBreakdown(content: string): TokenEstimateBreakdown {
  const cjkChars = content.match(CJK_CHAR_REGEX)?.length || 0;
  const latinWords = content.match(LATIN_WORD_REGEX)?.length || 0;
  const symbols = content.match(CODE_SYMBOL_REGEX)?.length || 0;
  const estimatedTokens = estimateTokenCount(content);
  return {
    cjkChars,
    latinWords,
    symbols,
    estimatedTokens,
  };
}

