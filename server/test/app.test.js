import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp, DEMO } from '../src/app.js';
import { createFakePf, USER, AC, RESOURCE, INTROSPECT, RESOURCE_URI, ID_JAG } from './fakepf.js';
import { validateRuntimeUrl, SettingsError } from '../src/settings.js';
import { assertAllowed } from '../src/outbound.js';

const start = async (pfOptions = {}) => {
  const pf = await createFakePf(pfOptions);
  // Reserve an ephemeral port first: the app's Host allow-list is built from the port, so the port must be
  // known before createApp. The placeholder is closed immediately; the port is ours for this test.
  const placeholder = http.createServer();
  await new Promise((done) => placeholder.listen(0, '127.0.0.1', done));
  const port = placeholder.address().port;
  await new Promise((done) => placeholder.close(done));
  const app = createApp({ port, defaultRuntimeUrl: pf.origin });
  const server = app.listen(port, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  const base = `http://127.0.0.1:${port}`;
  return { pf, server, app, base, close: async () => { await new Promise((d) => server.close(d)); await pf.close(); } };
};

const post = async (base, path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
};
const get = async (base, path, headers = {}) => {
  // Raw http.request so a Host header can be set explicitly (undici refuses to override it).
  const url = new URL(`${base}${path}`);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { ...headers, Host: headers.Host || url.host } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(raw); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.end();
  });
};
const cookieOf = (headers) => headers.get('set-cookie')?.split(';')[0] || '';

test('health returns the demo-health/1 shape', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const r = await get(ctx.base, '/api/health', { Host: new URL(ctx.base).host });
  assert.equal(r.status, 200);
  assert.equal(r.body.schema, 'demo-health/1');
  assert.equal(r.body.demo.id, DEMO.id);
  assert.ok(r.body.at);
  assert.ok(r.body.state);
  assert.ok(r.body.runtime);
});

test('info exposes the runtime and default', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const r = await get(ctx.base, '/api/info', { Host: new URL(ctx.base).host });
  assert.equal(r.body.runtimeUrl, ctx.pf.origin);
  assert.ok(r.body.demo);
});

test('settings validation: rejects non-https non-loopback, accepts https and loopback http', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const host = new URL(ctx.base).host;
  const bad = await post(ctx.base, '/api/settings', { runtimeUrl: 'http://runtime.example' }, { Host: host });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_setting');
  const good = await post(ctx.base, '/api/settings', { runtimeUrl: 'https://runtime.example' }, { Host: host });
  assert.equal(good.status, 200);
  assert.equal(good.body.runtimeUrl, 'https://runtime.example');
  const loop = await post(ctx.base, '/api/settings', { runtimeUrl: 'http://127.0.0.1:9031' }, { Host: host });
  assert.equal(loop.status, 200);
  // Restore the fake PF so the flow tests keep hitting it.
  const restore = await post(ctx.base, '/api/settings', { runtimeUrl: ctx.pf.origin }, { Host: host });
  assert.equal(restore.status, 200);
});

test('full happy flow: act1 password+refresh, act2 all three exchange variants, act3 redeem+introspect, jwks', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const host = new URL(ctx.base).host;
  const jar = {};

  const call = async (path, body) => {
    const r = await post(ctx.base, path, body, { Host: host, ...(jar.cookie ? { Cookie: jar.cookie } : {}) });
    const cookie = r.headers.get('set-cookie');
    if (cookie) jar.cookie = cookie.split(';')[0];
    return r;
  };

  // Act 1
  const act1 = await call('/api/flow/act1', { username: USER.username, password: USER.password, scope: 'openid profile', clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(act1.status, 200, JSON.stringify(act1.body));
  assert.ok(act1.body.tokens.accessToken);
  assert.ok(act1.body.tokens.refreshToken);
  assert.ok(act1.body.tokens.idToken);
  assert.ok(Array.isArray(act1.body.trace) && act1.body.trace.length === 2);
  for (const s of act1.body.trace) {
    assert.match(s.request.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  }

  // Act 2, all three subject variants
  const expected = { id_token: act1.body.tokens.idToken.claims, access_token: act1.body.tokens.accessToken.claims };
  for (const kind of ['id_token', 'refresh_token', 'access_token']) {
    const act2 = await call('/api/flow/act2', { subjectKind: kind, resource: RESOURCE_URI, scope: 'bank.read', clientId: AC.clientId, clientSecret: AC.clientSecret });
    assert.equal(act2.status, 200, `${kind}: ${JSON.stringify(act2.body)}`);
    assert.ok(act2.body.idJag);
    assert.equal(act2.body.idJagHeader.typ, 'oauth-id-jag+jwt');
    assert.ok(act2.body.idJagClaims.iss);
    assert.ok(act2.body.idJagClaims.aud);
    assert.ok(act2.body.idJagClaims.sub);
    assert.ok(act2.body.idJagClaims.exp);
    if (expected[kind]) assert.equal(act2.body.idJagClaims.sub, expected[kind].sub);
    assert.equal(act2.body.tokenType, 'urn:ietf:params:oauth:token-type:id-jag');
  }

  // Act 3a redeem (session still holds the last ID-JAG)
  const redeem = await call('/api/flow/act3/redeem', { clientId: RESOURCE.clientId, clientSecret: RESOURCE.clientSecret, scope: 'bank.read' });
  assert.equal(redeem.status, 200, JSON.stringify(redeem.body));
  assert.ok(redeem.body.tokens.accessToken);

  // Act 3b introspection
  const intro = await call('/api/flow/act3/introspect', { clientId: INTROSPECT.clientId, clientSecret: INTROSPECT.clientSecret });
  assert.equal(intro.status, 200, JSON.stringify(intro.body));
  assert.equal(intro.body.introspection.active, true);

  // JWKS
  const jwks = await get(ctx.base, '/api/jwks', { Host: host });
  assert.equal(jwks.status, 200, JSON.stringify(jwks.body));
  assert.ok(Array.isArray(jwks.body.keys) && jwks.body.keys.length > 0);
});

test('act4 refusal cases surface PingFederate errors', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const host = new URL(ctx.base).host;
  const jar = {};
  const call = async (path, body) => {
    const r = await post(ctx.base, path, body, { Host: host, ...(jar.cookie ? { Cookie: jar.cookie } : {}) });
    const cookie = r.headers.get('set-cookie');
    if (cookie) jar.cookie = cookie.split(';')[0];
    return r;
  };

  const act1 = await call('/api/flow/act1', { username: USER.username, password: USER.password, scope: 'openid', clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(act1.status, 200);

  // unauthorized_client: a third, valid client (the introspection client) redeems the ID-JAG; PF authenticates it
  // but refuses the grant because only the resource client may redeem.
  const act2 = await call('/api/flow/act2', { subjectKind: 'id_token', resource: RESOURCE_URI, scope: 'bank.read', clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(act2.status, 200);
  const wrong = await call('/api/flow/act4/unauthorized_client', { clientId: INTROSPECT.clientId, clientSecret: INTROSPECT.clientSecret });
  assert.equal(wrong.status, 200);
  assert.equal(wrong.body.pfError, 'unauthorized_client');

  // invalid_target: wrong resource
  const target = await call('/api/flow/act4/invalid_target', { clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(target.status, 200);
  assert.equal(target.body.pfError, 'invalid_target');

  // invalid_grant: garbage assertion
  const grant = await call('/api/flow/act4/invalid_grant', { clientId: RESOURCE.clientId, clientSecret: RESOURCE.clientSecret });
  assert.equal(grant.status, 200);
  assert.equal(grant.body.pfError, 'invalid_grant');

  // access_denied: scope outside the client's allowlist -> the GRANT is refused
  const denied = await call('/api/flow/act4/access_denied', { clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(denied.status, 200);
  assert.equal(denied.body.pfError, 'invalid_scope');

  // unknown case -> 404
  assert.equal((await call('/api/flow/act4/nope', {})).status, 404);
});

test('client secrets never appear in any trace, response or error body (redaction)', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const host = new URL(ctx.base).host;
  const jar = {};
  const call = async (path, body) => {
    const r = await post(ctx.base, path, body, { Host: host, ...(jar.cookie ? { Cookie: jar.cookie } : {}) });
    const cookie = r.headers.get('set-cookie');
    if (cookie) jar.cookie = cookie.split(';')[0];
    return r;
  };
  const secrets = [AC.clientSecret, RESOURCE.clientSecret, INTROSPECT.clientSecret];
  const act1 = await call('/api/flow/act1', { username: USER.username, password: USER.password, scope: 'openid', clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(act1.status, 200);
  await call('/api/flow/act2', { subjectKind: 'id_token', resource: RESOURCE_URI, scope: 'bank.read', clientId: AC.clientId, clientSecret: AC.clientSecret });
  const redeem = await call('/api/flow/act3/redeem', { clientId: RESOURCE.clientId, clientSecret: RESOURCE.clientSecret });
  assert.equal(redeem.status, 200);
  const intro = await call('/api/flow/act3/introspect', { clientId: INTROSPECT.clientId, clientSecret: INTROSPECT.clientSecret });
  assert.equal(intro.status, 200);
  const failed = await call('/api/flow/act1', { username: USER.username, password: 'wrong', clientId: AC.clientId, clientSecret: AC.clientSecret });
  const every = JSON.stringify([act1.body, redeem.body, intro.body, failed.body]);
  for (const secret of secrets) assert.ok(!every.includes(secret), 'a client secret leaked into a response');
  // The password grant's Basic header is redacted too.
  // The password grant's Basic credential is redacted: the scheme stays, the credential never does.
  assert.ok(!/Basic [^<]/.test(every));
});

test('host check, cross-origin writes and non-JSON writes are refused', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const host = new URL(ctx.base).host;
  // A raw socket writes so the Host header can be forged (undici refuses to override Host).
  const evil = await new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port: new URL(ctx.base).port, path: '/api/flow/act1', method: 'POST', setHost: false, headers: { Host: 'evil.example', 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.end('{}');
  });
  assert.equal(evil, 403);
  const cross = await post(ctx.base, '/api/flow/act1', {}, { Host: host, Origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
  const form = await post(ctx.base, '/api/flow/act1', {}, { Host: host, Origin: ctx.base, 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
});

test('netguard: the running app makes zero outbound attempts to non-configured origins', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const host = new URL(ctx.base).host;
  const before = { ...ctx.app.locals.netguard.stats() };
  const host2 = new URL(ctx.base).host;
  await post(ctx.base, '/api/settings', { runtimeUrl: 'https://somewhere-else.example' }, { Host: host2 });
  await post(ctx.base, '/api/flow/act1', { username: 'u', password: 'p', clientId: 'c', clientSecret: 's' }, { Host: host2, Cookie: '' });
  const after = ctx.app.locals.netguard.stats();
  // Only calls to the configured runtime origin are attempted; the refused-elsewhere counter must be unchanged
  assert.equal(after.refused, before.refused, 'netguard should never see a refused attempt in normal flows');
  assert.ok(after.allowedCalls >= before.allowedCalls);
});

test('redaction pins: act1 password, returned refresh_token and act2 subject_token never appear in any trace', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const host = new URL(ctx.base).host;
  const jar = {};
  const call = async (path, body) => {
    const r = await post(ctx.base, path, body, { Host: host, ...(jar.cookie ? { Cookie: jar.cookie } : {}) });
    const cookie = r.headers.get('set-cookie');
    if (cookie) jar.cookie = cookie.split(';')[0];
    return r;
  };
  // Run act1 + act2 (refresh_token variant, so the raw subject_token is the raw refresh token) and serialize
  // every trace JSON in the responses. The fake PF's raw values are known here, so the raw values can be
  // asserted absent — not just that params look redacted.
  const rawResponses = [];
  const pfCalls = [];
  const act1 = await call('/api/flow/act1', { username: USER.username, password: USER.password, scope: 'openid', clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(act1.status, 200);
  rawResponses.push(JSON.stringify(act1.body));
  // Capture the raw refresh_token the fake PF issued: call the fake PF directly with the same grant.
  const direct = await fetch(`${ctx.pf.origin}/as/token.oauth2`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${AC.clientId}:${AC.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', username: USER.username, password: USER.password }),
  });
  const rawRefreshToken = (await direct.json()).refresh_token;
  assert.ok(rawRefreshToken);
  const act2 = await call('/api/flow/act2', { subjectKind: 'refresh_token', resource: RESOURCE_URI, scope: 'bank.read', clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(act2.status, 200, JSON.stringify(act2.body));
  rawResponses.push(JSON.stringify(act2.body));
  const every = rawResponses.join('');
  // The raw secret values must never appear anywhere in any trace.
  assert.ok(!every.includes(USER.password), 'the act1 password value appears in a response/trace');
  assert.ok(!every.includes(rawRefreshToken), 'the raw refresh_token value appears in a response/trace');
  assert.ok(!every.includes(AC.clientSecret), 'a client secret appears in a response/trace');
  // And by shape: every secret/token param in the traces is redacted or masked, never raw.
  for (const step of [...act1.body.trace, ...act2.body.trace]) {
    const params = step.request.params || {};
    for (const [k, v] of Object.entries(params)) {
      if (['password', 'refresh_token', 'subject_token', 'client_secret', 'assertion'].includes(k)) {
        if (k === 'subject_token') {
          // TOKEN_KEYS render as { masked, length, kind }: the raw value is never present.
          assert.ok(v && typeof v === 'object' && typeof v.masked === 'string' && v.masked.includes('...'),
            'trace subject_token view is not the masked shape');
          continue;
        }
        assert.ok(String(typeof v === 'string' ? v : JSON.stringify(v)).startsWith('<'), `trace param ${k} is not redacted: ${v}`);
      }
    }
  }
});

test('wire traceparent: the fake PF receives a well-formed W3C traceparent on every hop', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const host = new URL(ctx.base).host;
  const jar = {};
  const call = async (path, body) => {
    const r = await post(ctx.base, path, body, { Host: host, ...(jar.cookie ? { Cookie: jar.cookie } : {}) });
    const cookie = r.headers.get('set-cookie');
    if (cookie) jar.cookie = cookie.split(';')[0];
    return r;
  };
  const act1 = await call('/api/flow/act1', { username: USER.username, password: USER.password, scope: 'openid', clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(act1.status, 200);
  await call('/api/flow/act2', { subjectKind: 'id_token', resource: RESOURCE_URI, scope: 'bank.read', clientId: AC.clientId, clientSecret: AC.clientSecret });
  await call('/api/flow/act3/redeem', { clientId: RESOURCE.clientId, clientSecret: RESOURCE.clientSecret, scope: 'bank.read' });
  await call('/api/flow/act3/introspect', { clientId: INTROSPECT.clientId, clientSecret: INTROSPECT.clientSecret });
  assert.ok(ctx.pf.hops.length >= 5, `expected at least 5 hops, got ${ctx.pf.hops.length}`);
  for (const hop of ctx.pf.hops) {
    assert.match(hop.traceparent || '', /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
      `wire traceparent missing or malformed on ${hop.url}`);
  }
});

test('runtime URL is an any-https-PF field: [::1]:22 and arbitrary https origins accepted, non-https rejected', (t) => {
  assert.equal(validateRuntimeUrl('https://[::1]:22/'), 'https://[::1]:22');
  assert.equal(validateRuntimeUrl('https://pf.corp.example:8443'), 'https://pf.corp.example:8443');
  assert.throws(() => validateRuntimeUrl('file:///etc/passwd'), SettingsError);
  assert.throws(() => validateRuntimeUrl('http://pf.corp.example'), SettingsError);
  assert.throws(() => validateRuntimeUrl('ftp://pf.corp.example'), SettingsError);
  // loopback http stays allowed for tests
  assert.equal(validateRuntimeUrl('http://localhost:9031'), 'http://localhost:9031');
});

test('outbound.assertAllowed unit: origin mismatch and non-https non-loopback throw; allowed loopback http passes', (t) => {
  const httpsOrigin = new URL('https://pf.example');
  assertAllowed('https://pf.example/as/token.oauth2', httpsOrigin); // pass
  assert.throws(() => assertAllowed('https://other.example/x', httpsOrigin), (e) => e.reason === 'other_origin');
  assert.throws(() => assertAllowed('http://pf.example/x', httpsOrigin), (e) => e.reason === 'not_https');
  assert.throws(() => assertAllowed('not a url', httpsOrigin), (e) => e.reason === 'bad_url');
  const httpLoopback = new URL('http://127.0.0.1:9031');
  assertAllowed('http://127.0.0.1:9031/as/token.oauth2', httpLoopback); // pass
  assert.throws(() => assertAllowed('https://127.0.0.1:9031/x', httpLoopback), (e) => e.reason === 'not_https');
  assert.throws(() => assertAllowed('http://127.0.0.1:9031/x', null), (e) => e.reason === 'not_configured');
});

test('introspection endpoint comes from discovery when advertised (non-default JWKS path case)', async (t) => {
  const ctx = await start({ altJwks: true });
  t.after(() => ctx.close());
  const host = new URL(ctx.base).host;
  const jar = {};
  const call = async (path, body) => {
    const r = await post(ctx.base, path, body, { Host: host, ...(jar.cookie ? { Cookie: jar.cookie } : {}) });
    const cookie = r.headers.get('set-cookie');
    if (cookie) jar.cookie = cookie.split(';')[0];
    return r;
  };
  const act1 = await call('/api/flow/act1', { username: USER.username, password: USER.password, scope: 'openid', clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(act1.status, 200);
  await call('/api/flow/act2', { subjectKind: 'id_token', resource: RESOURCE_URI, scope: 'bank.read', clientId: AC.clientId, clientSecret: AC.clientSecret });
  const redeem = await call('/api/flow/act3/redeem', { clientId: RESOURCE.clientId, clientSecret: RESOURCE.clientSecret, scope: 'bank.read' });
  assert.equal(redeem.status, 200);
  const intro = await call('/api/flow/act3/introspect', { clientId: INTROSPECT.clientId, clientSecret: INTROSPECT.clientSecret });
  assert.equal(intro.status, 200, JSON.stringify(intro.body));
  assert.equal(intro.body.introspection.active, true);
  const url = intro.body.trace[0].request.url;
  assert.ok(url.endsWith('/as/token-introspect.custom'), `introspect should use the advertised endpoint, got ${url}`);
  assert.ok(!url.includes('/my/custom/jwks.json'), 'introspect must not splice the JWKS path');
});

test('act4 falls back to the session-stored secret when the body omits clientSecret', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const host = new URL(ctx.base).host;
  const jar = {};
  const call = async (path, body) => {
    const r = await post(ctx.base, path, body, { Host: host, ...(jar.cookie ? { Cookie: jar.cookie } : {}) });
    const cookie = r.headers.get('set-cookie');
    if (cookie) jar.cookie = cookie.split(';')[0];
    return r;
  };
  const act1 = await call('/api/flow/act1', { username: USER.username, password: USER.password, scope: 'openid', clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(act1.status, 200);
  const act2 = await call('/api/flow/act2', { subjectKind: 'id_token', resource: RESOURCE_URI, scope: 'bank.read', clientId: AC.clientId, clientSecret: AC.clientSecret });
  assert.equal(act2.status, 200);
  // No clientSecret in the body: the session's act1/act2 secret is used.
  const denied = await call('/api/flow/act4/access_denied', { clientId: AC.clientId });
  assert.equal(denied.status, 200, JSON.stringify(denied.body));
  assert.equal(denied.body.pfError, 'invalid_scope');
  const target = await call('/api/flow/act4/invalid_target', { clientId: AC.clientId });
  assert.equal(target.status, 200);
  assert.equal(target.body.pfError, 'invalid_target');
  // With no session secret and no body secret, it is refused.
  const ctx2 = await start();
  t.after(() => ctx2.close());
  const r2 = await post(ctx2.base, '/api/flow/act4/invalid_grant', { clientId: RESOURCE.clientId }, { Host: new URL(ctx2.base).host });
  assert.equal(r2.status, 400);
  assert.equal(r2.body.error, 'missing_field');
});
