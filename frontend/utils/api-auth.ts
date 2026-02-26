export function resolveApiBearerToken(): string | null {
  const envToken = import.meta.env['VITE_API_AUTH_TOKEN'];
  if (typeof envToken === 'string' && envToken.trim()) {
    return envToken.trim();
  }

  try {
    const storedToken = localStorage.getItem('api_auth_token');
    if (storedToken?.trim()) {
      return storedToken.trim();
    }
  } catch {
    // Ignore storage access errors (SSR/private mode).
  }

  return null;
}

export function withApiAuthHeaders(
  headers?: HeadersInit
): HeadersInit {
  const token = resolveApiBearerToken();
  const baseHeaders = new Headers(headers || {});
  if (token) {
    baseHeaders.set('Authorization', `Bearer ${token}`);
  }
  return baseHeaders;
}

