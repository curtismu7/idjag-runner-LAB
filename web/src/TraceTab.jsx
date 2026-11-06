import React, { useState } from 'react';
import { api } from './api.js';
import { Banner, Chip, TraceSteps, ErrorBox } from './components.jsx';

export default function TraceTab() {
  const [steps, setSteps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = async (path, body) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api(path, { method: 'POST', body });
      setSteps(r.trace || []);
      if (!r.trace?.length) setError({ message: 'No trace on the last run of this step yet.' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Banner />
      <h1>Trace</h1>
      <p>Every request/response pair of the last hop, in timing order, with its W3C traceparent. A refused hop is labelled.</p>
      <div className="actions">
        <button disabled={busy} onClick={() => load('/api/flow/act3/redeem', {})}>Last redeem</button>
        <button disabled={busy} onClick={() => load('/api/flow/act3/introspect', {})}>Last introspect</button>
      </div>
      <ErrorBox error={error} />
      <TraceSteps steps={steps} />
      {steps.length > 0 ? (
        <p className="card-sub">{steps.length} hop{steps.length === 1 ? '' : 's'} recorded.</p>
      ) : null}
    </div>
  );
}
