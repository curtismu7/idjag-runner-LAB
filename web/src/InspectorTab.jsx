import React, { useState } from 'react';
import { api } from './api.js';
import { Banner, Chip, ClaimsTable, TraceSteps, ErrorBox } from './components.jsx';

const b64urlDecodeJson = (p) => {
  const pad = p + '='.repeat((4 - (p.length % 4)) % 4);
  return JSON.parse(atob(pad.replace(/-/g, '+').replace(/_/g, '/')));
};

function KeyCard({ k }) {
  const [open, setOpen] = useState(false);
  const bits = k.n ? Math.log2(parseInt(k.n.slice(0, 8), 36)) * (k.n.length / 8) : null;
  return (
    <div className="key-row">
      <dl className="kv">
        <dt>kid</dt><dd className="mono">{k.kid || '—'}</dd>
        <dt>kty</dt><dd className="mono">{k.kty}</dd>
        <dt>alg</dt><dd className="mono">{k.alg || '—'}</dd>
        <dt>use</dt><dd className="mono">{k.use || '—'}</dd>
        {k.x5t ? (<><dt>x5t (thumbprint)</dt><dd className="mono">{k.x5t}</dd></>) : null}
        {k.n ? (<><dt>modulus</dt><dd className="mono">{k.n.slice(0, 24)}… ({k.n.length} b64 chars ≈ {Math.round(k.n.length * 6 / 8 * 8 / 1024 * 10) / 10 || '?'} kb key)</dd></>) : null}
      </dl>
      {k.n || k.x5c ? (
        <>
          <button className="linkish" onClick={() => setOpen(!open)}>{open ? 'Hide key material' : 'Show key material'}</button>
          {open ? (
            <pre className="mono">{JSON.stringify(k, null, 2)}</pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function InspectorTab({ runtimeUrl, onRuntimeChanged }) {
  const [urlDraft, setUrlDraft] = useState(runtimeUrl || '');
  const [keys, setKeys] = useState([]);
  const [trace, setTrace] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const [token, setToken] = useState('');
  const [decoded, setDecoded] = useState(null);
  const [decodeBusy, setDecodeBusy] = useState(false);
  const [decodeError, setDecodeError] = useState(null);

  const saveSettings = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await api('/api/settings', { method: 'POST', body: { runtimeUrl: urlDraft } });
      setSaved(true);
      onRuntimeChanged(r.runtimeUrl);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const fetchJwks = async () => {
    setBusy(true);
    setError(null);
    setKeys([]);
    try {
      const r = await api('/api/jwks');
      setKeys(r.keys || []);
      setTrace(r.trace || []);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const decodeToken = async () => {
    setDecodeBusy(true);
    setDecodeError(null);
    setDecoded(null);
    try {
      setDecoded(await api('/api/decode', { method: 'POST', body: { token } }));
    } catch (e) {
      setDecodeError(e);
    } finally {
      setDecodeBusy(false);
    }
  };

  return (
    <div>
      <Banner />
      <h1>JWKS / Inspector</h1>

      <section className="card card--neutral">
        <h3>What this tab is for</h3>
        <p className="card-sub">
          Every token your PingFederate issues is signed with a private key. The <strong>JWKS
          (JSON Web Key Set)</strong> is that key's <em>public half</em>, published by PF at{' '}
          <span className="mono">/pf/JWKS</span> so anyone can check a token's signature without a shared secret.
          This is the trust anchor of the whole ID-JAG flow: the resource authorization server (Act 3)
          downloads this exact URL to verify the ID-JAG's signature before redeeming it.
        </p>
        <ul className="card-sub">
          <li><strong>Runtime JWKS</strong> — the keys PF publishes right now. The <span className="mono">kid</span> (key ID) in a token's header says which of these keys signed it.</li>
          <li><strong>Token check</strong> — paste any token from the Flow tab to see its header and claims decoded, and whether its signing key matches one in the JWKS.</li>
          <li><strong>Runtime URL</strong> — point the whole lab at a different PingFederate (any https origin).</li>
        </ul>
        <p className="card-sub">Note: the JWKS only lets you <em>verify</em> signatures — the private signing key never leaves PingFederate. A decoded token here is not a verified token; signature verification is the resource AS's job (Act 3).</p>
      </section>

      <h2 className="section-label">Runtime settings</h2>
      <p className="card-sub">The PingFederate base URL this lab drives. Any https origin is accepted.</p>
      <div className="form-grid">
        <label htmlFor="f-runtime">
          Runtime URL
          <input id="f-runtime" className="mono" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button className="primary" disabled={busy} onClick={saveSettings}>Save runtime URL</button>
        {saved ? <Chip kind="ok">saved</Chip> : null}
      </div>
      <ErrorBox error={error} />

      <h2 className="section-label">Runtime JWKS</h2>
      <div className="actions">
        <button disabled={busy} onClick={fetchJwks}>Fetch JWKS</button>
      </div>
      {keys.map((k, i) => <KeyCard key={k.kid || i} k={k} />)}
      <TraceSteps steps={trace} />

      <h2 className="section-label">Token check</h2>
      <p className="card-sub">Paste a token (ID-JAG, access token, ID token — copy its full value from the Flow tab) to decode it and check its signing key against the JWKS above.</p>
      <div className="form-grid">
        <label htmlFor="f-token">
          Token
          <textarea id="f-token" className="mono" rows="4" value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJ…" />
        </label>
      </div>
      <div className="actions">
        <button className="primary" disabled={decodeBusy || !token} onClick={decodeToken}>Decode &amp; check</button>
      </div>
      <ErrorBox error={decodeError} />
      {decoded ? (
        <div className="token-panel" data-testid="decode-result">
          <dl className="kv">
            <dt>typ</dt><dd className="mono">{decoded.header.typ || '—'}</dd>
            <dt>alg</dt><dd className="mono">{decoded.header.alg || '—'}</dd>
            <dt>kid</dt><dd className="mono">{decoded.header.kid || '—'}</dd>
            <dt>x5t</dt><dd className="mono">{decoded.header.x5t || '—'}</dd>
            <dt>signature</dt><dd className="mono">{decoded.signaturePart || '—'}</dd>
            <dt>key in JWKS?</dt>
            <dd>
              {decoded.kidMatch || decoded.x5tMatch
                ? <Chip kind="ok">yes — signing key is published</Chip>
                : <Chip kind="warn">no match found in the current JWKS</Chip>}
            </dd>
          </dl>
          <h4>Claims</h4>
          <ClaimsTable claims={decoded.claims} />
          <TraceSteps steps={decoded.trace} />
        </div>
      ) : null}
    </div>
  );
}
