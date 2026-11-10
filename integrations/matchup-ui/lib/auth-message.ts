export function signInErrorMessage(error: unknown): string {
  const value = error as { code?: string; message?: string; status?: number } | null;
  if (/invalid.*api.?key|invalid.*publishable|invalid.*jwt/i.test(value?.message || '')) return 'The portal’s sign-in connection is unavailable. Please refresh or contact AMG.';
  if (value?.status === 429 || /rate.limit|over_request_rate_limit/.test(value?.code || '')) return 'Too many sign-in attempts. Wait a moment, then try again.';
  if (value?.code === 'invalid_credentials' || /invalid login credentials/i.test(value?.message || '')) return 'That email or password was not accepted. Check it and try again.';
  if (/fetch|network|timeout/i.test(value?.message || '')) return 'We couldn’t reach sign-in. Check your connection and try again.';
  return 'Sign-in could not be completed. Please try again.';
}
