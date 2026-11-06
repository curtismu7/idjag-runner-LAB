import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createPfClient, LabError, ID_JAG_TOKEN_TYPE, JWT_BEARER_GRANT, SUBJECT_TYPES } from './pfClient.js';
import { createOutbound } from './outbound.js';
import { createNetguard } from './netguard.js';
import { createSessions, validWorkspace, DEFAULT_WORKSPACE } from './session.js';
import { createSettings, SettingsError, validateRuntimeUrl, DEFAULT_RUNTIME_URL } from './settings.js';
import { newTraceId, tokenView, safeBody } from './trace.js';
import { mountShelfRoute } from './shelf-link/shelf.js';

export const DEMO = { id: 'idjag-runner', name: 'ID-JAG Runner', version: '0.1.0' };
const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
// Demo client credentials created by the ID-JAG setup collection on the target PingFederate.
// These are demo-only values from the SE guide (idjag-* objects); they let the flow run with
// just a password. A custom PF (different prefix) still works by passing clientId/clientSecret.
const DEMO_CLIENT_SECRETS = {
  'idjag-ac-client': 'idjagAcSecret1234',
  'idjag-ras-client': 'rasSecret1234',
  'idjag-introspect': 'introSecret1234',
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

// Every error is JSON with a fixed code; LabError adds a page-ready message and, when PingFederate was already
// called, the redacted trace up to the failure. No stack, path or secret ever reaches the client.
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof LabError) {
    const body = { error: err.code, message: err.message, ...(err.extra?.trace ? { trace: err.extra.trace } : {}) };
    return res.status(err.status).json(body);
  }
  if (err instanceof SettingsError) return res.status(400).json({ error: 'invalid_setting', field: err.field, message: err.message });
  const status = Number(err?.status ?? err?.statusCode);
  if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
  if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
  console.error('[idjag-runner] unexpected error:', err?.name || 'Error'); // never the message: it could carry a secret
  return res.status(500).json({ error: 'server_error' });
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((body) => {
  if (!res.headersSent) res.set('Cache-Control', 'no-store').json(body);
}).catch(next);

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export function labAddresses({ port, env = process.env }) {
  const scheme = env.LAB_TLS_CERT && env.LAB_TLS_KEY ? 'https' : 'http';
  const extra = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  for (const h of extra) if (!HOSTNAME.test(h)) throw Object.assign(new Error(`LAB_ALLOWED_HOSTS: not a host name: ${h}`), { field: 'env' });
  const names = ['127.0.0.1', 'localhost', '[::1]', ...extra];
  return {
    scheme,
    hosts: new Set(names.map((n) => `${n}:${port}`)),
    origins: new Set(names.map((n) => `${scheme}://${n}:${port}`)),
  };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const requireFields = (body, names) => {
  for (const n of names) if (!str(body?.[n])) throw new LabError('missing_field', `${n} is required`, 400);
};

export function createApp({ port, fetchImpl = globalThis.fetch, now = Date.now, webDist = DEFAULT_WEB_DIST, env = process.env, defaultRuntimeUrl = DEFAULT_RUNTIME_URL } = {}) {
  const settings = createSettings({ defaultRuntimeUrl });
  const netguard = createNetguard({ getAllowedOrigin: () => { try { return new URL(settings.runtimeUrl()); } catch { return null; } }, realFetch: fetchImpl });
  const outbound = createOutbound({ getAllowedOrigin: () => { try { return new URL(settings.runtimeUrl()); } catch { return null; } }, fetchImpl: netguard.fetchImpl });
  const pf = createPfClient({ outbound, settings, now });
  const addresses = labAddresses({ port, env });
  const sessions = createSessions({ now, secure: addresses.scheme === 'https' });

  const app = express();
  app.locals.netguard = netguard;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP });
    next();
  });
  const allowedHosts = addresses.hosts;
  const allowedOrigins = addresses.origins;

  app.use((req, res, next) => {
    if (!allowedHosts.has(req.headers.host ?? '')) return res.status(403).json({ error: 'host_not_allowed' });
    return next();
  });

  // GET only, no detail (demo-health/1). Behind the Host check, so DNS rebinding cannot read it.
  app.get('/api/health', (req, res) => {
    res.set('Cache-Control', 'no-store').json({
      schema: 'demo-health/1',
      at: new Date(now()).toISOString(),
      state: 'ready',
      runtime: 'live',
      demo: DEMO,
    });
  });

  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: 'cross_origin_write_refused' });
    if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'cross_origin_write_refused' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: 'json_required' });
    return next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use(sessions.middleware);

  // Family convention: GET /api/shelf returns the launcher URL (SHELF_URL env or the shared
  // settings file); unconfigured means shelfUrl null and the header button stays hidden.
  const apiRouter = express.Router();
  mountShelfRoute(apiRouter, { env });
  app.use('/api', apiRouter);

  app.get('/api/info', wrap((req) => ({
    demo: DEMO,
    runtimeUrl: settings.runtimeUrl(),
    defaultRuntimeUrl,
    workspace: req.session.workspace,
    mode: 'live',
  })));

  // The runtime URL is the only saved setting; client secrets are per-request and per-session, write-only.
  app.post('/api/settings', wrap((req) => {
    const runtimeUrl = validateRuntimeUrl(str(req.body?.runtimeUrl));
    settings.setRuntimeUrl(runtimeUrl);
    pf.clearCache();
    return { runtimeUrl };
  }));
  app.get('/api/settings', wrap(() => settings.publicView()));

  // Act 1: password grant, then the refresh grant (which returns the ID token).
  app.post('/api/flow/act1', wrap(async (req) => {
    const body = req.body || {};
    // Demo defaults (SE guide setup): only the password is truly required.
    requireFields(body, ['password']);
    const act1ClientId = str(body.clientId) || 'idjag-ac-client';
    const act1Secret = str(body.clientSecret) || DEMO_CLIENT_SECRETS[act1ClientId] || '';
    if (act1Secret) req.session.secrets.act1 = act1Secret;
    // The password is kept in session memory only (like the client secret) so Act 4's
    // access-denied case can re-run the grant with a forbidden scope. Never returned by any API.
    if (str(body.password)) req.session.secrets.password = str(body.password);
    if (str(body.username)) req.session.username = str(body.username);
    const traceId = newTraceId();
    const trace = [];
    const first = await pf.passwordGrant({
      username: str(body.username) || 'demouser', password: str(body.password), scope: str(body.scope) || 'openid chat.read chat.history',
      clientId: act1ClientId, clientSecret: act1Secret, traceId,
    });
    trace.push(first.step);
    if (!first.result.ok) throw new LabError('act1_failed', `The password grant was refused (HTTP ${first.result.status})`, 502, { trace });
    const tokens = { ...first.result.json };
    let refresh = null;
    if (tokens.refresh_token) {
      refresh = await pf.refreshGrant({
        refreshToken: tokens.refresh_token, scope: str(body.scope) || 'openid chat.read chat.history',
        clientId: act1ClientId, clientSecret: act1Secret, traceId,
      });
      trace.push(refresh.step);
      if (refresh.result.ok && refresh.result.json?.id_token) tokens.id_token = refresh.result.json.id_token;
    }
    req.session.tokens.act1 = tokens;
    return {
      tokens: {
        accessToken: tokenView(tokens.access_token),
        refreshToken: tokens.refresh_token ? tokenView(tokens.refresh_token) : null,
        idToken: tokens.id_token ? tokenView(tokens.id_token) : null,
      },
      trace,
    };
  }));

  // Act 2: RFC 8693 exchange for the ID-JAG, in three subject variants.
  app.post('/api/flow/act2', wrap(async (req) => {
    const body = req.body || {};
    const kind = str(body.subjectKind);
    if (!SUBJECT_TYPES.includes(kind)) throw new LabError('bad_subject_kind', `subjectKind must be one of ${SUBJECT_TYPES.join(', ')}`, 400);
    const act2ClientId = str(body.clientId) || 'idjag-ac-client';
    const act2Secret = str(body.clientSecret) || DEMO_CLIENT_SECRETS[act2ClientId] || req.session.secrets.act1 || '';
    if (!act2Secret) throw new LabError('missing_field', 'clientSecret is required (or run Act 1 first to store one)', 400);
    if (act2Secret) req.session.secrets.act2 = act2Secret;
    const tokens = req.session.tokens.act1 || {};
    const subjectToken = str(body.subjectToken) ||
      (kind === 'id_token' ? tokens.id_token : kind === 'refresh_token' ? tokens.refresh_token : tokens.access_token);
    if (!subjectToken) throw new LabError('no_subject_token', `No ${kind} available: run Act 1 first, or pass subjectToken`, 409);
    const traceId = newTraceId();
    const ex = await pf.tokenExchange({
      subjectToken, subjectKind: kind, resource: str(body.resource) || 'https://api.resource.example.com/', scope: str(body.scope) || 'chat.read chat.history',
      clientId: act2ClientId, clientSecret: act2Secret, traceId,
    });
    req.session.lastTrace = [ex.step];
    if (!ex.result.ok) throw new LabError('act2_failed', `The token exchange was refused (HTTP ${ex.result.status})`, 502, { trace: [ex.step] });
    const idJag = ex.result.json?.issued_token || ex.result.json?.access_token || null;
    req.session.idJag = idJag;
    req.session.tokens.act2 = ex.result.json || {};
    return { idJag: tokenView(idJag), idJagHeader: pf.jwtView(idJag)?.header || null, idJagClaims: pf.jwtView(idJag)?.claims || null, tokenType: ID_JAG_TOKEN_TYPE, trace: [ex.step] };
  }));

  // Act 3a: jwt-bearer redeem of the ID-JAG at the resource-AS client.
  app.post('/api/flow/act3/redeem', wrap(async (req) => {
    const body = req.body || {};
    // Demo default: the resource-AS client from the SE guide setup, so only the password is required.
    const clientId = str(body.clientId) || 'idjag-ras-client';
    const clientSecret = str(body.clientSecret) || DEMO_CLIENT_SECRETS[clientId] || req.session.secrets.act1 || '';
    if (!clientSecret) throw new LabError('missing_field', 'clientSecret is required (or run Act 1 first to store one)', 400);
    const assertion = str(body.assertion) || req.session.idJag;
    if (!assertion) throw new LabError('no_id_jag', 'No ID-JAG available: run Act 2 first, or pass assertion', 409);
    const traceId = newTraceId();
    const r = await pf.jwtBearer({
      assertion, scope: str(body.scope), clientId, clientSecret, traceId,
    });
    req.session.lastTrace = [r.step];
    if (!r.result.ok) {
      // A refused redeem is a teaching moment (expired ID-JAG, wrong audience, wrong client),
      // not a lab error: surface it as a soft refusal the UI renders green.
      return { redeemRefusal: true, pfStatus: r.result.status, pfError: r.result.json?.error || null, pfErrorDescription: r.result.json?.error_description || null, trace: [r.step] };
    }
    req.session.tokens.act3 = r.result.json || {};
    return { tokens: { accessToken: tokenView(r.result.json?.access_token) }, trace: [r.step] };
  }));

  // Act 3b: introspection with a third client.
  app.post('/api/flow/act3/introspect', wrap(async (req) => {
    const body = req.body || {};
    const clientId = str(body.clientId) || 'idjag-introspect';
    const clientSecret = str(body.clientSecret) || DEMO_CLIENT_SECRETS[clientId] || req.session.secrets.act1 || '';
    if (!clientSecret) throw new LabError('missing_field', 'clientSecret is required (or run Act 1 first to store one)', 400);
    const token = str(body.token) || req.session.tokens.act3?.access_token;
    if (!token) throw new LabError('no_token', 'No access token to introspect: run Act 3 redeem first, or pass token', 409);
    const traceId = newTraceId();
    const r = await pf.introspect({ token, clientId, clientSecret, traceId });
    req.session.lastTrace = [r.step];
    if (!r.result.ok) throw new LabError('act3_introspect_failed', `Introspection was refused (HTTP ${r.result.status})`, 502, { trace: [r.step] });
    return { introspection: safeBody(r.result.json), trace: [r.step] };
  }));

  // Act 4: refusal cases. Each case makes the same kind of call with deliberately wrong inputs and returns
  // PingFederate's error as the teaching payload.
  const ACT4 = {
    unauthorized_client: { desc: 'The wrong client redeems the ID-JAG (unauthorized_client)' },
    invalid_target: { desc: 'The exchange names the wrong resource (invalid_target)' },
    invalid_grant: { desc: 'A forged/garbage assertion is redeemed (invalid_grant)' },
    access_denied: { desc: 'A scope outside the client allowlist is refused at the grant (invalid_scope)' },
  };
  app.post('/api/flow/act4/:case', wrap(async (req) => {
    const caseName = req.params.case;
    if (!Object.hasOwn(ACT4, caseName)) throw new LabError('unknown_case', `Unknown refusal case: ${caseName}`, 404);
    const body = req.body || {};
    const traceId = newTraceId();
    let step;
    const act1 = req.session.tokens.act1 || {};
    const demoMode = !str(body.clientId) || Object.hasOwn(DEMO_CLIENT_SECRETS, str(body.clientId));
    const clients = {
      id: str(body.clientId) || 'idjag-ac-client',
      resource: str(body.resourceClientId) || (demoMode ? 'idjag-ras-client' : str(body.clientId)),
    };
    // Body-supplied secrets win; then the demo secret for the client in play; then session-stored secrets.
    let result;
    const secretFor = (clientId) => str(body.clientSecret) || DEMO_CLIENT_SECRETS[clientId] || ''
      || req.session.secrets.act1 || req.session.secrets.act2 || '';
    const noSecret = !secretFor(clients.id) && !secretFor(clients.resource);
    if (noSecret) throw new LabError('missing_field', 'clientSecret is required (or run Act 1 or Act 2 first to store one in this session)', 400);
    if (caseName === 'unauthorized_client') {
      // The wrong client: a valid third client (the introspection client) redeems the ID-JAG; PF authenticates it
      // but refuses the grant because only the resource client may redeem.
      const wrongId = str(body.clientId) || 'idjag-introspect';
      const r = await pf.refusalProbe({
        caseName, clientId: wrongId, clientSecret: secretFor(wrongId),
        params: { grant_type: JWT_BEARER_GRANT, assertion: str(body.assertion) || req.session.idJag || '', ...(str(body.scope) ? { scope: str(body.scope) } : {}) },
        traceId,
      });
      step = r.step; result = r.result;
    } else if (caseName === 'invalid_target') {
      const r = await pf.tokenExchange({
        subjectToken: str(body.subjectToken) || act1.id_token || act1.access_token || '',
        subjectKind: act1.id_token ? 'id_token' : 'access_token',
        resource: str(body.wrongResource) || 'https://wrong-resource.example/api',
        scope: str(body.scope) || 'wrong-scope',
        clientId: clients.id, clientSecret: secretFor(clients.id), traceId,
      });
      step = r.step; result = r.result;
    } else if (caseName === 'invalid_grant') {
      const r = await pf.refusalProbe({
        caseName, clientId: clients.resource, clientSecret: secretFor(clients.resource),
        params: { grant_type: JWT_BEARER_GRANT, assertion: str(body.assertion) || 'forged.not-a-jwt.assertion' },
        traceId,
      });
      step = r.step; result = r.result;
    } else {
      // access_denied: ask for a grant whose scope is outside the client's allowlist. PF refuses the
      // GRANT itself (invalid_scope) — the exchange cannot widen what the client was granted.
      const r = await pf.passwordGrant({
        username: str(body.username) || req.session.username || 'demouser',
        password: str(body.password) || req.session.secrets.password || '',
        scope: str(body.wrongScope) || 'accounts:read',
        clientId: clients.id, clientSecret: secretFor(clients.id), traceId,
      });
      step = r.step; result = r.result;
    }
    req.session.lastTrace = [step];
    return {
      case: caseName,
      description: ACT4[caseName].desc,
      expected: true,
      pfStatus: result.status,
      pfError: result.json?.error || null,
      pfErrorDescription: result.json?.error_description || null,
      trace: [step],
    };
  }));

  // Config inspector: the runtime's public JWKS. No auth, no secrets.
  app.get('/api/jwks', wrap(async () => {
    const traceId = newTraceId();
    const { metadata, step: discoveryStep } = await pf.discover({ traceId });
    const url = metadata.jwksUri || `${settings.runtimeUrl()}/pf/JWKS`;
    const headers = { Accept: 'application/json' };
    const result = await outbound.call(url, { headers, traceId });
    const step = {
      id: 'jwks', title: 'Read the runtime JWKS',
      request: { method: 'GET', url: metadata.jwksUri || url, headers: { ...headers, traceparent: result.traceparent } },
      response: { status: result.status, body: result.json ? { keys: (result.json.keys || []).map((k) => ({ kty: k.kty, kid: k.kid, alg: k.alg, use: k.use })) } : '<not JSON>' },
    };
    if (result.status !== 200 || !Array.isArray(result.json?.keys)) {
      throw new LabError('jwks_failed', `The JWKS answered HTTP ${result.status}`, 502, { trace: discoveryStep ? [discoveryStep, step] : [step] });
    }
    return { keys: result.json.keys, trace: discoveryStep ? [discoveryStep, step] : [step] };
  }));

  // Decode a token locally (no signature verification happens here — the resource AS does that):
  // split the JWT, base64url-decode header + payload, and report whether the header's kid/x5t
  // matches a key in the runtime's JWKS. This is the "what did PF actually sign" teaching view.
  app.post('/api/decode', wrap(async (req) => {
    const token = str((req.body || {}).token);
    if (!token) throw new LabError('missing_field', 'token is required', 400);
    const parts = token.split('.');
    if (parts.length < 2) throw new LabError('bad_token', 'Not a JWT (expected three dot-separated parts)', 400);
    const b64 = (p) => { const pad = p + '='.repeat((4 - (p.length % 4)) % 4); return JSON.parse(Buffer.from(pad, 'base64url').toString('utf8')); };
    let header, claims;
    try { header = b64(parts[0]); claims = b64(parts[1]); } catch { throw new LabError('bad_token', 'Header or payload is not valid base64url JSON', 400); }
    const { metadata, step: discoveryStep } = await pf.discover({ traceId: newTraceId() });
    const url = metadata.jwksUri || `${settings.runtimeUrl()}/pf/JWKS`;
    const result = await outbound.call(url, { headers: { Accept: 'application/json' }, traceId: newTraceId() });
    const jwksKeys = (result.json?.keys || []).map((k) => ({ kid: k.kid, kty: k.kty, alg: k.alg, use: k.use, x5t: k.x5t, n: k.n, e: k.e, x5c: k.x5c }));
    const kidMatch = header.kid ? jwksKeys.some((k) => k.kid === header.kid) : null;
    const x5tMatch = header.x5t ? jwksKeys.some((k) => k.x5t === header.x5t) : null;
    return { header, claims, signaturePart: parts[2] ? `${parts[2].length} chars` : null, jwksKeys, kidMatch, x5tMatch,
      trace: discoveryStep ? [discoveryStep, { id: 'decode', title: 'Decode the token against the runtime JWKS', request: { method: 'POST', url: '/api/decode' }, response: { status: 200, body: { kidMatch, x5tMatch } } }] : [] };
  }));

  app.post('/api/reset', wrap((req) => ({ ok: true, workspace: req.session.workspace, ...sessions.reset(req.session) })));
  app.post('/api/workspaces/:workspace/reset', wrap(async (req) => {
    if (!validWorkspace(req.params.workspace)) throw new LabError('bad_workspace', 'The workspace id is lowercase letters, digits and hyphens (1 to 32 characters)', 400);
    return { ok: true, workspace: req.params.workspace, ...sessions.resetWorkspace(req.params.workspace) };
  }));
  app.get('/api/workspaces', wrap((req) => ({ current: req.session.workspace, default: DEFAULT_WORKSPACE })));

  // The built web UI, when it exists. Registered last so it never shadows an API route.
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: 'index.html' }));
    app.get(/^\/(?!api(\/|$)).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  app.use(errorHandler);
  return app;
}
