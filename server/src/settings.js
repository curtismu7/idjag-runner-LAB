// The user-configured PingFederate runtime URL. This is an "any PF runtime URL" field by design: every https
// origin is accepted, whatever the host or port (owner decision, 2026-11-06). Loopback http is allowed for tests.
// Default: the owner's demo PingFederate (idjag-* objects are pre-created there). Secrets are never stored here.

export const DEFAULT_RUNTIME_URL = 'https://cmuir-pf-acme.ping-devops.com';
const LOOPBACK = /^(127\.|localhost|\[::1\]|::1)/i;

export class SettingsError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

export function validateRuntimeUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new SettingsError('runtimeUrl', 'The runtime URL is not a valid URL'); }
  if (url.username || url.password) throw new SettingsError('runtimeUrl', 'The runtime URL must not carry credentials');
  if (url.pathname !== '/' && url.pathname !== '') throw new SettingsError('runtimeUrl', 'The runtime URL must be an origin only (no path)');
  if (url.search || url.hash) throw new SettingsError('runtimeUrl', 'The runtime URL must be an origin only (no query or fragment)');
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && LOOPBACK.test(url.hostname)) return url.origin;
  throw new SettingsError('runtimeUrl', 'The runtime URL must be https (loopback http is allowed for tests only)');
}

export function createSettings({ defaultRuntimeUrl = DEFAULT_RUNTIME_URL } = {}) {
  let runtimeUrl = defaultRuntimeUrl;
  return {
    defaultRuntimeUrl: defaultRuntimeUrl,
    runtimeUrl: () => runtimeUrl,
    setRuntimeUrl(value) { runtimeUrl = validateRuntimeUrl(value); },
    publicView: () => ({ runtimeUrl, defaultRuntimeUrl }),
  };
}
