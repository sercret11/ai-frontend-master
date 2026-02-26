/**
 * Smart-context mode router.
 *
 * This router now delegates score/mode decision to prompt/router.ts so that
 * runtime route and context route use one decision model.
 */

import { CompleteInputAnalyzer } from '../../utils/mode-detector.js';
import { ModeRouter as PromptModeRouter } from '../../prompt/router.js';

export interface AnalysisResult {
  modeDetection: {
    mode: 'creator' | 'implementer' | 'ambiguous';
    confidence: number;
    score: number;
    factors: string[];
    needsConfirmation: boolean;
  };
  userInputSummary: {
    length: number;
    wordCount: number;
  };
  productType?: {
    type: string;
    confidence: number;
    matchedKeywords: string[];
  };
  extractedTechStack?: {
    platform?: string;
    framework?: string;
    version?: string;
    uiLibrary?: string;
    styling?: string;
    stateManagement?: string;
  };
  extractedColors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    background?: string;
    text?: string;
    border?: string;
  };
}

export interface ModeRouteResult {
  mode: 'creator' | 'implementer';
  analysis: AnalysisResult;
  confidence: number;
  score: number;
  version: string;
  language?: 'zh' | 'en' | 'mixed' | 'unknown';
  techSignals?: string[];
  reason: string;
}

export interface ModeRouterConfig {
  threshold?: number;
  forceMode?: 'creator' | 'implementer';
}

export class ModeRouter {
  private analyzer: CompleteInputAnalyzer;
  private threshold: number;
  private forceMode?: 'creator' | 'implementer';

  constructor(config: ModeRouterConfig = {}) {
    this.analyzer = new CompleteInputAnalyzer();
    this.threshold = config.threshold ?? 40;
    this.forceMode = config.forceMode;
  }

  detect(userInput: string): ModeRouteResult {
    const analysis = this.analyzer.analyze(userInput) as AnalysisResult;
    const detected = PromptModeRouter.detectAgent({
      userQuery: userInput,
      hasPRD: false,
      hasTechStack: false,
      hasFigma: false,
      hasDetailedRequirements: false,
      hasBusinessContext: false,
    });
    const score = detected.score;
    const routedMode = detected.mode === 'creator' || detected.mode === 'implementer'
      ? detected.mode
      : score < this.threshold
        ? 'creator'
        : 'implementer';
    const mode = this.forceMode || routedMode;
    const confidence = this.forceMode ? 100 : detected.confidence;

    return {
      mode,
      analysis: {
        ...analysis,
        modeDetection: {
          mode,
          confidence,
          score,
          factors: analysis.modeDetection?.factors || [],
          needsConfirmation: Boolean(detected.clarificationTask?.required),
        },
      },
      confidence,
      score,
      version: detected.version || PromptModeRouter.version,
      language: detected.language,
      techSignals: detected.techSignals,
      reason: this.buildReason(mode, score, analysis),
    };
  }

  private buildReason(
    mode: 'creator' | 'implementer',
    score: number,
    analysis: AnalysisResult
  ): string {
    const factors = analysis.modeDetection?.factors?.slice(0, 5) || [];
    const factorText = factors.length ? factors.join('; ') : 'based on unified routing score';
    return `route=${PromptModeRouter.version}; mode=${mode}; score=${score.toFixed(1)}; threshold=${this.threshold}; factors=${factorText}`;
  }

  detectBatch(inputs: string[]): ModeRouteResult[] {
    return inputs.map(input => this.detect(input));
  }

  getStats(results: ModeRouteResult[]): {
    creator: number;
    implementer: number;
    avgConfidence: number;
    avgScore: number;
  } {
    const creator = results.filter(r => r.mode === 'creator').length;
    const implementer = results.filter(r => r.mode === 'implementer').length;
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
    const avgScore =
      results.reduce((sum, r) => sum + r.analysis.modeDetection.score, 0) / results.length;

    return { creator, implementer, avgConfidence, avgScore };
  }
}

export function createModeRouter(config?: ModeRouterConfig): ModeRouter {
  return new ModeRouter(config);
}
