/**
 * Virtual File System - 浏览器端虚拟文件系统
 *
 * 提供文件管理功能，支持目录结构、文件读写等操作
 */

export interface VirtualFile {
  name: string;
  path: string;
  type: 'file' | 'directory';
  content?: string;
  children?: VirtualFile[];
  size?: number;
  lastModified?: number;
}

export interface FileOperation {
  type: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  timestamp: number;
}

export interface FileSystemOptions {
  maxFiles?: number;
  maxSize?: number;
}

export interface FileSystemSnapshot {
  id: string;
  label?: string;
  createdAt: number;
}

/**
 * Virtual File System Class
 */
export class VirtualFileSystem {
  private files: Map<string, VirtualFile> = new Map();
  private operations: FileOperation[] = [];
  private snapshots: Map<
    string,
    {
      files: Map<string, VirtualFile>;
      operations: FileOperation[];
      createdAt: number;
      label?: string;
    }
  > = new Map();
  private snapshotOrder: string[] = [];

  constructor(_options: FileSystemOptions = {}) {
  }

  /**
   * Initialize files from array
   */
  initializeFiles(projectFiles: { path: string; content: string }[]): void {
    this.files.clear();

    projectFiles.forEach(({ path, content }) => {
      this.setFile(path, content);
    });
  }

  /**
   * Get a file by path
   */
  getFile(path: string): VirtualFile | undefined {
    return this.files.get(path);
  }

  /**
   * Set file content
   */
  setFile(path: string, content: string): void {
    const existing = this.files.get(path);
    const file: VirtualFile = existing || {
      name: path.split('/').pop() || path,
      path,
      type: 'file',
    };

    file.content = content;
    file.size = content.length;
    file.lastModified = Date.now();

    this.files.set(path, file);
    this.recordOperation('update', path);
  }

  /**
   * Create directory
   */
  createDirectory(path: string): void {
    if (this.files.has(path)) return;

    const file: VirtualFile = {
      name: path.split('/').pop() || path,
      path,
      type: 'directory',
      children: [],
    };

    this.files.set(path, file);
    this.recordOperation('create', path);
  }

  /**
   * Delete file
   */
  deleteFile(path: string): boolean {
    const deleted = this.files.delete(path);
    if (deleted) {
      this.recordOperation('delete', path);
    }
    return deleted;
  }

  /**
   * Rename file
   */
  renameFile(oldPath: string, newPath: string): boolean {
    const file = this.files.get(oldPath);
    if (!file) return false;

    file.path = newPath;
    file.name = newPath.split('/').pop() || newPath;
    file.lastModified = Date.now();

    this.files.delete(oldPath);
    this.files.set(newPath, file);
    this.recordOperation('rename', newPath, oldPath);

    return true;
  }

  /**
   * Get file tree
   */
  getFileTree(): VirtualFile[] {
    const root: VirtualFile[] = [];
    const processed = new Set<string>();

    Array.from(this.files.values())
      .sort((a, b) => a.path.localeCompare(b.path))
      .forEach((file) => {
        if (processed.has(file.path)) return;

        const parts = file.path.split('/');
        let currentLevel = root;
        let currentPath = '';

        parts.forEach((part, index) => {
          currentPath = currentPath ? `${currentPath}/${part}` : part;

          if (!processed.has(currentPath)) {
            const existing = this.files.get(currentPath);
            if (existing) {
              processed.add(currentPath);
            }

            const node: VirtualFile = existing || {
              name: part,
              path: currentPath,
              type: index === parts.length - 1 ? 'file' : 'directory',
            };

            const existingInLevel = currentLevel.find(item => item.name === part);
            if (!existingInLevel) {
              currentLevel.push(node);
            }

            currentLevel = existingInLevel?.children || (node as any).children || [];
          } else {
            currentLevel = currentLevel.find(item => item.name === part)?.children || [];
          }
        });
      });

    return root;
  }

  /**
   * Export all files as array
   */
  exportFiles(): { path: string; content: string }[] {
    return Array.from(this.files.values())
      .filter(file => file.type === 'file' && file.content !== undefined)
      .map(file => ({
        path: file.path,
        content: file.content || '',
      }));
  }

  /**
   * Search files by query
   */
  searchFiles(query: string): VirtualFile[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.files.values()).filter(file =>
      file.name.toLowerCase().includes(lowerQuery) ||
      file.path.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get operations history
   */
  getOperations(): FileOperation[] {
    return [...this.operations];
  }

  /**
   * Clear all files
   */
  clear(): void {
    this.files.clear();
    this.operations = [];
    this.snapshots.clear();
    this.snapshotOrder = [];
  }

  /**
   * Create in-memory snapshot for rollback
   */
  createSnapshot(label?: string): string {
    const id = `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const clonedFiles = new Map<string, VirtualFile>();
    this.files.forEach((value, key) => {
      clonedFiles.set(key, JSON.parse(JSON.stringify(value)));
    });
    const clonedOperations = this.operations.map(op => ({ ...op }));

    this.snapshots.set(id, {
      files: clonedFiles,
      operations: clonedOperations,
      createdAt: Date.now(),
      label,
    });
    this.snapshotOrder.push(id);

    // Keep only last 20 snapshots
    if (this.snapshotOrder.length > 20) {
      const removed = this.snapshotOrder.shift();
      if (removed) {
        this.snapshots.delete(removed);
      }
    }

    return id;
  }

  /**
   * Rollback file system state to a previous snapshot
   */
  rollback(snapshotId: string): boolean {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      return false;
    }

    this.files = new Map<string, VirtualFile>();
    snapshot.files.forEach((value, key) => {
      this.files.set(key, JSON.parse(JSON.stringify(value)));
    });
    this.operations = snapshot.operations.map(op => ({ ...op }));
    return true;
  }

  /**
   * List available snapshots
   */
  listSnapshots(): FileSystemSnapshot[] {
    return this.snapshotOrder
      .map(id => {
        const snapshot = this.snapshots.get(id);
        if (!snapshot) return null;
        return {
          id,
          label: snapshot.label,
          createdAt: snapshot.createdAt,
        } as FileSystemSnapshot;
      })
      .filter((item): item is FileSystemSnapshot => Boolean(item));
  }

  /**
   * Record file operation
   */
  private recordOperation(type: FileOperation['type'], path: string, oldPath?: string): void {
    this.operations.push({
      type,
      path,
      oldPath,
      timestamp: Date.now(),
    });

    // Keep only last 100 operations
    if (this.operations.length > 100) {
      this.operations = this.operations.slice(-100);
    }
  }
}

/**
 * Singleton instance
 */
let vfsInstance: VirtualFileSystem | null = null;

export function getVFS(): VirtualFileSystem {
  if (!vfsInstance) {
    vfsInstance = new VirtualFileSystem();
  }
  return vfsInstance;
}

export function resetVFS(): void {
  vfsInstance = null;
}
