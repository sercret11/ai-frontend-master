import { describe, expect, it } from 'vitest';
import { VirtualFileSystem } from './VirtualFileSystem';

describe('VirtualFileSystem path normalization', () => {
  it('stores and retrieves files by canonical path without duplicates', () => {
    const vfs = new VirtualFileSystem();

    vfs.setFile('/src//App.tsx', 'first');
    vfs.setFile('.\\src\\App.tsx', 'second');

    expect(vfs.getFile('src/App.tsx')?.content).toBe('second');
    expect(vfs.exportFiles()).toEqual([{ path: 'src/App.tsx', content: 'second' }]);
  });

  it('deduplicates canonical duplicates during initialization', () => {
    const vfs = new VirtualFileSystem();

    vfs.initializeFiles([
      { path: './src/App.tsx', content: 'first' },
      { path: 'src//App.tsx', content: 'second' },
      { path: 'src\\main.tsx', content: 'main' },
    ]);

    expect(vfs.exportFiles()).toEqual([
      { path: 'src/App.tsx', content: 'second' },
      { path: 'src/main.tsx', content: 'main' },
    ]);
  });
});
