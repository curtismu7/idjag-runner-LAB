import React from 'react';
import { Banner } from './components.jsx';

export default function AboutTab() {
  return (
    <div>
      <Banner />
      <h1>About ID-JAG</h1>
      <p>
        An ID-JAG (Identity Assertion JWT Authorization Grant) is a JWT, issued by PingFederate over RFC 8693 token
        exchange, that represents a <strong>delegation grant</strong> rather than an access token. A client redeems it
        with a jwt-bearer grant at the resource's authorization server, and only then receives a real access token.
        The typ header <code className="mono">oauth-id-jag+jwt</code> is what tells the two apart on the wire.
      </p>

      <h2 className="section-label">Say these limits out loud</h2>
      <ul>
        <li>
          <strong>The grant is capped by policy, and anything else dies at redemption.</strong> The scope written into
          the ID-JAG at exchange time is the grant's ceiling — the redeem call may not ask for more (watch the
          grant-scope vs requested-scope gotcha).
        </li>
        <li>
          <strong>Never claim single-use.</strong> Whether an ID-JAG can be redeemed more than once is a
          PingFederate policy setting, not a property of the format. Do not assert one-time use in a demo.
        </li>
        <li>
          <strong>There is no client_id claim.</strong> The authorized client is bound server-side at issuance; you
          cannot read "who may redeem this" out of the decoded claims.
        </li>
      </ul>

      <h2 className="section-label">Try it another way</h2>
      <p>
        The same flow also ships as <a href="https://www.postman.com/" rel="noreferrer">Postman collections</a> for
        running hop by hop outside a browser.
      </p>

      <h2 className="section-label">Where the traces live</h2>
      <p className="card-sub">
        The Trace tab shows the redeem/introspect hops of the last run; Act 1/2/4 hops are visible inline on the Flow tab.
      </p>
    </div>
  );
}
