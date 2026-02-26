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
    k1?: number;
    b?: number;
}
declare class BM25Search {
    private k1;
    private b;
    private corpus;
    private docLengths;
    private avgDocLength;
    private idf;
    private docFreqs;
    private N;
    constructor(options?: BM25Options);
    /**
     * Tokenize text for search
     * - Converts to lowercase
     * - Removes punctuation
     * - Filters short words
     */
    private tokenize;
    /**
     * Build search index from documents
     */
    index(documents: Document[]): void;
    /**
     * Score all documents against query
     */
    score(query: string): Array<{
        index: number;
        score: number;
    }>;
    /**
     * Search and return ranked results
     */
    search(query: string, maxResults?: number): SearchResult[];
}
declare class DesignStyleSearcher {
    private dataDir;
    private bm25;
    private styles;
    constructor(dataDir: string);
    /**
     * Load design styles from JSON file
     */
    loadStyles(): Promise<void>;
    /**
     * Search design styles
     */
    searchStyles(query: string, maxResults?: number): Array<{
        style: any;
        score: number;
        confidence: number;
    }>;
}
declare class ColorPaletteSearcher {
    private dataDir;
    private bm25;
    private palettes;
    constructor(dataDir: string);
    /**
     * Load color palettes from JSON file
     */
    loadPalettes(): Promise<void>;
    /**
     * Search color palettes by product type or query
     */
    searchPalettes(query: string, productType?: string, maxResults?: number): Array<{
        palette: any;
        score: number;
        confidence: number;
    }>;
}
declare class TypographySearcher {
    private dataDir;
    private bm25;
    private pairs;
    constructor(dataDir: string);
    /**
     * Load typography pairs from JSON file
     */
    loadPairs(): Promise<void>;
    /**
     * Search typography pairs
     */
    searchTypography(query: string, productType?: string, maxResults?: number): Array<{
        pair: any;
        score: number;
        confidence: number;
    }>;
}
declare class RecommendationEngine {
    private styleSearcher;
    private colorSearcher;
    private typographySearcher;
    constructor(dataDir?: string);
    /**
     * Initialize all searchers
     */
    initialize(): Promise<void>;
    /**
     * Get style searcher (for external access)
     */
    getStyleSearcher(): DesignStyleSearcher;
    /**
     * Get color searcher (for external access)
     */
    getColorSearcher(): ColorPaletteSearcher;
    /**
     * Get typography searcher (for external access)
     */
    getTypographySearcher(): TypographySearcher;
    /**
     * Get complete recommendations for product type
     */
    getRecommendations(productType: string, query?: string): {
        style?: any;
        color?: any;
        typography?: any;
    };
}
export { BM25Search, DesignStyleSearcher, ColorPaletteSearcher, TypographySearcher, RecommendationEngine, Document, SearchResult, BM25Options };
//# sourceMappingURL=bm25-search.d.ts.map