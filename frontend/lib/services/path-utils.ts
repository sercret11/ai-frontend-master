export function canonicalizeProjectPath(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return '';
  }

  const normalizedSegments: string[] = [];
  const segments = trimmed.replace(/\\/g, '/').split('/');

  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (normalizedSegments.length > 0) {
        normalizedSegments.pop();
      }
      continue;
    }

    normalizedSegments.push(segment);
  }

  return normalizedSegments.join('/');
}

export function splitProjectPath(input: string): string[] {
  const normalized = canonicalizeProjectPath(input);
  if (!normalized) {
    return [];
  }
  return normalized.split('/').filter(Boolean);
}

export function normalizeProjectFiles<T extends { path: string; content: string }>(
  files: readonly T[]
): Array<{ path: string; content: string }> {
  const map = new Map<string, string>();
  for (const file of files) {
    const normalizedPath = canonicalizeProjectPath(file.path);
    if (!normalizedPath) {
      continue;
    }
    map.set(normalizedPath, file.content);
  }

  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ path, content }));
}
