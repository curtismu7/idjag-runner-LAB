import crypto from 'node:crypto';
import { OutboundRefused } from './outbound.js';
import { safeBody, safeHeaders, safeParams, bareUrl, claimsOf, headerOf, step } from './trace.js';

// The PingFederate client for the ID-JAG demo: discovery (cached 5 min), the pi.flow sign-in (rule 16: login is
// pi.flow only — authorize with response_mode=pi.flow, the flows API checkUsernamePassword step, then the code for
// tokens), the refresh grant, the RFC 8693 token exchange that mints an ID-JAG, its jwt-bearer redeem at the
// resource client, and introspection. Every hop returns a trace step (redacted request/response plus the W3C
// traceparent it carried). Replaces the former resource-owner password grant (deprecated in OAuth 2.1).

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
const b64url = (b) => Buffer.from(b).toString('base64url');
// PF's flows API (pi.flow): the checkUsernamePassword step, with its vendor content type and XSRF header.
const CHECK_USERNAME_PASSWORD = 'application/vnd.pingidentity.checkUsernamePassword+json';
// The redirect PF validates at authorize and again at the token exchange (it must match exactly). pi.flow never
// serves or follows this URL; it is the demo client's registered callback.
const REDIRECT_URI = 'https://oauth.pstmn.io/v1/callback';

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
      authorizationEndpoint: endpoint('authorization_endpoint'),
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

  // Act 1a: the pi.flow sign-in, phase 1 — open the flow (authorize, PKCE S256, response_mode=pi.flow; the
  // redirect_uri is only validated by PF, never served or followed). Returns the flow id and the PKCE/state
  // material plus the PF session cookie jar the submit phase replays; all of it stays in the lab session.
  async function piFlowStart({ scope, clientId, clientSecret, traceId }) {
    const { metadata } = await discover({ traceId });
    const verifier = b64url(crypto.randomBytes(32));
    const state = b64url(crypto.randomBytes(16));
    const nonce = b64url(crypto.randomBytes(16));
    const url = new URL(metadata.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', scope || 'openid');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('response_mode', 'pi.flow');
    const result = await call(url.toString(), { method: 'GET', headers: { Accept: 'application/json' }, traceId });
    const flow = result.json || {};
    const step = hop({ id: 'act1-piflow-start', title: 'Authorize (response_mode=pi.flow, PKCE S256)', method: 'GET', url: metadata.authorizationEndpoint, params: Object.fromEntries(url.searchParams), result });
    const jar = {};
    for (const c of result.setCookie ?? []) { const kv = String(c).split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1); }
    return { result, step, flowId: typeof flow.id === 'string' ? flow.id : null, flowStatus: flow.status ?? null, verifier, state, nonce, jar };
  }

  // Act 1a: the pi.flow sign-in, phase 2 — submit the credentials to the flows API (checkUsernamePassword), then
  // trade the authorizeResponse code for tokens with the PKCE verifier. The password is used once here and kept
  // only in the lab session for Act 4's wrong-scope probe (which now probes the authorize step instead).
  async function piFlowSubmit({ flowId, verifier, state, nonce, username, password, scope, clientId, clientSecret, traceId, jar = {} }) {
    const { metadata } = await discover({ traceId });
    // PF's flows API lives under /pf-ws/authn and wants the vendor content type + the XSRF header + the flow cookie.
    const checkUrl = new URL(metadata.issuer);
    checkUrl.pathname = '/pf-ws/authn/flows/' + encodeURIComponent(flowId);
    const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const result = await call(checkUrl.toString(), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': CHECK_USERNAME_PASSWORD, 'X-XSRF-Header': 'PingFederate', ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
      body: JSON.stringify({ username, password }),
      traceId,
    });
    const flow = result.json || {};
    const step = hop({ id: 'act1-piflow-credentials', title: 'Flows API: username and password (checkUsernamePassword)', method: 'POST', url: checkUrl.toString(), params: { username, password: '<typed in the form; never shown>' }, result });
    if (!result.ok) return { result, step, tokens: null };
    const code = flow.authorizeResponse?.code;
    if (flow.status !== 'COMPLETED' || typeof code !== 'string') {
      return { result, step, tokens: null, incomplete: flow.status ?? 'unknown' };
    }
    if (flow.authorizeResponse.state !== state) {
      return { result, step, tokens: null, badState: true };
    }
    const token = await tokenRequest({
      id: 'act1-token', title: 'Token: the code for tokens (PKCE verifier)',
      clientId, clientSecret,
      params: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT_URI },
      traceId,
    });
    return { result: token.result, step: token.step, tokens: token.result.ok ? token.result.json : null };
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
    runtime, discover, piFlowStart, piFlowSubmit, refreshGrant, tokenExchange, jwtBearer, introspect, refusalProbe, jwtView,
    clearCache: () => { cache = null; },
  };
}
