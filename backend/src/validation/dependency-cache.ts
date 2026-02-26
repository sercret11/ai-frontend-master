/**
 * Dependency Cache Manager - Cache and reuse installed node_modules
 *
 * This module provides caching for npm installations to speed up
 * validation by avoiding redundant npm install commands.
 */

import { promises as fs } from 'fs';
import path from 'path';
import * as crypto from 'crypto';
import { CommandRunner } from './command-runner';
import { FileStorage } from '../storage/file-storage';

/**
 * Cache entry metadata
 */
interface CacheEntry {
  /** Hash of package.json content */
  hash: string;
  /** Timestamp when cache was created */
  createdAt: number;
  /** Timestamp when cache was last used */
  lastUsed: number;
  /** Size of node_modules in bytes */
  size: number;
  /** Path to cached node_modules */
  cachePath: string;
}

/**
 * Cache statistics
 */
interface CacheStats {
  /** Total number of cached entries */
  totalEntries: number;
  /** Total size of all caches in bytes */
  totalSize: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
}

/**
 * DependencyCache namespace
 */
export namespace DependencyCache {
  /** Cache directory */
  const CACHE_DIR = path.join(process.cwd(), '.cache', 'node-modules-cache');

  /** Cache index file */
  const INDEX_FILE = path.join(CACHE_DIR, 'cache-index.json');

  /** In-memory cache index */
  let cacheIndex: Map<string, CacheEntry> = new Map();

  /** Cache statistics */
  const stats: CacheStats = {
    totalEntries: 0,
    totalSize: 0,
    hits: 0,
    misses: 0,
  };

  /**
   * Initialize cache manager
   */
  export async function initialize(): Promise<void> {
    try {
      // Ensure cache directory exists
      await fs.mkdir(CACHE_DIR, { recursive: true });

      // Load cache index
      await loadIndex();

      // Calculate stats
      calculateStats();

      console.log(`[DependencyCache] Initialized with ${cacheIndex.size} cached entries`);
    } catch (error) {
      console.error('[DependencyCache] Failed to initialize:', error);
      // Continue with empty cache
      cacheIndex = new Map();
    }
  }

  /**
   * Load cache index from disk
   */
  async function loadIndex(): Promise<void> {
    try {
      const data = await fs.readFile(INDEX_FILE, 'utf-8');
      const entries = JSON.parse(data) as CacheEntry[];

      cacheIndex = new Map(
        entries.map(entry => [entry.hash, entry])
      );

      console.log(`[DependencyCache] Loaded ${cacheIndex.size} cache entries from index`);
    } catch (error) {
      // Index doesn't exist yet, start with empty cache
      cacheIndex = new Map();
    }
  }

  /**
   * Save cache index to disk
   */
  async function saveIndex(): Promise<void> {
    try {
      const entries = Array.from(cacheIndex.values());
      await fs.writeFile(INDEX_FILE, JSON.stringify(entries, null, 2));
    } catch (error) {
      console.error('[DependencyCache] Failed to save index:', error);
    }
  }

  /**
   * Calculate cache statistics
   */
  function calculateStats(): void {
    stats.totalEntries = cacheIndex.size;
    stats.totalSize = Array.from(cacheIndex.values())
      .reduce((sum, entry) => sum + entry.size, 0);
  }

  /**
   * Generate hash from package.json content
   */
  async function generateHash(sessionID: string): Promise<string> {
    const files = FileStorage.getAllFiles(sessionID);
    const packageJson = files.find(f => f.path === 'package.json');

    if (!packageJson) {
      throw new Error('package.json not found in session files');
    }

    // Normalize package.json for consistent hashing
    const normalized = JSON.stringify(JSON.parse(packageJson.content), Object.keys({}).sort());
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');

    return hash;
  }

  /**
   * Get cache entry for session
   */
  export async function getCache(sessionID: string): Promise<string | null> {
    const hash = await generateHash(sessionID);
    const entry = cacheIndex.get(hash);

    if (entry) {
      // Update last used time
      entry.lastUsed = Date.now();
      await saveIndex();

      stats.hits++;
      console.log(`[DependencyCache] Cache HIT for hash ${hash.substring(0, 8)}...`);

      return entry.cachePath;
    }

    stats.misses++;
    console.log(`[DependencyCache] Cache MISS for hash ${hash.substring(0, 8)}...`);

    return null;
  }

  /**
   * Create cache entry for session
   */
  export async function createCache(sessionID: string, nodeModulesPath: string): Promise<void> {
    const hash = await generateHash(sessionID);
    const cachePath = path.join(CACHE_DIR, hash);

    try {
      // Check if cache already exists
      if (cacheIndex.has(hash)) {
        console.log(`[DependencyCache] Cache already exists for hash ${hash.substring(0, 8)}...`);
        return;
      }

      // Create cache directory
      await fs.mkdir(cachePath, { recursive: true });

      // Copy node_modules to cache
      const sourcePath = path.join(nodeModulesPath, 'node_modules');

      try {
        await fs.access(sourcePath);
        await fs.cp(sourcePath, path.join(cachePath, 'node_modules'), {
          recursive: true,
          dereference: true,
        });

        // Calculate size
        const size = await getDirectorySize(path.join(cachePath, 'node_modules'));

        // Create cache entry
        const entry: CacheEntry = {
          hash,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          size,
          cachePath,
        };

        cacheIndex.set(hash, entry);
        await saveIndex();
        calculateStats();

        console.log(
          `[DependencyCache] Created cache entry: ${hash.substring(0, 8)}... ` +
          `(${(size / 1024 / 1024).toFixed(2)} MB)`
        );
      } catch (error) {
        // node_modules doesn't exist, don't cache
        console.warn('[DependencyCache] node_modules not found, skipping cache creation');
      }
    } catch (error) {
      console.error('[DependencyCache] Failed to create cache:', error);
    }
  }

  /**
   * Restore cache for session
   */
  export async function restoreCache(sessionID: string, targetDir: string): Promise<boolean> {
    const cachePath = await getCache(sessionID);

    if (!cachePath) {
      return false;
    }

    try {
      const targetNodeModules = path.join(targetDir, 'node_modules');

      // Copy cached node_modules to target
      await fs.copyFile(
        path.join(cachePath, 'node_modules'),
        targetNodeModules,
        fs.constants.COPYFILE_FICLONE
      );

      console.log(`[DependencyCache] Restored cache to ${targetDir}`);
      return true;
    } catch (error) {
      console.error('[DependencyCache] Failed to restore cache:', error);
      return false;
    }
  }

  /**
   * Clear all cache entries
   */
  export async function clearCache(): Promise<void> {
    try {
      // Delete all cache directories except index file
      const entries = await fs.readdir(CACHE_DIR);

      for (const entry of entries) {
        if (entry === 'cache-index.json') continue;

        const entryPath = path.join(CACHE_DIR, entry);
        await fs.rm(entryPath, { recursive: true, force: true });
      }

      // Clear index
      cacheIndex.clear();
      await saveIndex();
      calculateStats();

      console.log('[DependencyCache] Cleared all cache entries');
    } catch (error) {
      console.error('[DependencyCache] Failed to clear cache:', error);
    }
  }

  /**
   * Clear old cache entries (older than specified days)
   */
  export async function clearOldCache(maxAgeDays: number = 7): Promise<void> {
    const now = Date.now();
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    const toDelete: string[] = [];

    for (const [hash, entry] of cacheIndex.entries()) {
      if (now - entry.lastUsed > maxAge) {
        toDelete.push(hash);
      }
    }

    for (const hash of toDelete) {
      const entry = cacheIndex.get(hash)!;

      try {
        await fs.rm(entry.cachePath, { recursive: true, force: true });
        cacheIndex.delete(hash);
        console.log(`[DependencyCache] Deleted old cache: ${hash.substring(0, 8)}...`);
      } catch (error) {
        console.error(`[DependencyCache] Failed to delete cache ${hash}:`, error);
      }
    }

    await saveIndex();
    calculateStats();

    console.log(`[DependencyCache] Cleared ${toDelete.length} old cache entries`);
  }

  /**
   * Get cache statistics
   */
  export function getStats(): CacheStats {
    return { ...stats };
  }

  /**
   * Calculate directory size recursively
   */
  async function getDirectorySize(dirPath: string): Promise<number> {
    let size = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          size += await getDirectorySize(fullPath);
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          size += stats.size;
        }
      }
    } catch (error) {
      // Directory might not exist or be inaccessible
      console.warn(`[DependencyCache] Failed to calculate size for ${dirPath}:`, error);
    }

    return size;
  }

  /**
   * Install dependencies with caching
   */
  export async function installWithCache(
    sessionID: string,
    options?: { force?: boolean }
  ): Promise<void> {
    const tempDir = await CommandRunner.createValidationDir(sessionID);
    await CommandRunner.exportSessionFiles(sessionID, tempDir);

    try {
      // Try to restore from cache
      if (!options?.force) {
        const restored = await restoreCache(sessionID, tempDir);

        if (restored) {
          console.log('[DependencyCache] Using cached dependencies');
          return;
        }
      }

      // Cache miss or force install - run npm install
      console.log('[DependencyCache] Running npm install...');
      const result = await CommandRunner.runNpmInstall(sessionID, { cwd: tempDir });

      if (result.exitCode !== 0) {
        throw new Error(`npm install failed: ${result.stderr}`);
      }

      // Create cache for future use
      await createCache(sessionID, tempDir);
    } finally {
      // Cleanup temp dir (keep cache)
      await CommandRunner.cleanup(tempDir);
    }
  }
}
