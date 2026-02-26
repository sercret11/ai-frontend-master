import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { detectPlatform } from './detect-platform.ts';

describe('detect platform config matching', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('detects web platform from next.config.js pattern', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'detect-platform-'));
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'tmp', version: '1.0.0' }));
    writeFileSync(join(tempDir, 'next.config.js'), 'module.exports = {}');

    const result = detectPlatform(tempDir);
    const webPlatform = result.detectedPlatforms.find(item => item.platform === 'web');

    expect(webPlatform).toBeDefined();
    expect(webPlatform?.confidence).toBeGreaterThan(0);
  });
});
