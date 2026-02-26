import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from './manager';
import { Token } from '../utils/text/token';

const createBareManager = (): any => Object.create(ContextManager.prototype);

describe('ContextManager targeted fixes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calculateTokens computes total from all parts', () => {
    const manager = createBareManager();
    const systemPrompt = 'system prompt';
    const selected = { totalTokens: 42 };
    const skills = ['react', 'typescript'];
    const session = { messages: [{ tokens: 10 }, { tokens: 25 }] };

    const result = manager.calculateTokens(systemPrompt, selected, skills, session);
    const expectedSystem = Token.estimate(systemPrompt);
    const expectedSkills = skills.reduce((sum, skill) => sum + Token.estimate(skill), 0);

    expect(result.system).toBe(expectedSystem);
    expect(result.sections).toBe(42);
    expect(result.skills).toBe(expectedSkills);
    expect(result.messages).toBe(35);
    expect(result.total).toBe(expectedSystem + 42 + expectedSkills + 35);
  });

  it('selectSectionsWithCache key includes stable request signature', async () => {
    const manager = createBareManager();
    const cache = {
      getParseResult: vi.fn().mockReturnValue(undefined),
      cacheParseResult: vi.fn(),
    };
    const sectionLoader = {
      listSections: vi.fn().mockResolvedValue([]),
      loadSection: vi.fn(),
    };
    const selector = {
      selectForRequest: vi.fn().mockResolvedValue({ selected: [], totalTokens: 0 }),
    };

    manager.cache = cache;
    manager.sectionLoader = sectionLoader;
    manager.selector = selector;

    await manager.selectSectionsWithCache(
      {
        mode: 'creator',
        platform: 'web',
        userMessage: 'first message',
        techStack: ['vue', 'react'],
      },
      2000
    );

    await manager.selectSectionsWithCache(
      {
        mode: 'creator',
        platform: 'web',
        userMessage: 'second message',
        techStack: ['vue', 'react'],
      },
      2000
    );

    await manager.selectSectionsWithCache(
      {
        mode: 'creator',
        platform: 'web',
        userMessage: 'first message',
        techStack: ['react', 'vue'],
      },
      2000
    );

    await manager.selectSectionsWithCache(
      {
        mode: 'creator',
        platform: 'web',
        userMessage: 'first message',
        techStack: ['react', 'vue'],
      },
      3000
    );

    const key1 = cache.getParseResult.mock.calls[0][0];
    const key2 = cache.getParseResult.mock.calls[1][0];
    const key3 = cache.getParseResult.mock.calls[2][0];
    const key4 = cache.getParseResult.mock.calls[3][0];

    expect(key1).not.toBe(key2);
    expect(key1).toBe(key3);
    expect(key1).not.toBe(key4);
  });

  it('getCacheKey does not mutate request.techStack and handles undefined safely', () => {
    const manager = createBareManager();
    const request = {
      mode: 'implementer',
      platform: 'web',
      techStack: ['zod', 'react'],
    };

    const key = manager.getCacheKey(request);
    const parsed = JSON.parse(key);

    expect(request.techStack).toEqual(['zod', 'react']);
    expect(parsed.techStack).toEqual(['react', 'zod']);

    const keyWithoutTechStack = manager.getCacheKey({
      mode: 'implementer',
      platform: 'web',
    });
    const parsedWithoutTechStack = JSON.parse(keyWithoutTechStack);

    expect(parsedWithoutTechStack.techStack).toEqual([]);
  });

  it('startCacheCleanup stores both timer handles and destroy clears both', () => {
    const manager = createBareManager();
    const cache = {
      clearExpired: vi.fn(),
      clear: vi.fn(),
    };
    manager.cache = cache;
    manager.sessions = new Map([['session-1', { id: 'session-1' }]]);
    manager.cleanupExpiredSessions = vi.fn();

    const cacheTimer = { name: 'cache' } as unknown as NodeJS.Timeout;
    const sessionTimer = { name: 'session' } as unknown as NodeJS.Timeout;

    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementationOnce(() => cacheTimer)
      .mockImplementationOnce(() => sessionTimer);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});

    manager.startCacheCleanup();

    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    expect(manager.cacheCleanupTimer).toBe(cacheTimer);
    expect(manager.cleanupTimer).toBe(sessionTimer);

    manager.destroy();

    expect(clearIntervalSpy).toHaveBeenCalledWith(cacheTimer);
    expect(clearIntervalSpy).toHaveBeenCalledWith(sessionTimer);
    expect(cache.clear).toHaveBeenCalledTimes(1);
    expect(manager.sessions.size).toBe(0);
    expect(manager.cacheCleanupTimer).toBeUndefined();
    expect(manager.cleanupTimer).toBeUndefined();
  });
});
