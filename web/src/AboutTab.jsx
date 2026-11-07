import React from 'react';
import { Banner } from './components.jsx';

// The guide content from the SE package, adapted to this lab: what ID-JAG is, the three roles
// one PingFederate plays, the demo narrative with what to say and what to point at, the limits,
// and troubleshooting. Nothing here is simulated — every claim maps to a tab in this lab.

const ROLES = [
  {
    n: 1,
    title: 'PingFederate as the IdP',
    body: 'Signs the user in (demouser) and issues the access token, refresh token and ID token.',
  },
  {
    n: 2,
    title: 'PingFederate as the enterprise issuer',
    body: 'Exchanges any token it issued for the ID-JAG — after the idjagpolicy checks. The ID-JAG names the user, the app and the target resource server.',
  },
  {
    n: 3,
    title: 'PingFederate as the resource authorization server',
    body: 'Redeems the ID-JAG (jwt-bearer) after verifying the issuer signature against the published JWKS, and issues the access token the MCP server would accept.',
  },
];

const SAYS = [
  {
    tab: 'Flow · PingFederate (IdP)',
    say: 'This is a real password grant against PingFederate. The refresh grant also returns the ID token — that is the identity we will trade for a pass.',
    point: 'The decoded ID token: sub, iss, aud — and the two green hops below.',
  },
  {
    tab: 'Flow · PingFederate (enterprise issuer)',
    say: 'The app asks for a pass for ONE resource server. Policy is checked, and it is good for about five minutes.',
    point: 'The ID-JAG panel: typ oauth-id-jag+jwt, the aud, the resource, the five-minute exp.',
  },
  {
    tab: 'Flow · PingFederate (resource AS)',
    say: 'No login screen, no consent. The resource authorization server just verifies the issuer signature and issues its own access token.',
    point: 'The redeemed access token, then introspection: active, sub, scope, client_id — this is what the API learns.',
  },
  {
    tab: 'Flow · Policy checks',
    say: 'The issuer, not each app, controls who can reach what. These look like errors — they are the product working.',
    point: 'The four green refusals: unauthorized_client, invalid_target, invalid_grant, invalid_scope.',
  },
  {
    tab: 'Inspector · JWKS',
    say: 'This is the trust anchor. The resource server downloads this exact URL to check the signature.',
    point: 'The keys, and the token check showing a signing key match.',
  },
];

export default function AboutTab() {
  return (
    <div>
      <Banner />
      <h1>About ID-JAG</h1>

      <h2 className="section-label">The idea in 60 seconds</h2>
      <p>
        A user is signed in at the company IdP. An AI agent or app now needs to call <strong>another</strong>{' '}
        system's API for that user. Normally that means another login prompt, or a long-lived credential passed
        around. With <strong>ID-JAG</strong> the app asks the IdP for a short-lived, signed pass that names the
        user, the app and the target resource server. The app hands the pass to the resource server's authorization
        server, which checks the IdP's signature and issues its own access token. No second login — and the IdP
        stays in control of who can reach what.
      </p>
      <p>
        Technically: an ID-JAG is a JWT issued by PingFederate over RFC 8693 token exchange that represents a{' '}
        <strong>delegation grant</strong> rather than an access token. The client redeems it with a jwt-bearer
        grant at the resource's authorization server. The <code className="mono">oauth-id-jag+jwt</code> typ header
        is what tells the two apart on the wire.
      </p>

      <h2 className="section-label">One PingFederate, three roles</h2>
      <p>
        In this demo one PingFederate plays all three boxes. In production the resource authorization server is a
        separate system — the flow is identical, just with two parties.
      </p>
      <ol className="ijrl-acts">
        {ROLES.map((r) => (
          <li key={r.n} className="ijrl-act">
            <span className="ijrl-act-num">{r.n}</span>
            <div>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <h2 className="section-label">The demo narrative: say this, point at this</h2>
      <p className="card-sub">
        Run the Flow tab top to bottom. For each card, here is what to say and where to look.
      </p>
      <dl className="kv">
        {SAYS.map((s) => (
          <React.Fragment key={s.tab}>
            <dt>{s.tab}</dt>
            <dd>
              <p><strong>Say:</strong> {s.say}</p>
              <p><strong>Point at:</strong> {s.point}</p>
            </dd>
          </React.Fragment>
        ))}
      </dl>

      <h2 className="section-label">Say these limits out loud</h2>
      <ul>
        <li>
          <strong>The grant is capped by policy, and anything else dies at redemption.</strong> Processor-policy
          criteria evaluate the original grant's scope, not the exchange request's scope — an out-of-allowlist
          scope can be minted, but the resource AS refuses it at redemption.
        </li>
        <li>
          <strong>Never claim single-use.</strong> Whether an ID-JAG can be redeemed more than once within its
          five-minute life is a PingFederate policy setting, not a property of the format.
        </li>
        <li>
          <strong>There is no client_id claim.</strong> The authorized client is bound server-side at issuance;
          you cannot read "who may redeem this" out of the decoded claims.
        </li>
        <li>
          <strong>PF is both IdP and resource AS here</strong> to keep the demo small; introspection stands in for
          a real downstream API.
        </li>
      </ul>

      <h2 className="section-label">Troubleshooting</h2>
      <dl className="kv">
        <dt>redeem says invalid_grant</dt>
        <dd>The ID-JAG lives about five minutes. Run the exchange again, then redeem immediately.</dd>
        <dt>invalid_target on the exchange</dt>
        <dd>The resource URI is not registered on the SP connection. Use the one from the setup.</dd>
        <dt>invalid_scope at the grant</dt>
        <dd>The scope exceeds the client's allowlist — that is Act 4's teaching case working.</dd>
        <dt>unauthorized_client on redeem</dt>
        <dd>Only the resource-AS client may redeem. That is the refusal case, not a bug.</dd>
        <dt>Runtime unreachable</dt>
        <dd>Set the PF URL in the Inspector tab; check VPN/network to the host.</dd>
      </dl>

      <h2 className="section-label">Try it another way</h2>
      <p>
        The same flow ships as Postman collections (the SE package's Setup and Demo collections build the same
        <code className="mono"> idjag-*</code> objects and narrate the same steps) — this lab and Postman are two
        faces of one configuration.
      </p>
    </div>
  );
}
