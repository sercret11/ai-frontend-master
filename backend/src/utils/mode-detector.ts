/**
 * FrontendMaster AI v2.0 - Mode Detection Tool
 *
 * Automatically detects input information density and recommends mode selection
 *
 * Usage:
 *   node mode-detector.ts analyze "Make a pet hospital app"
 *   node mode-detector.ts detect --json "User input here"
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ============ PRODUCT TYPE KEYWORDS ============
const PRODUCT_TYPE_KEYWORDS: Record<string, string[]> = {
  'SaaS': ['analytics', 'collaboration', 'management', 'tool', 'dashboard', 'software'],
  'E-commerce': ['shop', 'store', 'buy', 'sell', 'ecommerce', 'mall', 'retail', 'marketplace'],
  'Finance': ['bank', 'payment', 'investment', 'finance', 'crypto', 'trading', 'fintech'],
  'Healthcare': ['hospital', 'clinic', 'health', 'medical', 'fitness', 'wellness', 'pharmacy'],
  'Education': ['education', 'learning', 'course', 'training', 'k12', 'school', 'university'],
  'Social': ['social', 'community', 'chat', 'messaging', 'friend', 'network', 'forum'],
  'Media': ['news', 'video', 'media', 'streaming', 'content', 'publishing', 'entertainment'],
  'Tools': ['productivity', 'note', 'calc', 'efficiency', 'utility', 'tool', 'app']
};

// ============ MODE DETECTOR CLASS ============
class ModeDetector {
  /**
   * Calculate information density score (0-100)
   */
  calculateDensityScore(userInput: UserInputAnalysis): number {
    let score = 0;

    // Word count (20%)
    const wordCount = userInput.text.split(/\s+/).length;
    if (wordCount < 20) {
      score += 0;
    } else if (wordCount < 100) {
      score += 5;
    } else if (wordCount < 300) {
      score += 10;
    } else {
      score += 20;
    }

    // PRD document (25%)
    if (userInput.hasPRD) {
      score += 25;
    }

    // Figma data (15%)
    if (userInput.hasFigma) {
      score += 15;
    }

    // Tech stack (15%)
    if (userInput.hasTechStack) {
      score += 15;
    }

    // Style reference (10%)
    if (userInput.hasStyleReference) {
      score += 10;
    }

    // Feature list (10%)
    if (userInput.hasDetailedRequirements) {
      score += 10;
    }

    // Business context (5%)
    if (userInput.hasBusinessContext) {
      score += 5;
    }

    return score;
  }

  /**
   * Get factors contributing to score
   */
  getScoreFactors(userInput: UserInputAnalysis): string[] {
    const factors: string[] = [];

    const wordCount = userInput.text.split(/\s+/).length;
    if (wordCount > 0) {
      if (wordCount < 20) {
        factors.push(`Word count: ${wordCount} (0pts)`);
      } else if (wordCount < 100) {
        factors.push(`Word count: ${wordCount} (5pts)`);
      } else if (wordCount < 300) {
        factors.push(`Word count: ${wordCount} (10pts)`);
      } else {
        factors.push(`Word count: ${wordCount} (20pts)`);
      }
    }

    if (userInput.hasPRD) {
      factors.push('PRD document: 25pts');
    }
    if (userInput.hasFigma) {
      factors.push('Figma data: 15pts');
    }
    if (userInput.hasTechStack) {
      factors.push('Tech stack: 15pts');
    }
    if (userInput.hasStyleReference) {
      factors.push('Style reference: 10pts');
    }
    if (userInput.hasDetailedRequirements) {
      factors.push('Detailed requirements: 10pts');
    }
    if (userInput.hasBusinessContext) {
      factors.push('Business context: 5pts');
    }

    return factors;
  }

  /**
   * Detect work mode based on information density
   */
  detectMode(userInput: UserInputAnalysis): ModeDetectionResult {
    const score = this.calculateDensityScore(userInput);
    const factors = this.getScoreFactors(userInput);

    let mode: 'creator' | 'implementer' | 'ambiguous';
    let confidence: number;

    if (score < 30) {
      mode = 'creator';
      confidence = 0.9 - (score / 300);
    } else if (score >= 50) {
      mode = 'implementer';
      confidence = 0.7 + ((score - 50) / 150);
    } else {
      mode = 'ambiguous';
      confidence = 0.5;
    }

    return {
      mode,
      confidence: Math.round(confidence * 100) / 100,
      score,
      factors,
      needsConfirmation: mode === 'ambiguous'
    };
  }
}

// ============ PRODUCT TYPE RECOGNIZER ============
class ProductTypeRecognizer {
  /**
   * Recognize product type from user input
   */
  recognize(userInput: string): ProductTypeDetection {
    const userInputLower = userInput.toLowerCase();

    // Count matches for each product type
    const matches: Record<string, { count: number; keywords: string[] }> = {};

    for (const [productType, keywords] of Object.entries(PRODUCT_TYPE_KEYWORDS)) {
      matches[productType] = {
        count: 0,
        keywords: []
      };

      for (const keyword of keywords) {
        if (userInputLower.includes(keyword)) {
          matches[productType].count++;
          matches[productType].keywords.push(keyword);
        }
      }
    }

    // Find best match
    let bestMatch = 'SaaS'; // Default
    let maxCount = 0;

    for (const [productType, matchData] of Object.entries(matches)) {
      if (matchData.count > maxCount) {
        maxCount = matchData.count;
        bestMatch = productType;
      }
    }

    // Calculate confidence (0.5 to 0.95)
    const confidence = Math.min(0.95, 0.5 + (maxCount * 0.15));

    const matchData = matches[bestMatch];
    if (!matchData) {
      return {
        type: bestMatch,
        confidence: Math.round(confidence * 100) / 100,
        matchedKeywords: []
      };
    }

    return {
      type: bestMatch,
      confidence: Math.round(confidence * 100) / 100,
      matchedKeywords: matchData.keywords
    };
  }
}

// ============ TECH STACK EXTRACTOR ============
class TechStackExtractor {
  /**
   * Extract tech stack from user input
   */
  extract(userInput: string): TechStackExtraction {
    const extraction: TechStackExtraction = {};

    const inputLower = userInput.toLowerCase();

    // Platform detection
    if (/\b(web|website|responsive|pwa)\b/.test(inputLower)) {
      extraction.platform = 'web';
    } else if (/\b(mobile|ios|android|app)\b/.test(inputLower)) {
      extraction.platform = 'mobile';
    } else if (/\b(mini program|wechat|小程序)\b/.test(inputLower)) {
      extraction.platform = 'miniprogram';
    } else if (/\b(desktop|electron|mac|windows|linux)\b/.test(inputLower)) {
      extraction.platform = 'desktop';
    }

    // Framework detection
    const frameworkPatterns: Record<string, RegExp> = {
      'Next.js': /next\.js\s*(\d+[\d.]*)?/i,
      'React': /react\s*(\d+[\d.]*)?/i,
      'Vue': /vue\s*(\d+[\d.]*)?/i,
      'Angular': /angular\s*(\d+[\d.]*)?/i,
      'Svelte': /svelte\s*(\d+[\d.]*)?/i,
      'SwiftUI': /swiftui/i
    };

    for (const [framework, pattern] of Object.entries(frameworkPatterns)) {
      const match = userInput.match(pattern);
      if (match) {
        extraction.framework = framework;
        extraction.version = match[1] || undefined;
        break;
      }
    }

    // UI Library detection
    const uiLibPatterns: Record<string, RegExp> = {
      'shadcn/ui': /shadcn\/ui/i,
      'Ant Design': /ant\s*design/i,
      'Element Plus': /element\s*plus/i,
      'uView UI': /uview/i,
      'Chakra UI': /chakra\s*ui/i
    };

    for (const [lib, pattern] of Object.entries(uiLibPatterns)) {
      if (pattern.test(userInput)) {
        extraction.uiLibrary = lib;
        break;
      }
    }

    // Styling detection
    const stylingPatterns: Record<string, RegExp> = {
      'Tailwind CSS': /tailwind/i,
      'CSS Modules': /css\s*modules/i,
      'Styled Components': /styled\s*components/i,
      'SCSS': /scss/i
    };

    for (const [style, pattern] of Object.entries(stylingPatterns)) {
      if (pattern.test(userInput)) {
        extraction.styling = style;
        break;
      }
    }

    return extraction;
  }
}

// ============ COLOR EXTRACTOR ============
class ColorExtractor {
  /**
   * Extract colors from user input
   */
  extract(userInput: string): ColorExtraction {
    const extraction: ColorExtraction = {};

    // HEX color pattern
    const hexPattern = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g;

    // Find all color values
    const colors = [...userInput.matchAll(hexPattern)];

    // Primary color (first mentioned or explicit)
    const primaryPattern = /primary\s*[:=]\s*(#[0-9A-Fa-f]{6})/i;
    const primaryMatch = userInput.match(primaryPattern);
    if (primaryMatch && primaryMatch[1]) {
      extraction.primary = primaryMatch[1];
    } else if (colors.length > 0) {
      const firstColor = colors[0];
      if (firstColor && firstColor[0]) {
        extraction.primary = firstColor[0];
      }
    }

    // Background color
    const backgroundPattern = /background\s*[:=]\s*(#[0-9A-Fa-f]{6})/i;
    const bgMatch = userInput.match(backgroundPattern);
    if (bgMatch && bgMatch[1]) {
      extraction.background = bgMatch[1];
    }

    return extraction;
  }
}

// ============ COMPLETE ANALYZER ============
class CompleteInputAnalyzer {
  private modeDetector: ModeDetector;
  private productRecognizer: ProductTypeRecognizer;
  private techStackExtractor: TechStackExtractor;
  private colorExtractor: ColorExtractor;

  constructor() {
    this.modeDetector = new ModeDetector();
    this.productRecognizer = new ProductTypeRecognizer();
    this.techStackExtractor = new TechStackExtractor();
    this.colorExtractor = new ColorExtractor();
  }

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
  } {
    // Prepare analysis input
    const analysisInput: UserInputAnalysis = {
      text: userInput,
      hasPRD: attachments?.hasPRD,
      hasFigma: attachments?.hasFigma,
      hasTechStack: attachments?.hasTechStack || this._hasTechStack(userInput),
      hasStyleReference: attachments?.hasStyleReference || this._hasStyleReference(userInput),
      hasDetailedRequirements: attachments?.hasDetailedRequirements || userInput.split(/\s+/).length > 50,
      hasBusinessContext: attachments?.hasBusinessContext || this._hasBusinessContext(userInput)
    };

    // Detect mode
    const modeDetection = this.modeDetector.detectMode(analysisInput);

    const result: any = {
      modeDetection,
      userInputSummary: {
        length: userInput.length,
        wordCount: userInput.split(/\s+/).length
      }
    };

    // Add mode-specific analysis
    if (modeDetection.mode === 'creator') {
      const productType = this.productRecognizer.recognize(userInput);
      result.productType = productType;
    } else if (modeDetection.mode === 'implementer') {
      const extractedTechStack = this.techStackExtractor.extract(userInput);
      const extractedColors = this.colorExtractor.extract(userInput);
      result.extractedTechStack = extractedTechStack;
      result.extractedColors = extractedColors;
    }

    return result;
  }

  private _hasTechStack(text: string): boolean {
    const techKeywords = ['react', 'vue', 'angular', 'next.js', 'nuxt', 'svelte', 'tailwind', 'typescript'];
    return techKeywords.some(kw => text.toLowerCase().includes(kw));
  }

  private _hasStyleReference(text: string): boolean {
    const styleKeywords = ['apple', 'google', 'microsoft', 'minimalist', 'modern', 'classic'];
    return styleKeywords.some(kw => text.toLowerCase().includes(kw));
  }

  private _hasBusinessContext(text: string): boolean {
    const businessKeywords = ['app', 'platform', 'system', 'dashboard', 'website', 'application'];
    return businessKeywords.some(kw => text.toLowerCase().includes(kw));
  }
}

// ============ CLI ============
function printAnalysis(result: any, jsonOutput: boolean = false): void {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('\n' + '='.repeat(60));
  console.log('MODE DETECTION RESULT');
  console.log('='.repeat(60));

  console.log(`\nMode: ${result.modeDetection.mode.toUpperCase()}`);
  console.log(`Score: ${result.modeDetection.score}/100`);
  console.log(`Confidence: ${result.modeDetection.confidence * 100}%`);

  console.log('\nScore Factors:');
  for (const factor of result.modeDetection.factors) {
    console.log(`  - ${factor}`);
  }

  if (result.modeDetection.needsConfirmation) {
    console.log('\n⚠️  GRAY ZONE DETECTED');
    console.log('Score is in ambiguous range (30-50).');
    console.log('Please provide more details or choose mode explicitly.');
  }

  if (result.productType) {
    console.log('\n' + '-'.repeat(60));
    console.log('PRODUCT TYPE RECOGNITION');
    console.log('-'.repeat(60));
    console.log(`Type: ${result.productType.type}`);
    console.log(`Confidence: ${result.productType.confidence * 100}%`);
    console.log(`Matched Keywords: ${result.productType.matchedKeywords.join(', ')}`);
  }

  if (result.extractedTechStack) {
    console.log('\n' + '-'.repeat(60));
    console.log('EXTRACTED TECH STACK');
    console.log('-'.repeat(60));
    console.log(JSON.stringify(result.extractedTechStack, null, 2));
  }

  if (result.extractedColors) {
    console.log('\n' + '-'.repeat(60));
    console.log('EXTRACTED COLORS');
    console.log('-'.repeat(60));
    console.log(JSON.stringify(result.extractedColors, null, 2));
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

// ============ MAIN ============
const isDirectRun = (() => {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('FrontendMaster AI v2.0 - Mode Detection Tool');
    console.log('\nUsage:');
    console.log('  node mode-detector.ts analyze "<user input>"');
    console.log('  node mode-detector.ts detect --json "<user input>"');
    console.log('\nExamples:');
    console.log('  node mode-detector.ts analyze "Make a pet hospital mini program"');
    console.log('  node mode-detector.ts analyze "Use React 18 + Tailwind CSS, style Apple"');
    process.exit(0);
  }

  const command = args[0];
  const userInput = args.slice(1).join(' ');

  if (!userInput) {
    console.error('Error: User input is required');
    process.exit(1);
  }

  const analyzer = new CompleteInputAnalyzer();

  if (command === 'analyze') {
    const result = analyzer.analyze(userInput);
    const jsonOutput = args.includes('--json');
    printAnalysis(result, jsonOutput);
  } else if (command === 'detect') {
    const result = analyzer.analyze(userInput);
    const jsonOutput = args.includes('--json');
    printAnalysis(result, jsonOutput);
  } else {
    console.error(`Error: Unknown command "${command}"`);
    console.log('Available commands: analyze, detect');
    process.exit(1);
  }
}

export {
  ModeDetector,
  ProductTypeRecognizer,
  TechStackExtractor,
  ColorExtractor,
  CompleteInputAnalyzer,
  UserInputAnalysis,
  ModeDetectionResult,
  ProductTypeDetection,
  TechStackExtraction,
  ColorExtraction
};
