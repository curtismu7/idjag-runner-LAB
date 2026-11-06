import crypto from 'node:crypto';

// Every PingFederate call is recorded as a trace step and shown raw, for teaching. Redaction happens here, on the
// server, before anything reaches the page:
// - SECRET values (client secrets, passwords, refresh tokens, client assertions) are replaced by a fixed marker that
//   keeps only kind and length.
// - TOKENS (access, id, subject tokens, the ID-JAG) are shown masked (first 6 + last 4 characters, length, kind)
//   next to their decoded claims.
// Identifiers that are not secret (client_id, scope, resource, grant_type) are shown as sent.

export const SECRET_KEYS = new Set([
  'client_secret', 'password', 'refresh_token', 'authorization', 'client_assertion', 'client_secret',
  'assertion', 'cookie', 'set-cookie',
]);
export const TOKEN_KEYS = new Set(['access_token', 'id_token', 'subject_token', 'actor_token', 'id_jag']);
const SHORTEN_KEYS = new Set(['state', 'nonce', 'jti']);

const kindOf = (text) => (text.split('.').length === 3 ? 'JWT' : 'opaque');

export function redacted(value) {
  const text = String(value);
  return `<redacted ${kindOf(text)}, ${text.length} chars>`;
}

export function masked(value) {
  const text = String(value);
  if (text.length <= 16) return { masked: '<too short to mask>', length: text.length, kind: kindOf(text) };
  return { masked: `${text.slice(0, 6)}...${text.slice(-4)}`, length: text.length, kind: kindOf(text) };
}

export function shortened(value) {
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 8)}...` : text;
}

export function safeValue(key, value) {
  if (value === undefined || value === null) return value;
  const k = String(key).toLowerCase();
  if (SECRET_KEYS.has(k)) return redacted(value);
  if (TOKEN_KEYS.has(k)) return masked(value);
  if (SHORTEN_KEYS.has(k)) return shortened(value);
  return value;
}

const MAX_DEPTH = 6;

// Walks plain JSON (iteratively bounded by depth) and redacts by key. Anything deeper than MAX_DEPTH is dropped.
export function safeBody(body, depth = 0) {
  if (body === null || typeof body !== 'object') return body;
  if (depth >= MAX_DEPTH) return '<nested too deep>';
  if (Array.isArray(body)) return body.slice(0, 50).map((item) => safeBody(item, depth + 1));
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== null && typeof value === 'object') {
      out[key] = SECRET_KEYS.has(key.toLowerCase()) ? redacted(JSON.stringify(value)) : safeBody(value, depth + 1);
    } else out[key] = safeValue(key, value);
  }
  return out;
}

export function safeParams(params) {
  const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params || {});
  const out = {};
  for (const [key, value] of entries) out[key] = safeValue(key, value);
  return out;
}

export function safeHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const k = key.toLowerCase();
    if (k === 'authorization') out[key] = `${String(value).split(' ')[0]} <redacted>`;
    else if (k === 'cookie') out[key] = '<redacted cookies>';
    else out[key] = safeValue(k, value);
  }
  return out;
}

// The URL without its query (parameters are shown separately, redacted).
export function bareUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch { return String(value).split('?')[0]; }
}

function decodePart(part) {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

// Decoded claims of a JWT (no signature check here), or null for an opaque token.
export function claimsOf(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  return parts.length === 3 ? decodePart(parts[1]) : null;
}

export function headerOf(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  return parts.length === 3 ? decodePart(parts[0]) : null;
}

// What the page may show about a token: masked value plus header and claims.
export function tokenView(token) {
  if (typeof token !== 'string' || !token) return null;
  return { ...masked(token), header: headerOf(token), claims: claimsOf(token) };
}

// W3C trace context: one trace id per flow run, a new span id per hop.
export function newTraceId() { return crypto.randomBytes(16).toString('hex'); }
export function traceparent(traceId = newTraceId()) {
  return `00-${traceId}-${crypto.randomBytes(8).toString('hex')}-01`;
}

export function step({ id, title, request = null, response = null, claims = null, note = null }) {
  return { id, title, request, response, claims, note };
}
