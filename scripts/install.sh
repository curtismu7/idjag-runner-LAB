#!/usr/bin/env bash
# One-command install + start for the Tarun ID-JAG Runner.
#   bash scripts/install.sh
# Works from inside the cloned repo. Verifies Docker, builds, starts, opens the browser.
set -u
cd "$(dirname "$0")/.."
PORT="${HOST_PORT:-4780}"

# Reuse the pre-flight if present (docker, compose, port, network pool, PF reachable).
if [ -f scripts/check-deploy.sh ]; then
  bash scripts/check-deploy.sh || { echo; echo "Fix the FAIL lines above, then re-run: bash scripts/install.sh"; exit 1; }
fi

echo
echo "Building and starting the Tarun ID-JAG Runner..."
docker compose -f deploy/docker-compose.yml up --build -d

echo
# Wait for health (max ~30s).
for i in $(seq 1 15); do
  if curl -s "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"state":"ready"'; then
    echo "Tarun ID-JAG Runner is up:  http://127.0.0.1:$PORT"
    echo "Sign in: demouser · password only (Baseball123!)"
    # Open the browser (macOS / linux).
    if command -v open >/dev/null 2>&1; then open "http://127.0.0.1:$PORT"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://127.0.0.1:$PORT"
    fi
    exit 0
  fi
  sleep 2
done
echo "The container is up but health did not answer yet: curl http://127.0.0.1:$PORT/api/health"
exit 1
