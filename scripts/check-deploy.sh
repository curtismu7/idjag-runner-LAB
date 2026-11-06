#!/usr/bin/env bash
# Pre-flight for deploying the lab with Docker. Pure bash + docker CLI: no Node needed.
# Run BEFORE `docker compose up`. Exit 1 = fix the printed problem first.
set -u
PORT="${HOST_PORT:-4780}"
RUNTIME="${IDJAG_RUNTIME:-https://cmuir-pf-acme.ping-devops.com}"
fail=0
say()  { printf '%s\n' "$*"; }
ok()   { printf 'ok    %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
hint() { printf '      fix: %s\n' "$*"; }

# 0. git (needed to clone; harmless if running from a handed-over folder)
if ! command -v git >/dev/null 2>&1; then
  say "note: git not found — fine if you received this folder as a zip, otherwise install git or download the repo zip from GitHub"
fi

# 1. docker installed
if ! command -v docker >/dev/null 2>&1; then
  bad "docker CLI not found"
  hint "install Docker Desktop (docker.com) or OrbStack (orbstack.dev), then reopen the terminal"
else
  ok "docker CLI found: $(docker --version | sed 's/, version//')"

  # 2. docker daemon running and reachable
  if ! docker info >/dev/null 2>&1; then
    bad "docker daemon is not running"
    hint "start Docker Desktop / OrbStack (macOS: open -a OrbStack), wait until the whale icon is steady, then re-run"
  else
    ok "docker daemon is running"

    # 3. compose v2 plugin (docker compose, not docker-compose v1)
    if docker compose version >/dev/null 2>&1; then
      ok "docker compose plugin: $(docker compose version --short)"
    elif command -v docker-compose >/dev/null 2>&1; then
      ok "docker-compose (v1) found — the up command below becomes: docker-compose -f deploy/docker-compose.yml up --build -d"
    else
      bad "docker compose plugin missing"
      hint "upgrade Docker Desktop / OrbStack to a current version (compose v2 ships with it)"
    fi

    # 4. network address pool headroom (the 'all predefined address pools have been fully subnetted' error)
    total=$(docker network ls --format '{{.Name}}' | wc -l | tr -d ' ')
    if [ "$total" -ge 28 ]; then
      bad "docker network pool nearly full ($total networks)"
      hint "run: docker network prune -f   (and, to never see this again, raise default-address-pools in the docker daemon settings)"
    else
      ok "docker network pool has room ($total networks in use)"
    fi

    # 5. port free (or already this lab)
    owner=$(curl -s --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -o '"id":"idjag-runner"' || true)
    if [ -n "$owner" ]; then
      ok "port $PORT is already this lab (docker compose up is idempotent)"
    elif nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
      bad "port $PORT is used by a different app"
      hint "stop that app, or use another port: HOST_PORT=$((PORT+1)) bash scripts/install.sh"
    else
      ok "port $PORT is free"
    fi
  fi
fi

# 6. the PingFederate runtime is reachable (this is what the app drives)
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$RUNTIME/pf/JWKS" 2>/dev/null || curl -k -s -o /dev/null -w '%{http_code}' --max-time 8 "$RUNTIME/pf/JWKS" 2>/dev/null || echo 000)
if [ "$code" = "200" ]; then
  ok "PingFederate runtime reachable: $RUNTIME"
elif [ "$code" = "000" ]; then
  bad "cannot reach the PingFederate runtime ($RUNTIME)"
  hint "check VPN/network access, or point the lab at a different PF in the Inspector tab after it starts"
else
  ok "PingFederate runtime answered HTTP $code (reachable)"
fi

echo
if [ "$fail" = "0" ]; then
  say "Ready. Start the lab:"
  say "  docker compose -f deploy/docker-compose.yml up --build -d"
  say "Then open http://127.0.0.1:$PORT"
else
  say "Fix the FAIL lines above, then re-run this script."
fi
exit $fail
