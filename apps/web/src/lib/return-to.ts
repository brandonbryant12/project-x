/**
 * The same-origin path to land on after signing in (a notification's deep
 * link). Anything that could leave the origin, such as `//host` or `/\host`,
 * or that would loop back to sign-in, falls back to Home.
 */
export const safeReturnPath = (next: string | undefined): string => {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  try {
    const url = new URL(next, 'https://same-origin.invalid');
    if (url.origin !== 'https://same-origin.invalid') return '/';
    if (url.pathname === '/sign-in' || url.pathname.startsWith('/sign-in/')) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
};

/** The Microsoft sign-in start, carrying where to come back to (the server re-checks it). */
export const entraStartHref = (next: string | undefined) => {
  const back = safeReturnPath(next);
  return back === '/'
    ? '/api/auth/entra/start'
    : `/api/auth/entra/start?returnTo=${encodeURIComponent(back)}`;
};
