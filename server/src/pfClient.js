import { OutboundRefused } from './outbound.js';
import { safeBody, safeHeaders, safeParams, bareUrl, claimsOf, headerOf, step } from './trace.js';

// The PingFederate client for the ID-JAG demo: discovery (cached 5 min), the password grant, the refresh grant,
// the RFC 8693 token exchange that mints an ID-JAG, its jwt-bearer redeem at the resource client, and
// introspection. Every hop returns a trace step (redacted request/response plus the W3C traceparent it carried).

export class LabError extends Error {
  constructor(code, message, status = 502, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export const ID_JAG_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id-jag';
export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const SUBJECT_TYPES = ['id_token', 'refresh_token', 'access_token'];

const DISCOVERY_TTL_MS = 5 * 60 * 1000;
const basic = (id, secret) => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;

// A recorded hop: the request as sent (redacted), PingFederate's answer (redacted) and the traceparent it carried.
export function hop({ id, title, method, url, headers = {}, params = null, result, claims = null, note = null }) {
  return step({
    id,
    title,
    request: {
      method,
      url: bareUrl(url),
      headers: safeHeaders({ ...headers, traceparent: result?.traceparent }),
      ...(params ? { params: safeParams(params) } : {}),
    },
    response: result ? {
      status: result.status,
      body: result.json ? safeBody(result.json) : (result.text ? '<not JSON>' : null),
    } : null,
    claims,
    note,
  });
}

function asLabError(error) {
  if (error instanceof LabError) return error;
  if (error instanceof OutboundRefused) {
    return new LabError(`outbound_${error.reason}`, error.message, error.reason === 'not_configured' ? 409 : 502);
  }
  return error;
}

export function createPfClient({ outbound, settings, now = Date.now }) {
  let cache = null; // { origin, at, metadata }

  const runtime = () => settings.runtimeUrl();

  async function call(url, init) {
    try { return await outbound.call(url, init); } catch (error) { throw asLabError(error); }
  }

  function readMetadata(doc, origin) {
    if (!doc || typeof doc !== 'object') throw new LabError('discovery_invalid', 'Discovery is not JSON');
    const endpoint = (field) => {
      const value = doc[field];
      if (!value || typeof value !== 'string') return '';
      try { return new URL(value).toString(); } catch { return ''; }
    };
    const metadata = {
      issuer: doc.issuer || null,
      raw: doc,
      tokenEndpoint: endpoint('token_endpoint'),
      jwksUri: endpoint('jwks_uri'),
      introspectionEndpoint: endpoint('introspection_endpoint'),
    };
    if (!metadata.tokenEndpoint) throw new LabError('discovery_invalid', 'Discovery has no token_endpoint');
    return metadata;
  }

  // { metadata, step }. Cached for five minutes per runtime; `fresh` skips the cache.
  async function discover({ traceId, fresh = false } = {}) {
    const configured = runtime();
    if (!configured) throw new LabError('not_configured', 'Set the PingFederate runtime URL in Settings', 409);
    if (!fresh && cache && cache.origin === configured && now() - cache.at < DISCOVERY_TTL_MS) {
      return { metadata: cache.metadata, step: null };
    }
    const url = `${configured}/.well-known/openid-configuration`;
    const headers = { Accept: 'application/json' };
    const result = await call(url, { headers, traceId });
    const s = hop({ id: 'discovery', title: 'Read PingFederate discovery', method: 'GET', url, headers, result });
    if (result.status !== 200) throw new LabError('discovery_failed', `Discovery answered HTTP ${result.status}`, 502, { trace: [s] });
    let metadata;
    try { metadata = readMetadata(result.json, configured); } catch (error) { error.extra = { trace: [s] }; throw error; }
    cache = { origin: configured, at: now(), metadata };
    return { metadata, step: s };
  }

  const asForm = (params) => {
    const body = new URLSearchParams(params);
    return { body, contentType: 'application/x-www-form-urlencoded' };
  };

  // One form POST to the token endpoint with client_secret_basic auth. Returns the result plus a trace step.
  async function tokenRequest({ id, title, clientId, clientSecret, params, traceId }) {
    const { metadata } = await discover({ traceId });
    const url = metadata.tokenEndpoint;
    const form = asForm(params);
    const headers = {
      Accept: 'application/json',
      'Content-Type': form.contentType,
      Authorization: basic(clientId, clientSecret),
    };
    const result = await call(url, { method: 'POST', headers, body: form.body.toString(), traceId });
    const shownHeaders = { ...headers, Authorization: `Basic <${clientId}:client secret>` };
    const s = hop({ id, title, method: 'POST', url, headers: shownHeaders, params: form.body, result });
    return { result, step: s, params: form.body };
  }

  // Act 1a: password grant.
  async function passwordGrant({ username, password, scope, clientId, clientSecret, traceId }) {
    const params = { grant_type: 'password', username, password, scope: scope || '' };
    return tokenRequest({ id: 'act1-password', title: 'Resource-owner password grant', clientId, clientSecret, params, traceId });
  }

  // Act 1b: refresh grant (PingFederate issues an ID token on the refresh grant when OIDC is on the client).
  async function refreshGrant({ refreshToken, scope, clientId, clientSecret, traceId }) {
    const params = { grant_type: 'refresh_token', refresh_token: refreshToken, ...(scope ? { scope } : {}) };
    return tokenRequest({ id: 'act1-refresh', title: 'Refresh-token grant', clientId, clientSecret, params, traceId });
  }

  // Act 2: RFC 8693 token exchange. subjectKind picks the subject token: id_token, refresh_token or access_token.
  async function tokenExchange({ subjectToken, subjectKind, resource, scope, clientId, clientSecret, traceId }) {
    const subjectTokenType = {
      id_token: 'urn:ietf:params:oauth:token-type:id_token',
      refresh_token: 'urn:ietf:params:oauth:token-type:refresh_token',
      access_token: 'urn:ietf:params:oauth:token-type:access_token',
    }[subjectKind];
    if (!subjectTokenType) throw new LabError('bad_subject_kind', `subjectKind must be one of ${SUBJECT_TYPES.join(', ')}`, 400);
    const params = {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: subjectTokenType,
      requested_token_type: ID_JAG_TOKEN_TYPE,
      ...(resource ? { resource } : {}),
      ...(scope ? { scope } : {}),
    };
    return tokenRequest({ id: 'act2-exchange', title: 'RFC 8693 token exchange for an ID-JAG', clientId, clientSecret, params, traceId });
  }

  // Act 3a: jwt-bearer redeem of the ID-JAG at the resource-AS client.
  async function jwtBearer({ assertion, scope, clientId, clientSecret, traceId }) {
    const params = { grant_type: JWT_BEARER_GRANT, assertion, ...(scope ? { scope } : {}) };
    return tokenRequest({ id: 'act3-redeem', title: 'jwt-bearer redeem of the ID-JAG', clientId, clientSecret, params, traceId });
  }

  // Act 3b: introspection with a third client. The endpoint comes from discovery's introspection_endpoint when
  // advertised; otherwise the configured runtime's standard PF path (origin splice, never a JWKS-path rewrite).
  async function introspect({ token, clientId, clientSecret, traceId }) {
    const { metadata } = await discover({ traceId });
    let url = metadata.introspectionEndpoint;
    if (!url) {
      const origin = new URL(runtime()).origin;
      url = `${origin}/as/introspect.oauth2`;
    }
    const form = asForm({ token });
    const headers = {
      Accept: 'application/json',
      'Content-Type': form.contentType,
      Authorization: basic(clientId, clientSecret),
    };
    const result = await call(url, { method: 'POST', headers, body: form.body.toString(), traceId });
    const shownHeaders = { ...headers, Authorization: `Basic <${clientId}:client secret>` };
    const s = hop({ id: 'act3-introspect', title: 'Introspect the redeemed access token', method: 'POST', url, headers: shownHeaders, params: form.body, result });
    return { result, step: s };
  }

  // Act 4 helper: a refusal case is the same call with wrong inputs; the test asserts PingFederate's error.
  async function refusalProbe({ caseName, clientId, clientSecret, params, traceId }) {
    return tokenRequest({ id: `act4-${caseName}`, title: `Refusal case: ${caseName}`, clientId, clientSecret, params, traceId });
  }

  // What the page may show about a JWT: masked value, header and claims. The ID-JAG header (typ: oauth-id-jag+jwt)
  // and its claims (iss/aud/sub/exp/scope/resource) are the teaching payload.
  const jwtView = (token) => {
    if (typeof token !== 'string' || !token) return null;
    return { header: headerOf(token), claims: claimsOf(token) };
  };

  return {
    runtime, discover, passwordGrant, refreshGrant, tokenExchange, jwtBearer, introspect, refusalProbe, jwtView,
    clearCache: () => { cache = null; },
  };
}
