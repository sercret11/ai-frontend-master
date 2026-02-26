import path from 'path';

const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:[\\/]/;
const UNC_PREFIX = /^\\\\/;

function toPosixPath(input: string): string {
  return input.replace(/\\/g, '/');
}

function isAbsoluteLike(input: string): boolean {
  return input.startsWith('/') || WINDOWS_DRIVE_PREFIX.test(input) || UNC_PREFIX.test(input);
}

export function normalizeWorkspaceRelativePath(rawPath: string): string {
  const trimmed = (rawPath || '').trim();
  if (!trimmed) {
    throw new Error('Path must not be empty');
  }

  const posixInput = toPosixPath(trimmed);
  if (isAbsoluteLike(posixInput)) {
    throw new Error('Absolute paths are not allowed');
  }

  const normalized = path.posix.normalize(posixInput);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Path traversal is not allowed');
  }

  if (normalized.includes('/../') || normalized.includes('\0')) {
    throw new Error('Invalid path');
  }

  return normalized.replace(/^\.\/+/, '');
}

export function resolvePathWithinBase(baseDir: string, relativePath: string): string {
  const safeRelativePath = normalizeWorkspaceRelativePath(relativePath);
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, safeRelativePath);
  const relative = path.relative(resolvedBase, resolvedTarget);

  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Resolved path escapes base directory: ${relativePath}`);
  }

  return resolvedTarget;
}

