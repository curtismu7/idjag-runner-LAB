import { traceparent as newTraceparent } from './trace.js';
import { NetguardRefused } from './netguard.js';

// The one door out of this app. Every outbound request goes through call(), which asks the netguard first: only
// the user-configured PingFederate runtime origin is reachable (https, or loopback http for tests), never
// cross-origin redirects are followed, with a timeout and a body size cap. No other module may call fetch.

export const TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 256 * 1024;

export class OutboundRefused extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

export function assertAllowed(target, allowedOrigin) {
  let url;
  try { url = new URL(target); } catch { throw new OutboundRefused('bad_url', 'Not a URL'); }
  if (url.username || url.password) throw new OutboundRefused('credentials_in_url', 'Outbound URLs must not carry credentials');
  if (!allowedOrigin) throw new OutboundRefused('not_configured', 'No PingFederate runtime is configured');
  if (allowedOrigin.protocol === 'https:' && url.protocol !== 'https:') throw new OutboundRefused('not_https', 'Outbound calls are https only');
  if (allowedOrigin.protocol === 'http:' && url.protocol !== 'http:') throw new OutboundRefused('not_https', 'Outbound calls must use the configured scheme');
  if (url.origin !== allowedOrigin.origin) throw new OutboundRefused('other_origin', 'Outbound calls may only reach the configured PingFederate runtime');
  return url;
}

async function readCapped(response, max) {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > max) {
      chunks.push(value.subarray(0, max - total));
      await reader.cancel().catch(() => {});
      return { text: Buffer.concat(chunks).toString('utf8'), truncated: true };
    }
    chunks.push(value);
    total += value.length;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated: false };
}

export function createOutbound({ getAllowedOrigin, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BODY_BYTES }) {
  // { url, method, headers, body, traceId } -> { status, ok, headers, text, json, truncated, traceparent }
  async function call(target, { method = 'GET', headers = {}, body, traceId } = {}) {
    const url = assertAllowed(target, getAllowedOrigin());
    const tp = newTraceparent(traceId);
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers: { ...headers, traceparent: tp },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof NetguardRefused) throw new OutboundRefused('netguard', error.message);
      throw new OutboundRefused('unreachable', 'PingFederate did not answer');
    }
    let text;
    let truncated;
    try { ({ text, truncated } = await readCapped(response, maxBytes)); } catch {
      throw new OutboundRefused('unreachable', 'PingFederate stopped answering mid-reply');
    }
    let json = null;
    if (!truncated && text) { try { json = JSON.parse(text); } catch { json = null; } }
    // The IdP ties a pi.flow to its session cookies; the caller replays them (a lab-session cookie jar).
    const setCookie = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    // A redirect is reported, never followed. Its target is shown only when it stays on the configured origin.
    let location = null;
    const raw = response.headers.get('location');
    if (raw) {
      try {
        const next = new URL(raw, url);
        location = next.origin === url.origin ? `${next.origin}${next.pathname}` : '<another origin, not followed>';
      } catch { location = '<unparsable, not followed>'; }
    }
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      headers: response.headers,
      text,
      json: json && typeof json === 'object' ? json : null,
      truncated,
      location,
      setCookie,
      traceparent: tp,
    };
  }
  return { call };
}
