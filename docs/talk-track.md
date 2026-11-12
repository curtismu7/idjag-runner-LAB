# Talk track

## Say this first

Cross-app access is the answer to the question nobody likes: an AI agent or a backend service needs to call a partner's API, and the partner asks "who is asking, on whose behalf, and may it?" An ID-JAG — Identity Assertion JWT Authorization Grant — is PingFederate 13.1+'s way of answering with a signed, short-lived, single-purpose token instead of sharing a client secret. This lab runs that flow against a real PingFederate, no Postman, no mock.

## What this lab is

1. This is a Tester lab: everything you see is PingFederate's actual answer — including its refusals. Nothing is simulated. The only thing the lab needs from you is a password; the demo client IDs and secrets come pre-filled from the idjag-* setup objects.
2. The lab is Real-PingFederate-only by design: it refuses to start a flow until a PingFederate 13.1+ runtime is configured. The runtime URL is editable to any https origin.

## Setup: point the lab at a runtime

1. On the JWKS / Inspector tab you can see and change the configured runtime URL. Any PingFederate 13.1+ https host and port is accepted — that is deliberate, so an SE can point it at their own demo tenant.
2. The idjag-* objects (OAuth clients, a password-grant token policy, an ID-JAG processor policy, and the resource-AS client) must exist on the target PingFederate first. If you point at a different PF, create those objects from the SE guide setup collection.
3. Client secrets are typed per session and write-only: never returned by an API, never logged, redacted in every trace.

## Act 1 — get a normal session first

1. Sign in with the password only. Act 1 opens a pi.flow (authorize + the flows API password step — no redirect login), then a refresh grant that returns the ID token.
2. Say why: an ID-JAG is always minted from an existing subject — you need a real token in hand before you can exchange it. The access token is a JWT signed by the idjagsigning key, so every token decodes in the UI; refresh tokens stay opaque, which is PingFederate's normal behavior.

## Act 2 — the RFC 8693 token exchange

1. This is the heart of the demo: a standard OAuth 2.0 token exchange with requested_token_type set to the ID-JAG type (urn:ietf:params:oauth:token-type:id-jag).
2. Run the exchange with the ID token as the subject, then try the refresh token and the access token — three subject variants, all supported.
3. Look at the minted ID-JAG: its header says typ oauth-id-jag+jwt, and its claims name the issuer, the intended audience (the resource), the subject, the expiry and the scope. Point at the typ value — it is the tell that this is a cross-app access assertion, not an access token.
4. Say the key property: the ID-JAG is single-purpose and short-lived — about five minutes — and it is not a bearer token for an API. It exists to be redeemed by exactly one client at exactly one resource.

## Act 3 — redeem the ID-JAG, then introspect

1. The resource's authorization server redeems the ID-JAG with a jwt-bearer grant and gets a normal access token. That access token is what the resource API actually accepts.
2. Then a third client introspects the token, proving the resource side can independently check what it was handed.
3. Note the ID-JAG's short life: if a redeem fails with expired-assertion, just run Act 2 again for a fresh one — that is the design, not a bug.

## Act 4 — refusals are the lesson

1. This lab treats refusals as teaching moments; each case runs a deliberately wrong call and shows PingFederate's real error.
2. Wrong client redeems: PF authenticates the introspection client but refuses the grant with unauthorized_client — only the resource client may redeem the ID-JAG.
3. Wrong resource: the exchange names a different audience and PF says invalid_target — the exchange cannot mint an assertion for an unintended resource.
4. Forged assertion: a garbage JWT is rejected with invalid_grant — the signature check is doing real work.
5. Scope outside the client allowlist: PF refuses the grant itself with invalid_scope — the exchange cannot widen what the client was ever granted.

## The Inspector — JWKS

1. The Inspector fetches the runtime's public JWKS with no authentication, and the decode view checks whether a token's kid (and x5t) matches a key in that JWKS.
2. Say why it matters: the resource side verifies the ID-JAG's signature against this public key set. The lab decodes tokens locally and shows the match, but it never verifies signatures itself — verification is the resource AS's job, and Act 3 proves it.

## What to say about PingFederate 13.1+ and cross-app access

1. ID-JAG is PingFederate's implementation of the Identity Assertion JWT Authorization Grant profile — enterprise-managed cross-app access. The two parties are an actor client (here, the idjag-ac-client) and a resource authorization server (the idjag-ras-client); the human subject is represented by an existing token from Act 1.
2. The value proposition: no shared client secrets between partners, no long-lived tokens crossing trust boundaries, audience- and scope-bound assertions that expire in minutes, and every hop subject to the PF policy you saw enforced in Act 4.
3. Everything on screen is real PF output, redacted of secrets by the trace layer. If PingFederate refuses something, you see the refusal — that is the point.

## Close

1. Recap the chain: pi.flow sign-in for a subject, RFC 8693 exchange for an ID-JAG bound to one resource and one client, jwt-bearer redeem at the resource, introspection to confirm, and four refusals proving the fences are live.
2. Offer next steps: point the runtime URL at the audience's own PingFederate 13.1+ tenant and run the same acts there.
