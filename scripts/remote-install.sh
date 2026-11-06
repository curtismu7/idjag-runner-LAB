#!/usr/bin/env bash
# One-liner for another machine (the repo is public — no token needed):
#   curl -fsSL https://raw.githubusercontent.com/curtismu7/idjag-runner-LAB/main/scripts/remote-install.sh | bash
# Downloads the repo tarball, extracts, pre-flights, builds, starts, opens the browser.
set -euo pipefail
REPO="curtismu7/idjag-runner-LAB"
DIR="${HOME}/Development/idjag-runner-LAB"
PORT="${HOST_PORT:-4780}"
# The repo is public: no token needed. (A token still works if you fork/privatize: pass it as $1
# or set GITHUB_TOKEN, and the api.github.com tarball endpoint is used instead of codeload.)

command -v docker >/dev/null 2>&1 || { echo "Docker is not installed. Install Docker Desktop (docker.com) or OrbStack (orbstack.dev) first."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Start it, then re-run."; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required."; exit 1; }

mkdir -p "$(dirname "$DIR")"
echo "Downloading $REPO (main)..."
TAR=$(mktemp)
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" -o "$TAR"

# Fresh dir each time; keep an existing clone if present (fast path: git pull).
if [ -d "$DIR/.git" ]; then
  echo "Updating existing clone at $DIR..."
  git -C "$DIR" pull --ff-only origin main >/dev/null 2>&1 || true
else
  rm -rf "$DIR"
  mkdir -p "$DIR"
  tar -xzf "$TAR" -C "$DIR" --strip-components=1
fi
rm -f "$TAR"

cd "$DIR"
bash scripts/check-deploy.sh || true
echo
echo "Building and starting the Tarun ID-JAG Runner..."
docker compose -f deploy/docker-compose.yml up --build -d

for i in $(seq 1 15); do
  if curl -s "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"id":"idjag-runner"'; then
    echo
    echo "Tarun ID-JAG Runner is up:  http://127.0.0.1:$PORT"
    echo "Sign in: demouser · password only (Baseball123!)"
    if command -v open >/dev/null 2>&1; then open "http://127.0.0.1:$PORT"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://127.0.0.1:$PORT"
    fi
    exit 0
  fi
  sleep 2
done
echo "The container is up but health did not answer yet: curl http://127.0.0.1:$PORT/api/health"
exit 1
