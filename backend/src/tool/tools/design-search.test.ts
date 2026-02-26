import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildSearchDocument,
  DEFAULT_SEARCH_SCORE_WEIGHTS,
  DesignSearchTool,
  detectDomainFromQuery,
  inferDomain,
  parseCsv,
  resolveSearchScoreWeights,
  scoreDocument,
} from './design-search';

describe('design search internals', () => {
  it('parses csv with quoted comma, newline and escaped quotes', () => {
    const rows = parseCsv('\uFEFFname,description\n"Bento, Grid","line1\nline2 ""quoted"""');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(['name', 'description']);
    expect(rows[1][0]).toBe('Bento, Grid');
    expect(rows[1][1]).toBe('line1\nline2 "quoted"');
  });

  it('supports configurable score weights and fallback behavior', () => {
    const weights = resolveSearchScoreWeights({
      UI_UX_SEARCH_WEIGHT_EXACT_QUERY: '20',
      UI_UX_SEARCH_WEIGHT_TOKEN_TEXT: '1.5',
      UI_UX_SEARCH_WEIGHT_TOKEN_TITLE: '-1',
      UI_UX_SEARCH_WEIGHT_TOKEN_KEYWORDS: 'abc',
      UI_UX_SEARCH_WEIGHT_HYPHEN: '0',
    });

    expect(weights.exactQuery).toBe(20);
    expect(weights.tokenInText).toBe(1.5);
    expect(weights.tokenInTitle).toBe(DEFAULT_SEARCH_SCORE_WEIGHTS.tokenInTitle);
    expect(weights.tokenInKeywords).toBe(DEFAULT_SEARCH_SCORE_WEIGHTS.tokenInKeywords);
    expect(weights.hyphenBoost).toBe(0);
  });

  it('changes ranking when weights are tuned', () => {
    const headers = ['style category', 'keywords', 'description'];
    const query = 'bento dashboard';
    const titleHeavyDoc = buildSearchDocument(
      'style',
      'styles.csv',
      headers,
      ['Dashboard Bento', 'bento,dashboard', 'Card layout'],
      2
    );
    const exactPhraseDoc = buildSearchDocument(
      'style',
      'styles.csv',
      headers,
      ['Simple', 'minimal', 'This layout uses bento dashboard for metrics'],
      3
    );

    const defaultTitleHeavy = scoreDocument(query, titleHeavyDoc);
    const defaultExactPhrase = scoreDocument(query, exactPhraseDoc);
    expect(defaultExactPhrase).toBeGreaterThan(defaultTitleHeavy);

    const customWeights = {
      exactQuery: 0,
      tokenInText: 1,
      tokenInTitle: 6,
      tokenInKeywords: 5,
      hyphenBoost: 0,
    };
    const customTitleHeavy = scoreDocument(query, titleHeavyDoc, customWeights);
    const customExactPhrase = scoreDocument(query, exactPhraseDoc, customWeights);
    expect(customTitleHeavy).toBeGreaterThan(customExactPhrase);
  });

  it('infers domain from file path and query keywords', () => {
    expect(inferDomain('colors.csv')).toBe('color');
    expect(inferDomain('stacks/ux-guidelines.csv')).toBe('ux');
    expect(inferDomain('misc/unknown.csv')).toBe('style');

    expect(detectDomainFromQuery('Need a high-contrast palette')).toBe('color');
    expect(detectDomainFromQuery('Typography scale for mobile')).toBe('typography');
    expect(detectDomainFromQuery('General style direction')).toBe('style');
  });
});

describe('design search execute', () => {
  it('reads csv from UI_UX_DATA_PATH and returns matches', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'design-search-'));
    const csvPath = path.join(tmpDir, 'styles.csv');
    const previousDataPath = process.env.UI_UX_DATA_PATH;

    try {
      const csvContent = [
        'style category,keywords,description',
        '"Bento Box Grid","bento dashboard cards","Works for dashboard tiles"',
        '"Editorial","magazine,story","Long-form storytelling layout"',
      ].join('\n');
      await fs.writeFile(csvPath, csvContent, 'utf-8');
      process.env.UI_UX_DATA_PATH = tmpDir;

      const tool = await DesignSearchTool.init();
      const result = await tool.execute(
        { query: 'bento dashboard', domain: 'style', maxResults: 1 },
        createTestContext()
      );

      expect(result.output).toContain('Bento Box Grid');
      expect(result.output).toContain('styles.csv:2');
      expect(result.output).toContain('Score Weights');
    } finally {
      if (previousDataPath === undefined) {
        delete process.env.UI_UX_DATA_PATH;
      } else {
        process.env.UI_UX_DATA_PATH = previousDataPath;
      }
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

function createTestContext() {
  return {
    sessionID: 'test-session',
    messageID: 'test-message',
    agent: 'test-agent',
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  };
}
