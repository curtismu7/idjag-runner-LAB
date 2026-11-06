# Rule 19 waiver — idjag-runner (owner decision, 2026-11-06)

Rule 19 of `STANDALONE-RULES.md` requires Mock mode, Real mode and a visible toggle that switches between them. **idjag-runner is real-PingFederate-only by owner decision (2026-11-06)**, precedent: cimd-lab. No mock mode ships here; the lab refuses to start a flow until a real PingFederate 13.1+ runtime is configured (see README). Rule 19 therefore cannot pass, and its FAILs in the conformance gate are an approved waiver.

Scope: applies to rule 19 only. Every other conformance rule must still pass (`scripts/conformance-ci.sh` fails the CI job on any non-rule-19 FAIL, and fails if this file is removed while rule 19 still FAILs).
