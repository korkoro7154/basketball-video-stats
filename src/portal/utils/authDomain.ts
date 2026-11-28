export const PRODUCTION_AUTH_PROXY_HOST = 'basketball-video-stats.vercel.app';

export function resolveFirebaseAuthDomain(options: {
  envAuthDomain?: string | null;
  hostname?: string | null;
}): string {
  const normalizedHost = (options.hostname ?? '').trim().toLowerCase();
  if (normalizedHost === PRODUCTION_AUTH_PROXY_HOST) {
    return PRODUCTION_AUTH_PROXY_HOST;
  }
  return (options.envAuthDomain ?? '').trim();
}
