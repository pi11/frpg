/** Magic-link token from `https://<host>/login?token=…`, or null for any other URL. */
export function magicTokenFrom(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.replace(/\/+$/, '') !== '/login') return null;
    return parsed.searchParams.get('token') || null;
  } catch {
    return null;
  }
}
