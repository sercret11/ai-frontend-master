/**
 * FrontendMaster AI v2.0 - Enhanced BM25 Search Engine
 *
 * BM25 ranking algorithm for intelligent resource matching
 * Supports design styles, color palettes, typography recommendations
 *
 * Usage:
 *   import { BM25Search } from './bm25-search'
 *   const search = new BM25Search()
 *   const results = search.searchStyles("minimalist clean design")
 */

interface Document {
  id: string;
  content: string;
  metadata: Record<string, any>;
}

interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, any>;
  rank: number;
}

interface BM25Options {
  k1?: number;  // Term frequency saturation parameter (default: 1.5)
  b?: number;   // Length normalization parameter (default: 0.75)
}

// ============ BM25 SEARCH ENGINE ============
class BM25Search {
  private k1: number;
  private b: number;
  private documents: Document[] = [];
  private corpus: string[][] = [];
  private docLengths: number[] = [];
  private avgDocLength: number = 0;
  private idf: Map<string, number> = new Map();
  private docFreqs: Map<string, number> = new Map();
  private N: number = 0;

  constructor(options: BM25Options = {}) {
    this.k1 = options.k1 ?? 1.5;
    this.b = options.b ?? 0.75;
  }

  /**
   * Tokenize text for search
   * - Converts to lowercase
   * - Removes punctuation
   * - Filters short words
   */
  private tokenize(text: string): string[] {
    // Remove punctuation, convert to lowercase
    const cleaned = text.toLowerCase().replace(/[^\w\s-]/g, ' ');
    // Split and filter short words
    return cleaned.split(/\s+/).filter(word => word.length > 2);
  }

  /**
   * Build search index from documents
   */
  index(documents: Document[]): void {
    this.documents = documents;
    this.corpus = documents.map(doc => this.tokenize(doc.content));
    this.N = this.corpus.length;

    if (this.N === 0) {
      return;
    }

    // Calculate document lengths
    this.docLengths = this.corpus.map(tokens => tokens.length);
    this.avgDocLength = this.docLengths.reduce((a, b) => a + b, 0) / this.N;

    // Calculate document frequencies
    for (const doc of this.corpus) {
      const seen = new Set<string>();
      for (const word of doc) {
        if (!seen.has(word)) {
          this.docFreqs.set(word, (this.docFreqs.get(word) || 0) + 1);
          seen.add(word);
        }
      }
    }

    // Calculate IDF for each term
    for (const [term, freq] of this.docFreqs.entries()) {
      const idf = Math.log((this.N - freq + 0.5) / (freq + 0.5)) + 1;
      this.idf.set(term, idf);
    }
  }

  /**
   * Score all documents against query
   */
  score(query: string): Array<{ index: number; score: number }> {
    const queryTokens = this.tokenize(query);
    const scores: Array<{ index: number; score: number }> = [];

    for (let idx = 0; idx < this.N; idx++) {
      let score = 0;
      const doc = this.corpus[idx];
      const docLen = this.docLengths[idx];

      // Skip if document or length is undefined
      if (!doc || docLen === undefined) {
        continue;
      }

      // Calculate term frequencies for this document
      const termFreqs = new Map<string, number>();
      for (const word of doc) {
        termFreqs.set(word, (termFreqs.get(word) || 0) + 1);
      }

      // Calculate BM25 score
      for (const token of queryTokens) {
        const idf = this.idf.get(token);
        if (idf) {
          const tf = termFreqs.get(token) || 0;
          const numerator = tf * (this.k1 + 1);
          const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));
          score += idf * (numerator / denominator);
        }
      }

      scores.push({ index: idx, score });
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Search and return ranked results
   */
  search(query: string, maxResults: number = 10): SearchResult[] {
    const scores = this.score(query);

    return scores
      .filter(result => result.score > 0)
      .slice(0, maxResults)
      .map((result, rank) => ({
        id: this.documents[result.index]?.id || `doc_${result.index}`,
        score: Math.round(result.score * 100) / 100,
        metadata: this.documents[result.index]?.metadata || {},
        rank: rank + 1
      }));
  }
}

// ============ DESIGN STYLE SEARCHER ============
class DesignStyleSearcher {
  private bm25: BM25Search;
  private styles: any[] = [];

  constructor(private dataDir: string) {
    this.bm25 = new BM25Search();
  }

  /**
   * Load design styles from JSON file
   */
  async loadStyles(): Promise<void> {
    const fs = require('fs').promises;
    const path = require('path');

    const stylesFile = path.join(this.dataDir, 'design-styles.json');

    try {
      const data = JSON.parse(await fs.readFile(stylesFile, 'utf-8'));
      this.styles = data.styles || [];
    } catch (error) {
      console.error('Error loading design styles:', error);
      this.styles = [];
    }
  }

  /**
   * Search design styles
   */
  searchStyles(query: string, maxResults: number = 3): Array<{
    style: any;
    score: number;
    confidence: number;
  }> {
    if (this.styles.length === 0) {
      return [];
    }

    // Build documents for BM25
    const documents: Document[] = this.styles.map((style: any, index: number) => ({
      id: style.id || `style_${index}`,
      content: [
        style.name || '',
        style.category || '',
        style.characteristics?.join(' ') || '',
        style.useCases?.join(' ') || ''
      ].join(' '),
      metadata: style
    }));

    // Index and search
    this.bm25.index(documents);
    const results = this.bm25.search(query, maxResults);

    return results.map(result => ({
      style: result.metadata,
      score: result.score,
      confidence: Math.min(0.95, 0.5 + result.score)
    }));
  }
}

// ============ COLOR PALETTE SEARCHER ============
class ColorPaletteSearcher {
  private bm25: BM25Search;
  private palettes: any[] = [];

  constructor(private dataDir: string) {
    this.bm25 = new BM25Search();
  }

  /**
   * Load color palettes from JSON file
   */
  async loadPalettes(): Promise<void> {
    const fs = require('fs').promises;
    const path = require('path');

    const palettesFile = path.join(this.dataDir, 'color-palettes.json');

    try {
      const data = JSON.parse(await fs.readFile(palettesFile, 'utf-8'));
      this.palettes = data.palettes || [];
    } catch (error) {
      console.error('Error loading color palettes:', error);
      this.palettes = [];
    }
  }

  /**
   * Search color palettes by product type or query
   */
  searchPalettes(query: string, productType?: string, maxResults: number = 3): Array<{
    palette: any;
    score: number;
    confidence: number;
  }> {
    if (this.palettes.length === 0) {
      return [];
    }

    // Filter by product type if specified
    let filteredPalettes = this.palettes;
    if (productType) {
      const categoryMap: Record<string, string> = {
        'SaaS': 'saas',
        'E-commerce': 'ecommerce',
        'Finance': 'finance',
        'Healthcare': 'healthcare',
        'Education': 'edtech',
        'Social': 'social',
        'Media': 'entertainment',
        'Tools': 'saas'
      };
      const category = categoryMap[productType] || 'saas';
      filteredPalettes = this.palettes.filter((p: any) => p.category === category);
    }

    // Build documents for BM25
    const documents: Document[] = filteredPalettes.map((palette: any, index: number) => ({
      id: palette.id || `palette_${index}`,
      content: [
        palette.name || '',
        palette.category || '',
        palette.notes || ''
      ].join(' '),
      metadata: palette
    }));

    // Index and search
    this.bm25.index(documents);
    const results = this.bm25.search(query, maxResults);

    return results.map(result => ({
      palette: result.metadata,
      score: result.score,
      confidence: Math.min(0.90, 0.6 + result.score)
    }));
  }
}

// ============ TYPOGRAPHY SEARCHER ============
class TypographySearcher {
  private bm25: BM25Search;
  private pairs: any[] = [];

  constructor(private dataDir: string) {
    this.bm25 = new BM25Search();
  }

  /**
   * Load typography pairs from JSON file
   */
  async loadPairs(): Promise<void> {
    const fs = require('fs').promises;
    const path = require('path');

    const pairsFile = path.join(this.dataDir, 'typography-pairs.json');

    try {
      const data = JSON.parse(await fs.readFile(pairsFile, 'utf-8'));
      this.pairs = data.pairs || [];
    } catch (error) {
      console.error('Error loading typography pairs:', error);
      this.pairs = [];
    }
  }

  /**
   * Search typography pairs
   */
  searchTypography(query: string, productType?: string, maxResults: number = 3): Array<{
    pair: any;
    score: number;
    confidence: number;
  }> {
    if (this.pairs.length === 0) {
      return [];
    }

    // Filter by product type if specified
    let filteredPairs = this.pairs;
    if (productType) {
      const categoryMap: Record<string, string> = {
        'SaaS': 'Professional Business',
        'E-commerce': 'Creative Arts',
        'Finance': 'Professional Business',
        'Healthcare': 'Friendly Approachable',
        'Education': 'Classic Elegant',
        'Social': 'Friendly Approachable',
        'Media': 'Editorial Publishing',
        'Tools': 'Professional Business'
      };
      const category = categoryMap[productType] || 'Professional Business';
      filteredPairs = this.pairs.filter((p: any) => p.category === category);
    }

    // Build documents for BM25
    const documents: Document[] = filteredPairs.map((pair: any, index: number) => ({
      id: pair.id || `pair_${index}`,
      content: [
        pair.name || '',
        pair.category || '',
        pair.moodStyleKeywords || ''
      ].join(' '),
      metadata: pair
    }));

    // Index and search
    this.bm25.index(documents);
    const results = this.bm25.search(query, maxResults);

    return results.map(result => ({
      pair: result.metadata,
      score: result.score,
      confidence: Math.min(0.85, 0.5 + result.score)
    }));
  }
}

// ============ COMPLETE RECOMMENDATION ENGINE ============
class RecommendationEngine {
  private styleSearcher: DesignStyleSearcher;
  private colorSearcher: ColorPaletteSearcher;
  private typographySearcher: TypographySearcher;

  constructor(dataDir: string = './assets') {
    this.styleSearcher = new DesignStyleSearcher(dataDir);
    this.colorSearcher = new ColorPaletteSearcher(dataDir);
    this.typographySearcher = new TypographySearcher(dataDir);
  }

  /**
   * Initialize all searchers
   */
  async initialize(): Promise<void> {
    await Promise.all([
      this.styleSearcher.loadStyles(),
      this.colorSearcher.loadPalettes(),
      this.typographySearcher.loadPairs()
    ]);
  }

  /**
   * Get style searcher (for external access)
   */
  getStyleSearcher(): DesignStyleSearcher {
    return this.styleSearcher;
  }

  /**
   * Get color searcher (for external access)
   */
  getColorSearcher(): ColorPaletteSearcher {
    return this.colorSearcher;
  }

  /**
   * Get typography searcher (for external access)
   */
  getTypographySearcher(): TypographySearcher {
    return this.typographySearcher;
  }

  /**
   * Get complete recommendations for product type
   */
  getRecommendations(productType: string, query: string = ''): {
    style?: any;
    color?: any;
    typography?: any;
  } {
    const styles = this.styleSearcher.searchStyles(query || productType, 1);
    const colors = this.colorSearcher.searchPalettes(query || productType, productType, 1);
    const typography = this.typographySearcher.searchTypography(query || productType, productType, 1);

    return {
      style: styles[0]?.style,
      color: colors[0]?.palette,
      typography: typography[0]?.pair
    };
  }
}

// ============ CLI INTERFACE ============
function printUsage() {
  console.log('\nUsage:');
  console.log('  node bm25-search.ts search styles <query>');
  console.log('  node bm25-search.ts search colors <query> [--product-type <type>]');
  console.log('  node bm25-search.ts recommend <product-type> [query]');
  console.log('\nExamples:');
  console.log('  node bm25-search.ts search styles "minimalist clean"');
  console.log('  node bm25-search.ts search colors "blue" --product-type SaaS');
  console.log('  node bm25-search.ts recommend Healthcare');
  console.log('  node bm25-search.ts recommend Healthcare "friendly modern"');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('FrontendMaster AI v2.0 - Enhanced BM25 Search Engine');
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  const engine = new RecommendationEngine('./assets');
  await engine.initialize();

  if (command === 'search') {
    const searchType = args[1];
    const searchArgs = args.slice(2);

    if (!searchType) {
      console.error('Error: Missing search type. Use styles or colors.');
      printUsage();
      process.exit(1);
    }

    if (searchType === 'styles') {
      const query = searchArgs.join(' ').trim();
      if (!query) {
        console.error('Error: Missing query for style search.');
        printUsage();
        process.exit(1);
      }

      const results = engine.getStyleSearcher().searchStyles(query, 3);
      console.log('\nSearch Results for Design Styles:');
      console.log('Query:', query);
      console.log('\n');
      results.forEach((result, i) => {
        console.log(`${i + 1}. ${result.style.name}`);
        console.log(`   Score: ${result.score.toFixed(2)} | Confidence: ${(result.confidence * 100).toFixed(0)}%`);
        console.log(`   Category: ${result.style.category}`);
        console.log();
      });
    } else if (searchType === 'colors') {
      const productTypeIdx = searchArgs.indexOf('--product-type');
      const productType = productTypeIdx >= 0 ? searchArgs[productTypeIdx + 1] : undefined;
      if (productTypeIdx >= 0 && !productType) {
        console.error('Error: --product-type requires a value.');
        printUsage();
        process.exit(1);
      }

      const queryParts =
        productTypeIdx >= 0
          ? searchArgs.filter((_, index) => index !== productTypeIdx && index !== productTypeIdx + 1)
          : searchArgs;
      const query = queryParts.join(' ').trim();
      if (!query) {
        console.error('Error: Missing query for color search.');
        printUsage();
        process.exit(1);
      }

      const results = engine.getColorSearcher().searchPalettes(query, productType, 3);
      console.log('\nSearch Results for Color Palettes:');
      console.log('Query:', query);
      if (productType) {
        console.log('Product Type:', productType);
      }
      console.log('\n');
      results.forEach((result, i) => {
        console.log(`${i + 1}. ${result.palette.name}`);
        console.log(`   Score: ${result.score.toFixed(2)} | Confidence: ${(result.confidence * 100).toFixed(0)}%`);
        console.log(`   Primary: ${result.palette.colors?.primary || 'N/A'}`);
        console.log();
      });
    } else {
      console.error(`Error: Unsupported search type "${searchType}".`);
      printUsage();
      process.exit(1);
    }
  } else if (command === 'recommend') {
    const productType = args[1]?.trim();
    const query = args.slice(2).join(' ').trim();

    if (!productType) {
      console.error('Error: Missing product type for recommend command.');
      printUsage();
      process.exit(1);
    }

    const recommendations = engine.getRecommendations(productType, query);
    console.log('\nRecommendations for Product Type:', productType);
    if (query) {
      console.log('Query:', query);
    }
    console.log('\n');
    console.log('Style:', recommendations.style?.name || 'N/A');
    console.log('Color:', recommendations.color?.name || 'N/A');
    console.log('Typography:', recommendations.typography?.name || 'N/A');
  } else {
    console.error(`Error: Unsupported command "${command}".`);
    printUsage();
    process.exit(1);
  }
}

const isMainModule =
  typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;

if (isMainModule) {
  main().catch(console.error);
}

export {
  BM25Search,
  DesignStyleSearcher,
  ColorPaletteSearcher,
  TypographySearcher,
  RecommendationEngine,
  Document,
  SearchResult,
  BM25Options
};
