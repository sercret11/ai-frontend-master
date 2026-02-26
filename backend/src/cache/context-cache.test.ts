import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextCache } from './context-cache';

describe('ContextCache clearExpired', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses entry-level ttl with default fallback when clearing', () => {
    const cache = new ContextCache({
      maxSections: 10,
      maxContents: 10,
      maxSkills: 10,
      maxParseResults: 10,
      ttl: 1000,
    });

    const now = 10_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    (cache as any).sectionCache.set('section-short-ttl', {
      data: { id: 'section-short-ttl' },
      timestamp: now - 200,
      hits: 0,
      size: 1,
      ttl: 100,
    });
    (cache as any).contentCache.set('content-long-ttl', {
      data: 'content-long-ttl',
      timestamp: now - 1200,
      hits: 0,
      size: 1,
      ttl: 5000,
    });
    (cache as any).skillCache.set('skill-default-ttl', {
      data: { name: 'skill-default-ttl' },
      timestamp: now - 1200,
      hits: 0,
      size: 1,
    });
    (cache as any).parseCache.set('parse-not-expired', {
      data: { value: 'parse-not-expired' },
      timestamp: now - 200,
      hits: 0,
      size: 1,
      ttl: 500,
    });

    cache.clearExpired();

    expect((cache as any).sectionCache.has('section-short-ttl')).toBe(false);
    expect((cache as any).contentCache.has('content-long-ttl')).toBe(true);
    expect((cache as any).skillCache.has('skill-default-ttl')).toBe(false);
    expect((cache as any).parseCache.has('parse-not-expired')).toBe(true);
  });
});
