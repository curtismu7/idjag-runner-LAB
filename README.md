# ID-JAG Runner (`idjag-runner-LAB`)

Tier: Tester

A lab that lets SEs run the PingFederate ID-JAG (Identity Assertion JWT Authorization Grant, cross-app access) demo without Postman. **Real PingFederate only** (owner-approved exception, 2026-11-06; precedent: cimd-lab): no mock mode ships here — the lab refuses to start a flow until a PingFederate 13.1+ runtime is configured.

Default PF runtime: `https://cmuir-pf-acme.ping-devops.com` (idjag-* demo objects pre-created), editable to **any** PingFederate 13.1+ https origin — any host and port are accepted by design (loopback http is allowed for tests only). **SE demo setup:** the idjag-* PF objects (OAuth clients, password-grant token policy, ID-JAG processor policy, resource-AS client) must exist on the target PingFederate before this lab can run a flow. Client secrets are typed per session and are write-only: never returned by any API, never logged, redacted in every trace.

## The flow it drives

- **Act 1** — resource-owner password grant (`grant_type=password`), then a refresh grant that returns the ID token.
- **Act 2** — RFC 8693 token exchange for an ID-JAG (`requested_token_type=urn:ietf:params:oauth:token-type:id-jag`), three subject variants: ID token, refresh token, access token. The ID-JAG's header (`typ: oauth-id-jag+jwt`) and claims (iss/aud/sub/exp/scope/resource) are decoded and shown.
- **Act 3** — jwt-bearer redeem of the ID-JAG at the resource-AS client, then introspection (`POST /as/introspect.oauth2`, or the runtime's advertised `introspection_endpoint` when discovery includes one) with a third client.
- **Act 4** — refusals: wrong client redeems (`unauthorized_client`), wrong resource (`invalid_target`), forged assertion (`invalid_grant`), scope outside the client allowlist (`invalid_scope` at the grant).
- **Inspector** — the runtime's public JWKS (`GET {runtime}/pf/JWKS`, no auth).

## Run

```bash
npm install
npm run build          # builds the web UI (web/dist)
npm test               # node --test (server) + vitest (web)
npm run doctor         # one line per check, exit 1 on failure
npm start              # http://127.0.0.1:4780, loopback-only bind
npm run reset          # clears the workspace's run state on the running lab
```

Docker (OrbStack):

```bash
docker compose -f deploy/docker-compose.yml up --build -d
curl http://127.0.0.1:4780/api/health
docker compose -f deploy/docker-compose.yml down
```

The compose publish is `127.0.0.1:`-only (pinned by a test): this lab talks to a real PingFederate with typed secrets, so it must never be reachable from the network. `HOST_PORT=<other>` moves the port.

## Scope-check honesty note

This lab is a Tester, not a story: it proves what PingFederate actually does — including refusing things. The default runtime is our own demo host; the lab itself makes no claim about which tenant is configured, and every response is the server's real answer (trace redacted of secrets). Nothing here is simulated: if PingFederate refuses, you see the refusal.

## API

`GET /api/health` (`demo-health/1`) · `GET /api/info` · `POST /api/settings {runtimeUrl}` · `POST /api/flow/act1 {username,password,scope,clientId,clientSecret}` · `POST /api/flow/act2 {subjectKind: id_token|refresh_token|access_token, resource, scope, ...}` · `POST /api/flow/act3/redeem` · `POST /api/flow/act3/introspect` · `POST /api/flow/act4/:case` (4 refusal cases) · `GET /api/jwks` · `POST /api/reset` · `POST /api/workspaces/:workspace/reset`.

Workspaces: `X-Lab-Workspace` header (rule 13). Every hop returns a redacted trace step carrying the W3C `traceparent` that was sent (rule 14). Outbound calls go through a netguard that only allows the configured runtime origin (https; loopback http for tests), never follows cross-origin redirects, and has a self-test.

## CI

`.github/workflows/ci.yml` (GitHub-hosted, Node 26 only): tests, build, doctor, conformance, docker compose build + health, forbidden-strings, gitleaks. The conformance job runs `scripts/conformance-ci.sh`, which invokes the vendored gate with `--new --tier=Tester` and waives exactly-and-only rule 19 FAILs (real-PF-only lab, owner decision 2026-11-06 — `docs/rule-19-waiver.md`); any other FAIL fails the job.

The conformance gate is a vendored copy of demo-kit-base's `scripts/conformance.mjs` (demo-kit-base has not shipped it to demo repos yet): `server/test/demo-kit-conformance.mjs`. Refresh it by byte-copying from demo-kit-base main and updating the version-note header — never edit the vendored file in place.
