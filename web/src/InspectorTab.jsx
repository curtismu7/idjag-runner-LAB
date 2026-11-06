import React, { useState } from 'react';
import { api } from './api.js';
import { Banner, Chip, TraceSteps, ErrorBox } from './components.jsx';

export default function InspectorTab({ runtimeUrl, onRuntimeChanged }) {
  const [urlDraft, setUrlDraft] = useState(runtimeUrl || '');
  const [keys, setKeys] = useState([]);
  const [trace, setTrace] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

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

  return (
    <div>
      <Banner />
      <h1>JWKS / Inspector</h1>

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
      {keys.map((k, i) => (
        <div key={k.kid || i} className="key-row">
          <dl className="kv">
            <dt>kid</dt><dd className="mono">{k.kid}</dd>
            <dt>kty</dt><dd className="mono">{k.kty}</dd>
            <dt>alg</dt><dd className="mono">{k.alg}</dd>
            <dt>use</dt><dd className="mono">{k.use}</dd>
          </dl>
        </div>
      ))}
      <TraceSteps steps={trace} />
    </div>
  );
}
