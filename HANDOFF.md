# HANDOFF — Tarun ID-JAG Runner (`idjag-runner-LAB`)

**Date:** 2026-11-07 · **From:** the AI-DEMO2 ID-JAG session · **Status: WORKING, all committed, CI green**

Everything below is done and verified. A new agent should need very little; the remaining threads
are listed at the end.

---

## 0. The one-paragraph state

`idjag-runner-LAB` (public repo, Tester tier, real-PF-only by owner exception) is a standalone
lab that runs the PingFederate ID-JAG demo without Postman. It is live at
**https://local.ping-devops.com:8443/idjag-runner/** and **http://127.0.0.1:4780**, registered on
the demo shelf ("Tarun ID-JAG Runner", tagged pingfederate / id-jag / real / token-exchange),
linked from AI-DEMO2's merged `/pingfederate-id-jag/runner` page, deployable by anyone with the
anonymous one-liner. Everything is committed through `9aca8dd` and CI is green.

## 1. Repo + live locations

| Thing | Where |
|---|---|
| Repo (PUBLIC) | `https://github.com/curtismu7/idjag-runner-LAB` — HEAD `9aca8dd`, CI success |
| Local working copy | `~/Development/idjag-runner` |
| User-test clone | `~/Development/idjag-runner-user-test` (kept in sync; used to test the user path) |
| Hand-off zip | `~/Development/idjag-runner-handoff.zip` (for people without repo access) |
| Live (domain) | `https://local.ping-devops.com:8443/idjag-runner/` (lab-proxy route) |
| Live (loopback) | `http://127.0.0.1:4780` |
| Meta-repo submodule pin | `AI-DEMO-Standalone` → `standalone/idjag-runner-LAB` @ `9aca8dd` |
| Shelf card | "Tarun ID-JAG Runner" in demo-shelf-LAB registry (tags: pingfederate, token-security, authorization-policy, real, token-exchange, id-jag) |
| SE package originals | `~/Development/IDJAG-SE-Package/` (guide + 2 Postman collections + setup log) |

Run commands (from `~/Development/idjag-runner`): `npm run build && npm start` (host) or
`docker compose -f deploy/docker-compose.yml up --build -d` (container; `restart: unless-stopped`).

## 2. What the app does (all live, browser-verified)

- **Flow tab** — four cards, each named for the SERVER that acts:
  1. *PingFederate · IdP* — password grant + refresh grant (ID token)
  2. *PingFederate · Enterprise issuer* — RFC 8693 exchange, three subject variants → ID-JAG
     (`typ: oauth-id-jag+jwt`, ~5 min life)
  3. *PingFederate · Resource AS* — jwt-bearer redeem + introspection
  4. *Policy checks* — 4 refusals, each labeled with the server that refuses:
     `unauthorized_client` (resource AS), `invalid_target` (enterprise issuer),
     `invalid_grant` (resource AS), `invalid_scope` (IdP grant allowlist)
  A collapsed **flow diagram** (studio diagram `idjagrunner-flow`) sits at the top.
- **Trace tab** — every hop with W3C traceparent, secrets redacted.
- **JWKS / Inspector** — runtime JWKS with rich key cards + a **token check** (paste any token →
  decoded + kid/x5t matched against the JWKS).
- **Diagram tab** — picker between the lab-flow diagram and the studio `pfidjag-jag`.
- **About tab** — the full guide narrative: the idea in 60 seconds, the three-roles explanation,
  the "say this / point at this" demo script, the limits (incl. the grant-scope vs requested-scope
  gotcha), and troubleshooting.
- **Postman + PF setup tab** — the original SE guide HTML embedded unchanged + direct downloads
  of the two Postman collections (served from `web/public/`).

## 3. The PingFederate it drives

`https://cmuir-pf-acme.ping-devops.com` (SE US K8s, ns `ping-devops-cmuir`, pod
`pingfederate-0` — NOT the `pingfederate-acme-0` pod; the runtime host `cmuir-pf-acme...` maps to
`pingfederate-engine` on `pingfederate-0`).

`idjag-*` objects there (all live, all verified):
- Clients `idjag-ac-client` / `idjag-ras-client` / `idjag-introspect` (secrets are the demo
  values from the SE guide, pre-filled in the UI — `idjagAcSecret1234` etc.)
- JWT ATMs `idjagjwtatm` + `idjagjwtrsatm` (RS256, `idjagsigning` key; the RAS ATM's
  `selectionSettings.resourceUris` = `https://api.resource.example.com/` — that selection is what
  routes the jwt-bearer redeem; without it you get `invalid_target`)
- Token processors `idjagrtp`/`idjagatp`/`idjagitp`, TE processor policy `idjagpolicy`,
  SP connection `idjagsp`, IdP connection `idjagidp`, PCV `idjagpcv` (**user `demouser` /
  `Baseball123!`** — renamed from tarun), scope criteria on the refresh-token mapping
  (MULTIVALUE_CONTAINS chat.read)
- Access tokens are **JWTs** so everything decodes in the UI; refresh tokens stay opaque (PF behavior)

**Admin API access:** `kubectl -n ping-devops-cmuir port-forward svc/pingfederate-admin 29999:9999`,
user `administrator`, password from k8s secret **`pingfederate-admin`** (NOT `pingfederate-acme-admin` —
different pod). Expect `account_locked` rounds if you guess wrong; wait ~90s between attempts.

**⚠️ Shared-PF hazard:** another session rebuilt this PF once mid-session and the `idjagpolicy`
scope criteria were silently dropped. If flows start refusing with "requested scope outside
policy", re-apply the criteria (see `SETUP-LOG-SE-PF.md` in `~/Development/IDJAG-SE-Package/`).

## 4. What a user on ANOTHER machine does

```bash
curl -fsSL https://raw.githubusercontent.com/curtismu7/idjag-runner-LAB/main/scripts/remote-install.sh | bash
```
Repo is **public** — no token. The script downloads the tarball (codeload), pre-flights
(`check-deploy.sh`: docker, compose, network pool, port ownership, PF reachable), builds, starts,
opens the browser. Password only. Hand-off zip alternative:
`~/Development/idjag-runner-handoff.zip` (refreshed after every push; rebuild with
`zip -qr ~/Development/idjag-runner-handoff.zip . -x ".git/*" -x "node_modules/*"` from the
user-test dir).

## 5. Remaining threads (the actual TODO list)

1. **AI-DEMO2 page not in the running stack image.** PR #3402 is merged to main, but the running
   `ai-demo-ui` container predates it, so `/pingfederate-id-jag/runner` 404s in the browser until
   the stack's next `ai-demo-ui` rebuild. Do NOT rebuild the whole AI-DEMO2 stack casually —
   other sessions own that machine state; coordinate or wait for their next deploy.
2. **Bootstrap `--start-top`** (`AI-DEMO-Standalone/scripts/bootstrap.sh`, pushed `98dabf3`) is
   implemented but unexercised end-to-end on a real machine restart. Test: start a few labs,
   reboot, run `scripts/setup.sh --start-top 10`.
3. **web/public fragility**: `web/public/` (guide + 2 Postman collections) is untracked-until-
   committed; a hard worktree clean removes it. It IS committed now, but the SE-guide source of
   truth remains `~/Development/IDJAG-SE-Package/` and `~/Documents/PingFederate-IDJAG-SE-Guide (2).html`.
   If the guide is updated, re-copy it into `web/public/idjag-se-guide.html`.
4. **Shelf PR #2 follow-ups** (merged `de0e26f`, hotfix `54650a1`): the start agent on this Mac
   was restarted manually with `npm run agent` — after a machine reboot, run
   `cd ~/Development/AI-DEMO-Standalone/standalone/demo-shelf-LAB && npm run agent` before using
   Start/Stop from the shelf.
5. **Diagnostic leftovers**: PID squatting port 4783 (`.diff-N086/src/index.js`, "MCP tools",
   4+ days old, another session's) — kill it when confirmed abandoned.

## 6. Operational traps (do not rediscover)

1. **Two PingFederates on the cluster**: `pingfederate-0` (svc `pingfederate-admin`, runtime host
   `cmuir-pf-acme.ping-devops.com`) vs `pingfederate-acme-0` (svc `pingfederate-acme-admin`,
   runtime `cmuir-pf-acme2...`). The idjag objects live on `pingfederate-0`. Check which one you
   port-forwarded before concluding "objects were deleted" — they were never deleted, I checked
   the wrong pod once and nearly restored duplicates.
2. **Port squatters**: `check-deploy.sh` + `install.sh` verify the health payload's
   `demo.id === 'idjag-runner'`; a foreign app on the port is reported, not masked.
3. **Host-run AND container both bind 4780** — only one can hold it. After a reboot prefer the
   container (`restart: unless-stopped`). If the host process wins the port, the container
   silently serves nothing on the host side.
4. **Rule 19 waiver**: real-PF-only is an owner decision (documented in
   `docs/rule-19-waiver.md`; `scripts/conformance-ci.sh` waives exactly-and-only rule-19).
5. **jsdom + ReactFlow**: `web/src/testSetup.js` stubs ResizeObserver — needed by any test that
   renders DiagramView.
6. **No Co-Authored-By trailers** (owner rule). `gh` account: `curtismu7` for pushes, switch
   back to `cmuir_pingcorp` after (other sessions depend on it).
7. Session lesson: my python heredocs mangled `\\d` regexes twice — when editing JS regexes via
   python, verify with `node --check` immediately.

## 7. Verification (run after any change)

```bash
cd ~/Development/idjag-runner
npm run build && npm test        # 27 server + 15 web, must be green
npm run doctor                   # exit 0
bash scripts/check-deploy.sh     # pre-flight (port 4780 will show as "already this lab")
```

Live: open https://local.ping-devops.com:8443/idjag-runner/ → Flow tab → type `Baseball123!` →
Run each card top to bottom. Everything through Act 4's four green refusals must work.
