import React, { useState } from 'react';
import { api } from './api.js';
import { Banner, Chip, ClaimsTable, TokenView, TraceSteps, ErrorBox } from './components.jsx';

const ACT1_DEFAULTS = { username: 'demouser', password: '', clientId: 'idjag-ac-client', scope: 'openid chat.read chat.history' };
const ACT2_DEFAULTS = { resource: 'https://api.resource.example.com/', scope: 'chat.read chat.history' };
// Demo credentials from the SE guide (idjag-* objects created by the setup collection). Shown
// as first-3-chars + mask in the form; the full value is sent to your PingFederate only.
const DEMO_CLIENTS = {
  'idjag-ac-client': 'idjagAcSecret1234',
  'idjag-ras-client': 'rasSecret1234',
  'idjag-introspect': 'introSecret1234',
};
const maskSecret = (s) => (s ? `${s.slice(0, 3)}${'•'.repeat(Math.max(s.length - 3, 3))}` : '');

function SecretInput({ id, label, value, onChange }) {
  return (
    <label htmlFor={id}>
      {label}
      <input id={id} type="text" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} data-testid={id} />
    </label>
  );
}

function Field({ id, label, ...props }) {
  return (
    <label htmlFor={id}>
      {label}
      <input id={id} {...props} />
    </label>
  );
}

export default function FlowTab() {
  const [username, setUsername] = useState(ACT1_DEFAULTS.username);
  const [password, setPassword] = useState('');
  const [clientId, setClientId] = useState(ACT1_DEFAULTS.clientId);
  const [clientSecret, setClientSecret] = useState(DEMO_CLIENTS[ACT1_DEFAULTS.clientId] || '');
  const [scope, setScope] = useState(ACT1_DEFAULTS.scope);
  const [subjectKind, setSubjectKind] = useState('id_token');
  const [resource, setResource] = useState(ACT2_DEFAULTS.resource);
  const [exchangeScope, setExchangeScope] = useState(ACT2_DEFAULTS.scope);

  const [act1Result, setAct1Result] = useState(null);
  const [act2Result, setAct2Result] = useState(null);
  const [redeemResult, setRedeemResult] = useState(null);
  const [introResult, setIntroResult] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (path, body, apply) => {
    setBusy(true);
    setError(null);
    try {
      apply(await api(path, { method: 'POST', body }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const ACT4_CASES = [
    { name: 'unauthorized_client', label: 'Wrong client redeems', expect: 'unauthorized_client' },
    { name: 'invalid_target', label: 'Wrong resource in exchange', expect: 'invalid_target' },
    { name: 'invalid_grant', label: 'Forged assertion', expect: 'invalid_grant' },
    { name: 'access_denied', label: 'Scope outside client allowlist', expect: 'invalid_scope' },
  ];

  return (
    <div>
      <Banner />

      <section className="card card--neutral" aria-labelledby="act1-h">
        <h3 id="act1-h">Act 1 — Password grant, then the refresh grant</h3>
        <p className="card-sub">Proves: a real PingFederate issues access + refresh tokens, and the refresh grant returns the ID token.</p>
        <div className="form-grid">
          <Field id="f-user" label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <label htmlFor="f-pass">
            Password
            <input id="f-pass" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="f-pass" />
          </label>
          <Field id="f-cid" label="Client ID" value={clientId} onChange={(e) => {
            setClientId(e.target.value);
            if (DEMO_CLIENTS[e.target.value]) setClientSecret(DEMO_CLIENTS[e.target.value]);
          }} />
          <SecretInput id="f-csec" label={`Client secret (demo: ${maskSecret(DEMO_CLIENTS[clientId] || '')})`} value={clientSecret} onChange={setClientSecret} />
          <Field id="f-scope" label="Scope" value={scope} onChange={(e) => setScope(e.target.value)} />
        </div>
        <p className="secret-note">Secrets stay in this tab's memory only — never saved, never sent anywhere but your PingFederate.</p>
        <div className="actions">
          <button className="primary" disabled={busy || !password || !clientSecret}
            onClick={() => run('/api/flow/act1', { username, password, clientId, clientSecret, scope }, setAct1Result)}>
            Run Act 1
          </button>
        </div>
        {act1Result ? (
          <div className="token-panel">
            <TokenView label="ID token" view={act1Result.tokens.idToken} />
            <TokenView label="Access token" view={act1Result.tokens.accessToken} />
            <TokenView label="Refresh token" view={act1Result.tokens.refreshToken} />
            <TraceSteps steps={act1Result.trace} />
          </div>
        ) : null}
      </section>

      <section className="card card--neutral" aria-labelledby="act2-h">
        <h3 id="act2-h">Act 2 — RFC 8693 token exchange for the ID-JAG</h3>
        <p className="card-sub">Proves: PF issues an ID-JAG whose header typ is oauth-id-jag+jwt — an authorization grant, not an access token.</p>
        <div className="form-grid">
          <label htmlFor="f-kind">
            Subject token kind
            <select id="f-kind" value={subjectKind} onChange={(e) => setSubjectKind(e.target.value)}>
              <option value="id_token">id_token</option>
              <option value="refresh_token">refresh_token</option>
              <option value="access_token">access_token</option>
            </select>
          </label>
          <Field id="f-res" label="Resource (audience URI)" value={resource} onChange={(e) => setResource(e.target.value)} placeholder="https://resource.example/api" />
          <Field id="f-escope" label="Grant scope" value={exchangeScope} onChange={(e) => setExchangeScope(e.target.value)} />
        </div>
        <div className="actions">
          <button className="primary" disabled={busy || !clientSecret}
            onClick={() => run('/api/flow/act2', { subjectKind, resource, scope: exchangeScope, clientId, clientSecret }, setAct2Result)}>
            Run Act 2
          </button>
        </div>
        <p className="secret-note">Secrets stay in this tab's memory only.</p>
        {act2Result ? (
          <div className="token-panel" data-testid="act2-result">
            <TokenView label="ID-JAG" view={act2Result.idJag} />
            <TraceSteps steps={act2Result.trace} />
          </div>
        ) : null}
      </section>

      <section className="card card--neutral" aria-labelledby="act3-h">
        <h3 id="act3-h">Act 3 — Redeem the ID-JAG, then introspect</h3>
        <p className="card-sub">Proves: only the resource client can redeem the grant (jwt-bearer), and the result is an ordinary access token.</p>
        <div className="actions">
          <button className="primary" disabled={busy || !clientSecret}
            onClick={() => run('/api/flow/act3/redeem', { clientId, clientSecret, scope: exchangeScope }, setRedeemResult)}>
            Redeem ID-JAG
          </button>
          <button disabled={busy || !clientSecret}
            onClick={() => run('/api/flow/act3/introspect', { clientId, clientSecret }, setIntroResult)}>
            Introspect access token
          </button>
        </div>
        {redeemResult ? (
          <div className="token-panel">
            <TokenView label="Redeemed access token" view={redeemResult.tokens.accessToken} />
            <TraceSteps steps={redeemResult.trace} />
          </div>
        ) : null}
        {introResult ? (
          <div className="token-panel" data-testid="introspection">
            <h4>Introspection result</h4>
            <ClaimsTable claims={introResult.introspection} />
            <TraceSteps steps={introResult.trace} />
          </div>
        ) : null}
      </section>

      <section className="card card--neutral" aria-labelledby="act4-h">
        <h3 id="act4-h">Act 4 — Refusals: PingFederate says no</h3>
        <p className="card-sub">Proves: policy still holds when a caller does the wrong thing. A refusal here is the expected result.</p>
        <div className="actions">
          {ACT4_CASES.map((c) => (
            <button key={c.name} disabled={busy}
              onClick={() => run(`/api/flow/act4/${c.name}`, { clientId, clientSecret }, setRefusal)}>
              {c.label} (expect {c.expect})
            </button>
          ))}
        </div>
        {refusal ? (
          <div className="result-ok" data-testid="act4-result">
            PF refused as designed: <span className="mono">{refusal.pfError}</span>
            {refusal.pfErrorDescription ? <span> — {refusal.pfErrorDescription}</span> : null}
            <TraceSteps steps={refusal.trace} />
          </div>
        ) : null}
      </section>

      <ErrorBox error={error} />
    </div>
  );
}
