/**
 * 属性 P1：SessionDocument 往返一致性
 *
 * 对 4 种 SessionDocument 子类型，验证
 * JSON.parse(JSON.stringify(doc)) 与原始文档深度相等。
 *
 * 验证: 需求 R11.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type {
  ProductManagerDocument,
  FrontendArchitectDocument,
  UIExpertDocument,
  UXExpertDocument,
  SessionDocument,
} from './types';

// ============================================================================
// Arbitraries
// ============================================================================

const priorityArb = fc.constantFrom('high' as const, 'medium' as const, 'low' as const);

const productManagerDocArb: fc.Arbitrary<ProductManagerDocument> = fc.record({
  id: fc.uuid(),
  agentId: fc.constant('product-manager' as const),
  createdAt: fc.nat(),
  version: fc.constant(1 as const),
  content: fc.record({
    functionalRequirements: fc.array(
      fc.record({
        id: fc.uuid(),
        title: fc.string({ minLength: 1, maxLength: 100 }),
        description: fc.string({ minLength: 1, maxLength: 500 }),
        priority: priorityArb,
      }),
      { minLength: 1, maxLength: 5 },
    ),
    userStories: fc.array(
      fc.record({
        id: fc.uuid(),
        persona: fc.string({ minLength: 1, maxLength: 50 }),
        goal: fc.string({ minLength: 1, maxLength: 200 }),
        benefit: fc.string({ minLength: 1, maxLength: 200 }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    priorityOrder: fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
  }),
});

const componentTypeArb = fc.constantFrom(
  'page' as const,
  'layout' as const,
  'component' as const,
  'widget' as const,
);

const stateApproachArb = fc.constantFrom(
  'zustand' as const,
  'context' as const,
  'redux' as const,
  'jotai' as const,
);

const frontendArchitectDocArb: fc.Arbitrary<FrontendArchitectDocument> = fc.record({
  id: fc.uuid(),
  agentId: fc.constant('frontend-architect' as const),
  createdAt: fc.nat(),
  version: fc.constant(1 as const),
  content: fc.record({
    componentTree: fc.array(
      fc.record({
        id: fc.uuid(),
        name: fc.string({ minLength: 1, maxLength: 50 }),
        type: componentTypeArb,
        children: fc.array(fc.uuid(), { maxLength: 3 }),
        props: fc.option(fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string({ maxLength: 50 })), { nil: undefined }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    routeDesign: fc.array(
      fc.record({
        path: fc.string({ minLength: 1, maxLength: 50 }),
        componentId: fc.uuid(),
        guard: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    stateManagement: fc.record({
      approach: stateApproachArb,
      stores: fc.array(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 30 }),
          description: fc.string({ minLength: 1, maxLength: 100 }),
          fields: fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string({ maxLength: 30 })),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    }),
  }),
});

const layoutStrategyArb = fc.constantFrom('mobile-first' as const, 'desktop-first' as const);

const uiExpertDocArb: fc.Arbitrary<UIExpertDocument> = fc.record({
  id: fc.uuid(),
  agentId: fc.constant('ui-expert' as const),
  createdAt: fc.nat(),
  version: fc.constant(1 as const),
  content: fc.record({
    visualSpec: fc.record({
      colorScheme: fc.string({ minLength: 1, maxLength: 30 }),
      typography: fc.record({
        heading: fc.string({ minLength: 1, maxLength: 30 }),
        body: fc.string({ minLength: 1, maxLength: 30 }),
      }),
      spacing: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string({ maxLength: 10 })),
      borderRadius: fc.string({ minLength: 1, maxLength: 10 }),
    }),
    componentStyles: fc.array(
      fc.record({
        componentId: fc.uuid(),
        styles: fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string({ maxLength: 50 })),
        variants: fc.option(
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string({ maxLength: 50 })),
          ),
          { nil: undefined },
        ),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    responsiveLayout: fc.record({
      breakpoints: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.nat({ max: 2560 })),
      strategy: layoutStrategyArb,
    }),
  }),
});

const uxExpertDocArb: fc.Arbitrary<UXExpertDocument> = fc.record({
  id: fc.uuid(),
  agentId: fc.constant('ux-expert' as const),
  createdAt: fc.nat(),
  version: fc.constant(1 as const),
  content: fc.record({
    interactionFlows: fc.array(
      fc.record({
        id: fc.uuid(),
        name: fc.string({ minLength: 1, maxLength: 50 }),
        steps: fc.array(
          fc.record({
            action: fc.string({ minLength: 1, maxLength: 100 }),
            expectedResult: fc.string({ minLength: 1, maxLength: 100 }),
            errorHandling: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    userJourneys: fc.array(
      fc.record({
        id: fc.uuid(),
        persona: fc.string({ minLength: 1, maxLength: 50 }),
        touchpoints: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
        painPoints: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    usabilityRecommendations: fc.array(
      fc.record({
        area: fc.string({ minLength: 1, maxLength: 50 }),
        recommendation: fc.string({ minLength: 1, maxLength: 200 }),
        priority: priorityArb,
      }),
      { minLength: 1, maxLength: 5 },
    ),
  }),
});

const sessionDocumentArb: fc.Arbitrary<SessionDocument> = fc.oneof(
  productManagerDocArb,
  frontendArchitectDocArb,
  uiExpertDocArb,
  uxExpertDocArb,
);

// ============================================================================
// Tests
// ============================================================================

describe('P1: SessionDocument round-trip consistency', () => {
  it('ProductManagerDocument survives JSON round-trip', () => {
    fc.assert(
      fc.property(productManagerDocArb, (doc) => {
        const roundTripped = JSON.parse(JSON.stringify(doc));
        expect(roundTripped).toEqual(doc);
      }),
      { numRuns: 10 },
    );
  });

  it('FrontendArchitectDocument survives JSON round-trip', () => {
    fc.assert(
      fc.property(frontendArchitectDocArb, (doc) => {
        const roundTripped = JSON.parse(JSON.stringify(doc));
        expect(roundTripped).toEqual(doc);
      }),
      { numRuns: 10 },
    );
  });

  it('UIExpertDocument survives JSON round-trip', () => {
    fc.assert(
      fc.property(uiExpertDocArb, (doc) => {
        const roundTripped = JSON.parse(JSON.stringify(doc));
        expect(roundTripped).toEqual(doc);
      }),
      { numRuns: 10 },
    );
  });

  it('UXExpertDocument survives JSON round-trip', () => {
    fc.assert(
      fc.property(uxExpertDocArb, (doc) => {
        const roundTripped = JSON.parse(JSON.stringify(doc));
        expect(roundTripped).toEqual(doc);
      }),
      { numRuns: 100 },
    );
  });

  it('any SessionDocument survives JSON round-trip', () => {
    fc.assert(
      fc.property(sessionDocumentArb, (doc) => {
        const roundTripped = JSON.parse(JSON.stringify(doc));
        expect(roundTripped).toEqual(doc);
      }),
      { numRuns: 20 },
    );
  });
});
