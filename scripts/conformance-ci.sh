#!/usr/bin/env bash
# CI conformance wrapper: runs the vendored gate with --new --tier=Tester and treats
# exactly-and-only rule-19 FAILs as an approved waiver (docs/rule-19-waiver.md):
# this lab is real-PF-only by owner decision (2026-11-06), so the Mock/Real rule
# cannot pass. Any other FAIL fails the job. Green + waived rule 19 exits 0 but
# prints the waiver notice loudly.
set -u
cd "$(dirname "$0")/.."
gate=server/test/demo-kit-conformance.mjs
waiver=docs/rule-19-waiver.md

out=$(node "$gate" . --new --tier=Tester 2>&1)
status=$?
printf '%s\n' "$out"

# Every FAIL line must be a rule-19 FAIL; anything else (or a non-1 exit) is fatal.
if [ "$status" -ne 0 ] && [ "$status" -ne 1 ]; then
  echo "conformance-ci: gate exited $status unexpectedly" >&2
  exit "$status"
fi
other_fails=$(printf '%s\n' "$out" | grep -E '^\s*(FAIL|✗|✖)' | grep -vc 'rule 19' || true)
if [ "$other_fails" -ne 0 ]; then
  echo "conformance-ci: NON-WAIVED FAIL lines present (see above)" >&2
  exit 1
fi
rule19_fails=$(printf '%s\n' "$out" | grep -E '^\s*(FAIL|✗|✖)' | grep -c 'rule 19' || true)
if [ "$rule19_fails" -gt 0 ]; then
  if [ ! -f "$waiver" ]; then
    echo "conformance-ci: rule-19 FAILs present but $waiver is missing — refusing to waive" >&2
    exit 1
  fi
  echo '================================================================'
  echo 'WAIVER NOTICE: rule 19 (Mock/Real toggle) FAILs are APPROVED.'
  echo 'This lab is real-PingFederate-only by owner decision (2026-11-06,'
  echo 'precedent cimd-lab). See docs/rule-19-waiver.md.'
  echo '================================================================'
fi
exit 0
