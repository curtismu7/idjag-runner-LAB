// The netguard: what outbound.js hands every request to instead of the raw fetch. A request may only reach the
// one user-configured PingFederate runtime origin (loopback http is allowed for tests). Anything else is refused
// before a socket is opened. It counts both allowed and refused attempts, for the self-test and the tests.

export class NetguardRefused extends Error {}

const LOOPBACK = /^(127\.|localhost|\[::1\]|::1)/;

export function isAllowedOrigin(url, allowedOrigin) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (allowedOrigin.protocol === 'https:') return parsed.origin === allowedOrigin.origin;
  // Test mode: the configured runtime is loopback http.
  return parsed.origin === allowedOrigin.origin && LOOPBACK.test(parsed.hostname);
}

export function createNetguard({ getAllowedOrigin, realFetch = globalThis.fetch }) {
  const stats = { allowedCalls: 0, refused: 0, realAttempts: 0 };

  async function fetchImpl(url, init) {
    const allowed = getAllowedOrigin();
    if (!allowed || !isAllowedOrigin(url, allowed)) {
      stats.refused += 1;
      throw new NetguardRefused('Outbound refused: only the configured PingFederate runtime origin is reachable');
    }
    stats.allowedCalls += 1;
    stats.realAttempts += 1;
    return realFetch(url, init);
  }

  // Proves the guard holds without touching the network: a real URL must be refused and the real fetch must not
  // have been called by the refusal path. Returns { ok, checks } and leaves the counters as they were.
  async function selfTest() {
    const before = { ...stats };
    const checks = [];
    let refused = false;
    try { await fetchImpl('https://runtime.invalid/.well-known/openid-configuration', { method: 'GET' }); } catch (error) { refused = error instanceof NetguardRefused; }
    checks.push({ name: 'a non-configured origin is refused', ok: refused });
    checks.push({ name: 'the real fetch is never called for a refused URL', ok: stats.realAttempts === before.realAttempts });
    Object.assign(stats, before);
    return { ok: checks.every((c) => c.ok), checks };
  }

  return { fetchImpl, selfTest, stats: () => ({ ...stats }) };
}
