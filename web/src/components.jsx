import React from 'react';
import { truncateMiddle, relativeExpiry } from './api.js';

export function Banner() {
  return (
    <div className="banner" role="note" data-state="live">
      This app drives a <strong>real PingFederate</strong> you configure. Tokens shown are real.
    </div>
  );
}

export function Chip({ kind, children }) {
  return <span className={`chip chip--${kind}`}>{children}</span>;
}

export function ClaimsTable({ claims }) {
  if (!claims || typeof claims !== 'object') return <p className="card-sub">No decoded claims (opaque token).</p>;
  return (
    <dl className="kv">
      {Object.entries(claims).map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd className="mono">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function TokenView({ label, view }) {
  if (!view) return null;
  const typ = view.header?.typ;
  return (
    <div className="token-block" data-testid={`token-${label}`}>
      <h4>
        {label}
        {typ ? <code className={`mono${typ === 'oauth-id-jag+jwt' ? ' typ-jag' : ''}`}>typ: {typ}</code> : null}
        <span className="card-sub mono">{view.masked} ({view.length} chars, {view.kind})</span>
      </h4>
      <ClaimsTable claims={view.claims} />
      {view.claims?.exp ? <p className="card-sub">{relativeExpiry(view.claims)}</p> : null}
    </div>
  );
}

function Primitives({ value }) {
  if (value === null) return <em>null</em>;
  if (typeof value === 'object') return <pre className="code">{JSON.stringify(value, null, 2)}</pre>;
  if (typeof value === 'string' && (value.startsWith('http') || value.startsWith('00-'))) return <span className="mono">{value}</span>;
  return String(value);
}

function Labeled({ label, obj }) {
  if (!obj) return null;
  return (
    <div>
      <strong>{label}</strong>
      <dl className="kv">
        {Object.entries(obj).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd><Primitives value={v} /></dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}

export function TraceSteps({ steps }) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="trace-list" data-testid="trace-list">
      {steps.filter(Boolean).map((step, i) => {
        if (!step || typeof step !== 'object') return null;
        const refused = step?.response && step.response.status >= 400;
        return (
          <details key={step.id || i} className="trace-step">
            <summary>
              <span className="mono">#{i + 1}</span>
              {step.title || step.id || 'hop'}
              {refused ? <Chip kind="danger">refused</Chip> : <Chip kind="info">{step.response?.status}</Chip>}
              {step.request?.headers?.traceparent ? <span className="mono card-sub">{truncateMiddle(step.request.headers.traceparent, 10, 8)}</span> : null}
            </summary>
            <div className="trace-body">
              <Labeled label="Request" obj={step.request} />
              <Labeled label="Response" obj={step.response} />
              {step.note ? <p className="card-sub">{step.note}</p> : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      {error.message}
      {error.body?.trace?.length ? <TraceSteps steps={error.body.trace} /> : null}
    </div>
  );
}
