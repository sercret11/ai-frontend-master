interface BrowserLike {
  newContext: () => Promise<BrowserContextLike>;
  close: () => Promise<void>;
  isConnected?: () => boolean;
}

interface BrowserContextLike {
  newPage: () => Promise<PageLike>;
  close: () => Promise<void>;
}

interface PageLike {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  waitForSelector: (selector: string, options?: Record<string, unknown>) => Promise<unknown>;
  evaluate: <T>(handler: () => T) => Promise<T>;
  screenshot: (options?: Record<string, unknown>) => Promise<Buffer>;
  close: () => Promise<void>;
}

interface RuntimeCheckResult {
  ok: boolean;
  error?: string;
  screenshotBase64?: string;
}

function timeoutError(message: string): Error {
  const error = new Error(message);
  error.name = 'PlaywrightHardTimeoutError';
  return error;
}

async function withHardTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class PlaywrightContextManager {
  private readonly browsers = new Map<string, BrowserLike>();

  private playwrightModulePromise: Promise<{ chromium: { launch: (options: Record<string, unknown>) => Promise<BrowserLike> } }> | null = null;

  private async loadPlaywrightModule() {
    if (!this.playwrightModulePromise) {
      const moduleName = 'playwright';
      this.playwrightModulePromise = import(moduleName) as Promise<{
        chromium: { launch: (options: Record<string, unknown>) => Promise<BrowserLike> };
      }>;
    }
    return this.playwrightModulePromise;
  }

  private async getBrowser(sessionId: string): Promise<BrowserLike> {
    const existing = this.browsers.get(sessionId);
    if (existing && (typeof existing.isConnected !== 'function' || existing.isConnected())) {
      return existing;
    }

    const playwright = await this.loadPlaywrightModule();
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    this.browsers.set(sessionId, browser);
    return browser;
  }

  public async withPage<T>(
    sessionId: string,
    task: (page: PageLike) => Promise<T>,
    timeoutMs = 5000
  ): Promise<T> {
    const browser = await this.getBrowser(sessionId);
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      return await withHardTimeout(
        task(page),
        timeoutMs,
        `playwright task timeout after ${timeoutMs}ms`
      );
    } finally {
      await Promise.allSettled([page.close(), context.close()]);
    }
  }

  public async runRuntimeCheck(
    sessionId: string,
    url: string,
    timeoutMs = 5000
  ): Promise<RuntimeCheckResult> {
    try {
      return await this.withPage(
        sessionId,
        async page => {
          await withHardTimeout(
            page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }),
            timeoutMs,
            `playwright goto timeout after ${timeoutMs}ms`
          );
          await withHardTimeout(
            page.waitForSelector('body', { timeout: timeoutMs }),
            timeoutMs,
            `playwright waitForSelector timeout after ${timeoutMs}ms`
          );
          await withHardTimeout(
            page.evaluate(() => {
              const runtime = globalThis as { document?: { readyState?: string } };
              return runtime.document?.readyState ?? 'unknown';
            }),
            timeoutMs,
            `playwright evaluate timeout after ${timeoutMs}ms`
          );
          const screenshot = await withHardTimeout(
            page.screenshot({ type: 'png' }),
            timeoutMs,
            `playwright screenshot timeout after ${timeoutMs}ms`
          );
          return {
            ok: true,
            screenshotBase64: screenshot.toString('base64'),
          };
        },
        timeoutMs
      );
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async disposeSession(sessionId: string): Promise<void> {
    const browser = this.browsers.get(sessionId);
    if (!browser) {
      return;
    }
    this.browsers.delete(sessionId);
    await browser.close();
  }

  public async disposeAll(): Promise<void> {
    const browsers = [...this.browsers.entries()];
    this.browsers.clear();
    await Promise.allSettled(browsers.map(([, browser]) => browser.close()));
  }
}

export const playwrightContextManager = new PlaywrightContextManager();
