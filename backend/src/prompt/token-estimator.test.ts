import { describe, expect, it } from 'vitest';
import { estimateTokenBreakdown, estimateTokenCount } from './token-estimator';

describe('token estimator', () => {
  it('counts non-empty text', () => {
    expect(estimateTokenCount('hello world')).toBeGreaterThan(0);
  });

  it('handles CJK and English mixed content', () => {
    const english = estimateTokenBreakdown('Build dashboard with React and TypeScript');
    const mixed = estimateTokenBreakdown('使用 React 和 TypeScript 构建 dashboard 页面');

    expect(mixed.estimatedTokens).toBeGreaterThan(english.estimatedTokens * 0.6);
    expect(mixed.cjkChars).toBeGreaterThan(0);
    expect(mixed.latinWords).toBeGreaterThan(0);
  });
});

