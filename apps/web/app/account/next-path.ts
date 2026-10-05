const nextPaths = ['/console', '/arena'] as const;

/**
 * The page to open after sign-in, from the `next` query parameter. Only known
 * pages are allowed, so a crafted link cannot send people to another site.
 */
export function nextPathFrom(search: string): string {
  const next = new URLSearchParams(search).get('next');
  return nextPaths.find((path) => path === next) ?? '/console';
}
