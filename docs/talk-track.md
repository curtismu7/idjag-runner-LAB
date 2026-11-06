# Talk track: ID-JAG Runner LAB

Each `##` heading is one presenter step. This is a Tester-tier lab that drives the PingFederate ID-JAG demo (cross-app access) against a real PingFederate 13.1+ — nothing is simulated, and refusals are the point.

## Nothing here is simulated

Open with the honesty line: this lab talks to a real PingFederate. Every response on screen is the server's actual answer, including refusals. It refuses to start a flow until a PF 13.1+ runtime is configured — there is no mock mode.

## Point at the runtime

The runtime bar at the top defaults to our own demo PingFederate host (idjag-* objects pre-created) and is editable to any PF 13.1+ https origin. Client secrets are typed per session and are write-only: never returned by an API, never logged, redacted in every trace. Say that before typing one.

## Act 1 — get a token the old way

Run Act 1: the resource-owner password grant (`grant_type=password`) for `demouser`, then the refresh grant that returns the ID token. Every token shown is a real JWT signed by PF's `idjagsigning` key, so the UI decodes it — point at the header and claims.

## Act 2 — exchange for an ID-JAG

Run Act 2: the RFC 8693 token exchange with `requested_token_type=urn:ietf:params:oauth:token-type:id-jag`. Show the three subject variants — ID token, refresh token, access token — and decode the ID-JAG itself: its `typ: oauth-id-jag+jwt` header and its iss/aud/sub/exp/scope/resource claims. This token is the cross-app access grant.

## Act 3 — redeem and introspect

Act 3 redeems the ID-JAG as a jwt-bearer grant at the resource-AS client, then introspects the resulting access token with a third client. The point to land: one human sign-in at the first app becomes a scoped, auditable token at the second app — no password shared between them.

## Act 4 — make PingFederate say no

Run the refusal cases one by one: a wrong client redeeming (`unauthorized_client`), a wrong resource (`invalid_target`), a forged assertion (`invalid_grant`), and a scope outside the client allowlist (`invalid_scope`). Each refusal is PF's real error code, shown as-is. This is the strongest part of the demo.

## Check the keys

Open the Inspector: the runtime's public JWKS (`GET {runtime}/pf/JWKS`, no auth). Anyone can verify the tokens' signatures with what is shown here.

## Everything is traced

Each hop returns a redacted trace step carrying the W3C `traceparent` that was sent. Walk one trace to show the calls leaving the lab, and that the secrets in them are redacted.

## Reset between runs

Press Reset (or `npm run reset`) to clear the workspace's run state before the next audience. The lab binds to loopback only and, through the shared lab-proxy, is also at https://local.ping-devops.com:8443/idjag-runner/ — hand out that URL, never a raw port.
