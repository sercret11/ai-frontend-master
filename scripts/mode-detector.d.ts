/**
 * FrontendMaster AI v2.0 - Mode Detection Tool
 *
 * Automatically detects input information density and recommends mode selection
 *
 * Usage:
 *   node mode-detector.ts analyze "Make a pet hospital app"
 *   node mode-detector.ts detect --json "User input here"
 */
interface UserInputAnalysis {
    text: string;
    hasPRD?: boolean;
    hasFigma?: boolean;
    hasTechStack?: boolean;
    hasStyleReference?: boolean;
    hasDetailedRequirements?: boolean;
    hasBusinessContext?: boolean;
}
interface ModeDetectionResult {
    mode: 'creator' | 'implementer' | 'ambiguous';
    confidence: number;
    score: number;
    factors: string[];
    needsConfirmation: boolean;
}
interface ProductTypeDetection {
    type: string;
    confidence: number;
    matchedKeywords: string[];
}
interface TechStackExtraction {
    platform?: 'web' | 'mobile' | 'miniprogram' | 'desktop';
    framework?: string;
    version?: string;
    uiLibrary?: string;
    styling?: string;
    stateManagement?: string;
}
interface ColorExtraction {
    primary?: string;
    secondary?: string;
    accent?: string;
    background?: string;
    text?: string;
    border?: string;
}
declare class ModeDetector {
    /**
     * Calculate information density score (0-100)
     */
    calculateDensityScore(userInput: UserInputAnalysis): number;
    /**
     * Get factors contributing to score
     */
    getScoreFactors(userInput: UserInputAnalysis): string[];
    /**
     * Detect work mode based on information density
     */
    detectMode(userInput: UserInputAnalysis): ModeDetectionResult;
}
declare class ProductTypeRecognizer {
    /**
     * Recognize product type from user input
     */
    recognize(userInput: string): ProductTypeDetection;
}
declare class TechStackExtractor {
    /**
     * Extract tech stack from user input
     */
    extract(userInput: string): TechStackExtraction;
}
declare class ColorExtractor {
    /**
     * Extract colors from user input
     */
    extract(userInput: string): ColorExtraction;
}
declare class CompleteInputAnalyzer {
    private modeDetector;
    private productRecognizer;
    private techStackExtractor;
    private colorExtractor;
    constructor();
    /**
     * Complete analysis of user input
     */
    analyze(userInput: string, attachments?: Partial<UserInputAnalysis>): {
        modeDetection: ModeDetectionResult;
        userInputSummary: {
            length: number;
            wordCount: number;
        };
        productType?: ProductTypeDetection;
        extractedTechStack?: TechStackExtraction;
        extractedColors?: ColorExtraction;
    };
    private _hasTechStack;
    private _hasStyleReference;
    private _hasBusinessContext;
}
export { ModeDetector, ProductTypeRecognizer, TechStackExtractor, ColorExtractor, CompleteInputAnalyzer, UserInputAnalysis, ModeDetectionResult, ProductTypeDetection, TechStackExtraction, ColorExtraction };
//# sourceMappingURL=mode-detector.d.ts.map