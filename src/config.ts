function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (!configured || typeof configured !== 'string') return '';

  const trimmed = configured.trim();
  if (!trimmed) return '';

  return stripTrailingSlash(trimmed);
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}

export function getDeviceEnrollmentToken(): string | null {
  const configured = import.meta.env.VITE_DEVICE_ENROLLMENT_TOKEN;
  if (!configured || typeof configured !== 'string') return null;

  const trimmed = configured.trim();
  return trimmed ? trimmed : null;
}
