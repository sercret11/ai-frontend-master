export function normalizeApiBaseUrl(apiUrl: string): string {
  const trimmed = apiUrl.replace(/\/+$/, '');

  if (trimmed.includes('/api/runtime/sessions/')) {
    return trimmed.replace(/\/api\/runtime\/sessions\/.*$/, '');
  }

  if (trimmed.includes('/api/runtime/context7/research')) {
    return trimmed.replace(/\/api\/runtime\/context7\/research.*$/, '');
  }

  return trimmed
    .replace(/\/api\/chat\/stream$/, '')
    .replace(/\/chat\/stream$/, '')
    .replace(/\/api$/, '');
}

