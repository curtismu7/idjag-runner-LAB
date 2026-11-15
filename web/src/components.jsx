import React from 'react';
import { truncateMiddle, relativeExpiry } from './api.js';
import Json from './components/JsonPane.jsx';

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

// What this lab's readers look for first in a claims payload (on top of the shared defaults sub, aud, scope, client_id, iss ...):
// the resource the ID-JAG is for, and whether an introspected token is active.
const CLAIMS_HOT = ['resource', 'active', 'token_type'];

export function ClaimsTable({ claims, label = 'Claims' }) {
  if (!claims || typeof claims !== 'object') return <p className="card-sub">No decoded claims (opaque token).</p>;
  return <Json value={claims} label={label} hot={CLAIMS_HOT} />;
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
      <ClaimsTable claims={view.claims} label={`${label} claims`} />
      {view.claims?.exp ? <p className="card-sub">{relativeExpiry(view.claims)}</p> : null}
    </div>
  );
}

// One hop's request or response, as the JSON it is. status, resource, the token types and traceparent are what a reader
// follows across hops; the shared defaults (grant_type, scope, client_id, tokens ...) are hot already.
const HOP_HOT = ['status', 'resource', 'requested_token_type', 'subject_token_type', 'issued_token_type', 'traceparent'];

function Labeled({ label, obj }) {
  if (!obj) return null;
  return (
    <div>
      <strong>{label}</strong>
      <Json value={obj} label={label} hot={HOP_HOT} />
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
