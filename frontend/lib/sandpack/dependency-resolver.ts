export interface DependencyDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface DependencyResolutionResult {
  dependencies: Record<string, string>;
  diff: DependencyDiff;
  changed: boolean;
}

function normalizeDependencies(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, string> = {};
  for (const [key, version] of entries) {
    if (!key || typeof version !== 'string') {
      continue;
    }
    normalized[key] = version;
  }

  return normalized;
}

function resolvePackageDependencies(fileContent: string): Record<string, string> {
  const parsed = JSON.parse(fileContent) as {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };

  return {
    ...normalizeDependencies(parsed.dependencies),
    ...normalizeDependencies(parsed.devDependencies),
  };
}

function computeDiff(
  previous: Record<string, string>,
  next: Record<string, string>
): DependencyDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [name, version] of Object.entries(next)) {
    if (!(name in previous)) {
      added.push(name);
      continue;
    }
    if (previous[name] !== version) {
      changed.push(name);
    }
  }

  for (const name of Object.keys(previous)) {
    if (!(name in next)) {
      removed.push(name);
    }
  }

  return { added, removed, changed };
}

export function resolveDependencyMap(
  previousPackageJson: string | undefined,
  nextPackageJson: string
): DependencyResolutionResult {
  const nextDependencies = resolvePackageDependencies(nextPackageJson);
  const previousDependencies = previousPackageJson
    ? resolvePackageDependencies(previousPackageJson)
    : {};
  const diff = computeDiff(previousDependencies, nextDependencies);

  return {
    dependencies: nextDependencies,
    diff,
    changed: diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0,
  };
}

export function createDependencySignature(dependencies: Record<string, string>): string {
  const sortedEntries = Object.entries(dependencies).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return JSON.stringify(sortedEntries);
}
