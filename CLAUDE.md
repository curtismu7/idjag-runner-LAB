# idjag-runner (ID-JAG Runner LAB)

Tier: Tester. Drives the PingFederate ID-JAG demo (pi.flow sign-in → refresh → ID token; RFC 8693 exchange for an ID-JAG; jwt-bearer redeem + introspection; refusal cases) against a real PF 13.1+. No mock ships here (owner decision 2026-11-06).

- Run: `npm install && npm start` (loopback-only, port 4780). Tests: `npm test` (`node --test test/*.test.js` glob, Node 26).
- Client secrets are write-only: accepted per request, held in-memory per session, never echoed in any response, trace or log.
- Outbound is netguard-only: just the user-configured PF runtime origin (https; loopback http for tests), no cross-origin redirects, self-test asserts zero non-configured attempts.
- Default runtime `https://cmuir-pf-acme.ping-devops.com` is our own demo host; tests use `test-*` fake client ids only. No identifiers from other projects.
- Loopback-only bind, Host allow-list, same-origin JSON writes, no eval/vm, bounded JSON walkers.
- Tests must run without absolute paths and pass on Node 26 (`node --test test/*.test.js` — glob, never a directory).
- Conformance gate `server/test/demo-kit-conformance.mjs` is a vendored byte-copy of demo-kit-base's `scripts/conformance.mjs` (refresh by copying from demo-kit-base main and updating the header note; never edit it in place). CI runs it through `scripts/conformance-ci.sh`, which waives exactly-and-only rule 19 FAILs (`docs/rule-19-waiver.md` — real-PF-only, owner decision 2026-11-06).
