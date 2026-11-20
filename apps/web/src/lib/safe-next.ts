/**
 * Only allow redirects to our own paths after login, never to another site
 * (`//evil.com`, `https://…`, `/\\evil.com`).
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\') || value.startsWith('/login')) return '/';
  return value;
}
