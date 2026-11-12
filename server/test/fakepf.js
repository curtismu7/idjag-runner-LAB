// The tests' PingFederate: a real in-process http server on loopback, exercising every hop the app makes.
// Host: http://127.0.0.1:<ephemeral>. Clients: test-ac-client / test-secret (auth client),
// test-resource-client / test-resource-secret (resource-AS), test-introspect-client / test-introspect-secret.

import http from 'node:http';
import crypto from 'node:crypto';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const signJwt = (payload, header = { alg: 'RS256', typ: 'JWT' }) => `${b64(header)}.${b64(payload)}.fakesig`;

export const USER = { username: 'tarun', password: 'Test1234!' };
export const AC = { clientId: 'test-ac-client', clientSecret: 'test-secret' };
export const RESOURCE = { clientId: 'test-resource-client', clientSecret: 'test-resource-secret' };
export const INTROSPECT = { clientId: 'test-introspect-client', clientSecret: 'test-introspect-secret' };
export const RESOURCE_URI = 'https://api.example.example/bank';
export const ID_JAG = 'urn:ietf:params:oauth:token-type:id-jag';

export function createFakePf({ failUnauthorizedClient = false, failWrongResource = false, altJwks = false } = {}) {
  const jwksPath = altJwks ? '/my/custom/jwks.json' : '/pf/JWKS';
  const hops = []; // every token/introspect hop the fake PF received, with its wire traceparent
  const flows = new Map(); // pi.flow: flowId -> { cookie, challenge, state }
  const codes = new Map(); // authorization code -> { challenge, state }
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url === '/as/token.oauth2' || req.url === '/as/introspect.oauth2') {
        hops.push({ url: req.url, traceparent: req.headers.traceparent || null });
      }
      const json = (status, body, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
      };
      const basicAuth = () => {
        const h = req.headers.authorization || '';
        if (!h.startsWith('Basic ')) return null;
        const [id, secret] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
        return { id: decodeURIComponent(id), secret: decodeURIComponent(secret) };
      };
      const params = new URLSearchParams(raw);
      const formError = (status, error, description) => json(status, { error, error_description: description });
      const clients = [
        [AC.clientId, AC.clientSecret],
        [RESOURCE.clientId, RESOURCE.clientSecret],
        [INTROSPECT.clientId, INTROSPECT.clientSecret],
      ];
      const auth = basicAuth();
      const isOpen = req.url === '/.well-known/openid-configuration' || req.url === jwksPath
        || req.url.startsWith('/as/authorization.oauth2') || Boolean(/^\/pf-ws\/authn\/flows\//.exec(req.url));
      if (!isOpen && (!auth || !clients.some(([id, s]) => id === auth.id && s === auth.secret))) {
        return formError(401, 'invalid_client', 'client authentication failed');
      }

      if (req.url === '/.well-known/openid-configuration') {
        return json(200, {
          issuer: origin,
          authorization_endpoint: `${origin}/as/authorization.oauth2`,
          token_endpoint: `${origin}/as/token.oauth2`,
          jwks_uri: `${origin}${jwksPath}`,
          ...(altJwks ? { introspection_endpoint: `${origin}/as/token-introspect.custom` } : {}),
        });
      }
      if (req.url === jwksPath) {
        return json(200, { keys: [{ kty: 'RSA', kid: 'test-key-1', alg: 'RS256', use: 'sig', n: 'x', e: 'AQAB' }] });
      }
      if (req.url === '/as/introspect.oauth2' || req.url === '/as/token-introspect.custom') {
        const token = params.get('token') || '';
        return json(200, token ? { active: true, scope: 'openid profile', client_id: auth.id, token_type: 'Bearer', exp: Math.floor(Date.now() / 1000) + 300 } : { active: false });
      }
      // pi.flow: the authorize opens a JSON flow (rule 16: no redirect login). The redirect_uri is validated,
      // never served. The scope allowlist per client is enforced here (like PF restrictScopes).
      if (req.url.startsWith('/as/authorization.oauth2')) {
        const q = new URL(req.url, 'http://x').searchParams;
        if (q.get('response_mode') !== 'pi.flow') return formError(400, 'unsupported_response_mode', 'fake PF: pi.flow only (no redirect login)');
        if (!clients.some(([id]) => id === q.get('client_id'))) return formError(401, 'invalid_client', 'unknown client_id');
        if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('redirect_uri')) {
          return formError(400, 'invalid_request', 'fake PF: code + PKCE S256 + redirect_uri required');
        }
        const allowed = q.get('client_id') === AC.clientId
          ? ['openid', 'profile', 'chat.read', 'chat.history', 'offline_access']
          : ['openid', 'profile'];
        const asked = (q.get('scope') || '').split(' ').filter(Boolean);
        if (asked.some((sc) => !allowed.includes(sc))) {
          return formError(400, 'invalid_scope', 'The requested scope is invalid, unknown, malformed, or exceeds that which the client is permitted to request.');
        }
        const flowId = `flow-${crypto.randomBytes(8).toString('hex')}`;
        const st = crypto.randomBytes(12).toString('hex');
        flows.set(flowId, { cookie: st, challenge: q.get('code_challenge'), state: q.get('state') });
        return json(200, { id: flowId, status: 'USERNAME_PASSWORD_REQUIRED' }, { 'Set-Cookie': [`PF=ST=${st}; Path=/; HttpOnly`] });
      }
      const fm = /^\/pf-ws\/authn\/flows\/([a-z0-9-]+)$/.exec(req.url);
      if (req.method === 'POST' && fm) {
        const f = flows.get(fm[1]);
        const cookie = /(?:^|;\s*)PF=ST=([^;]+)/.exec(String(req.headers.cookie || ''))?.[1] ?? null;
        if (!f || cookie !== f.cookie) return json(401, { code: 'UNAUTHORIZED', message: 'fake PF: the flow cookie is missing' });
        if (req.headers['content-type'] !== 'application/vnd.pingidentity.checkUsernamePassword+json') {
          return json(415, { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'fake PF: use the vendor content type' });
        }
        let b = {}; try { b = JSON.parse(raw); } catch { /* invalid below */ }
        if (b.username !== USER.username || b.password !== USER.password) {
          return json(400, { code: 'CREDENTIAL_VALIDATION_FAILED', details: [{ code: 'INVALID_VALUE', message: 'Invalid username or password' }] });
        }
        const code = crypto.randomBytes(12).toString('hex');
        codes.set(code, { challenge: f.challenge, state: f.state });
        flows.delete(fm[1]);
        return json(200, { id: fm[1], status: 'COMPLETED', authorizeResponse: { code, state: f.state } });
      }
      if (req.url === '/as/token.oauth2') {
        const grant = params.get('grant_type');
        if (grant === 'authorization_code') {
          const c = codes.get(params.get('code') || '');
          codes.delete(params.get('code') || '');
          if (!c || crypto.createHash('sha256').update(String(params.get('code_verifier') || '')).digest('base64url') !== c.challenge) {
            return formError(400, 'invalid_grant', 'bad code or PKCE verifier');
          }
          return json(200, {
            access_token: signJwt({ iss: origin, sub: USER.username, scope: 'openid profile', exp: Math.floor(Date.now() / 1000) + 300 }),
            refresh_token: `refresh-${crypto.randomBytes(8).toString('hex')}`,
            token_type: 'Bearer',
            expires_in: 300,
            scope: 'openid profile',
          });
        }
        if (grant === 'refresh_token') {
          if (!params.get('refresh_token')) return formError(400, 'invalid_grant', 'no refresh token');
          return json(200, {
            id_token: signJwt({ iss: origin, sub: USER.username, aud: auth.id, exp: Math.floor(Date.now() / 1000) + 300 }),
            token_type: 'Bearer',
            expires_in: 300,
          });
        }
        if (grant === 'urn:ietf:params:oauth:grant-type:token-exchange') {
          if (params.get('requested_token_type') !== ID_JAG) return formError(400, 'invalid_request', 'unknown requested_token_type');
          if (!params.get('subject_token')) return formError(400, 'invalid_request', 'no subject token');
          if (params.get('resource') !== RESOURCE_URI) {
            return formError(400, 'invalid_target', 'the resource is not registered');
          }
          if (!failWrongResource && params.get('scope') === 'forbidden-scope') {
            return formError(403, 'access_denied', 'the scope is outside the issuance criteria');
          }
          return json(200, {
            issued_token: signJwt(
              { iss: origin, aud: RESOURCE.clientId, sub: USER.username, exp: Math.floor(Date.now() / 1000) + 120, scope: params.get('scope') || '', resource: params.get('resource') || '' },
              { alg: 'RS256', typ: 'oauth-id-jag+jwt' },
            ),
            issued_token_type: ID_JAG,
            token_type: 'N/A',
          });
        }
        if (grant === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
          const assertion = params.get('assertion') || '';
          const parts = assertion.split('.');
          let claims = null;
          try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { /* invalid below */ }
          if (parts.length !== 3 || !claims || claims.iss !== origin) {
            return formError(400, 'invalid_grant', 'the assertion is not a valid ID-JAG');
          }
          if (auth.id !== RESOURCE.clientId) {
            return formError(401, 'unauthorized_client', 'only the resource client redeems the ID-JAG');
          }
          return json(200, {
            access_token: `at-${crypto.randomBytes(8).toString('hex')}`,
            token_type: 'Bearer',
            expires_in: 300,
            scope: params.get('scope') || claims.scope || '',
          });
        }
        return formError(400, 'unsupported_grant_type', grant);
      }
      res.writeHead(404); res.end();
    });
  });
  let origin = '';
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      origin = `http://127.0.0.1:${port}`;
      resolve({
        origin,
        hops,
        mintRefreshToken: () => `refresh-${crypto.randomBytes(8).toString('hex')}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
