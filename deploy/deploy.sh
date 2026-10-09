#!/usr/bin/env bash
# deploy.sh — bring up wrong-notebook on a Tailscale-reachable host.
#
# Assumes the caller has already:
#   - Installed Docker (OrbStack / Docker Desktop / colima) and started the engine
#   - Installed and signed in to Tailscale on this host
#   - Cloned the repo at $REPO_DIR (default: repo root)
#
# Behavior:
#   1. Probes for a free loopback TCP port (prefers $APP_PORT, then 3000-3010)
#   2. Generates a real NEXTAUTH_SECRET if one is missing/placeholder
#   3. Writes a 600-perm .env file at $ENV_FILE
#   4. Brings up docker compose detached
#   5. Optionally enables Tailscale Serve to expose HTTPS

set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.yml}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

log() { printf '[deploy] %s\n' "$*" >&2; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found"
docker info >/dev/null 2>&1 || die "docker daemon not reachable"
[[ -f "$COMPOSE_FILE" ]] || die "compose file not found: $COMPOSE_FILE"

APP_PORT="${APP_PORT:-}"
if [[ -z "$APP_PORT" ]]; then
  APP_PORT="$("$SCRIPT_DIR/probe-port.sh" 3000 3010)"
  log "selected free APP_PORT=$APP_PORT"
fi

# Already-set values are preserved; placeholder values are replaced.
PLACEHOLDERS_REGEX='^(supersecret-dev-secret|your_secret_key|changeme|placeholder)$'

set_env() {
  local key="$1" val="$2"
  if [[ -f "$ENV_FILE" ]] && grep -qE "^${key}=" "$ENV_FILE"; then
    return 0
  fi
  printf '%s=%q\n' "$key" "$val" >> "$ENV_FILE"
}

need_value() {
  local key="$1" current
  if [[ -f "$ENV_FILE" ]]; then
    current="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  fi
  if [[ -n "${!key:-}" ]]; then
    printf '%s=%s\n' "$key" "${!key}" >> "$ENV_FILE.tmp"
  elif [[ -n "$current" ]]; then
    if [[ "$key" == "NEXTAUTH_SECRET" ]] && [[ "$current" =~ $PLACEHOLDERS_REGEX ]]; then
      :
    else
      printf '%s=%s\n' "$key" "$current" >> "$ENV_FILE.tmp"
      return 0
    fi
  fi
  if [[ "$key" == "NEXTAUTH_SECRET" ]]; then
    log "generating NEXTAUTH_SECRET"
    val="$(openssl rand -base64 32)"
    printf 'NEXTAUTH_SECRET=%s\n' "$val" >> "$ENV_FILE.tmp"
  fi
}

# Build the .env in a temp file then move it into place to keep perms tight.
TMP_ENV="$(mktemp)"
trap 'rm -f "$TMP_ENV"' EXIT

# Carry over any existing values
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line; do
    case "$line" in
      NEXTAUTH_SECRET=*|NEXTAUTH_URL=*|ADMIN_EMAIL=*|ADMIN_PASSWORD=*|APP_PORT=*|AI_ALLOWED_ORIGINS=*|OPENCLAW_API_URL=*|OPENCLAW_INTEGRATION_API_KEY=*|OPENCLAW_USER_EMAIL=*|LOG_LEVEL=*)
        echo "$line" >> "$TMP_ENV" ;;
    esac
  done < "$ENV_FILE"
fi

# Ensure NEXTAUTH_SECRET is a real value
have_secret=0
grep -qE '^NEXTAUTH_SECRET=.{16,}' "$TMP_ENV" 2>/dev/null && have_secret=1
if (( have_secret == 0 )); then
  log "NEXTAUTH_SECRET missing/short; generating one"
  grep -v '^NEXTAUTH_SECRET=' "$TMP_ENV" > "$TMP_ENV.no-secret" || true
  mv "$TMP_ENV.no-secret" "$TMP_ENV"
  printf 'NEXTAUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> "$TMP_ENV"
fi

# APP_PORT for the deploy helper (compose already uses 3000:3000)
grep -q '^APP_PORT=' "$TMP_ENV" || printf 'APP_PORT=%s\n' "$APP_PORT" >> "$TMP_ENV"

# Make sure ADMIN_EMAIL/PASSWORD exist (possibly empty for restart)
grep -q '^ADMIN_EMAIL=' "$TMP_ENV" || printf 'ADMIN_EMAIL=\n' >> "$TMP_ENV"
grep -q '^ADMIN_PASSWORD=' "$TMP_ENV" || printf 'ADMIN_PASSWORD=\n' >> "$TMP_ENV"

mv "$TMP_ENV" "$ENV_FILE"
chmod 600 "$ENV_FILE"
trap - EXIT

# Patch the published port in compose to the probed port, unless the
# operator opted in via APP_PORT_BIND=127.0.0.1:$APP_PORT
APP_PORT_BIND="${APP_PORT_BIND:-127.0.0.1:${APP_PORT}:3000}"
if [[ -w "$COMPOSE_FILE" ]] && ! grep -q "127.0.0.1:${APP_PORT}:3000" "$COMPOSE_FILE"; then
  log "updating $COMPOSE_FILE to publish $APP_PORT_BIND"
  # Replace the existing "127.0.0.1:XXXX:3000" line
  sed -i.bak -E "s|\"127.0.0.1:[0-9]+:3000\"|\"${APP_PORT_BIND}\"|g" "$COMPOSE_FILE"
fi

# Start the stack
( cd "$REPO_DIR" && docker compose -f "$COMPOSE_FILE" up -d )

log "container status:"
docker compose -f "$COMPOSE_FILE" -p "$(basename "$REPO_DIR")" ps || true

# Optional: Tailscale Serve
if [[ -n "${ENABLE_TAILSCALE_SERVE:-1}" ]] && command -v tailscale >/dev/null 2>&1; then
  log "configuring Tailscale Serve: https -> http://127.0.0.1:${APP_PORT}"
  if tailscale serve --https=443 --set-path=/ "http://127.0.0.1:${APP_PORT}" 2>/dev/null \
     || sudo tailscale serve --https=443 --set-path=/ "http://127.0.0.1:${APP_PORT}"; then
    log "Tailscale Serve configured"
  else
    log "Tailscale Serve setup failed; configure manually"
  fi
else
  log "skipped Tailscale Serve (set ENABLE_TAILSCALE_SERVE=0 to silence)"
fi

cat <<EOF

[deploy] done.

  APP_PORT          : $APP_PORT  (bound to $APP_PORT_BIND)
  env file          : $ENV_FILE  (chmod 600)
  compose file      : $COMPOSE_FILE

  Next steps:
    - Make sure NEXTAUTH_URL in $ENV_FILE matches the HTTPS URL your
      allowlisted users will visit (e.g. https://<host>.${TS_TAILNET:-<tailnet>}.ts.net).
    - Open the app and finish admin onboarding.
    - Rotate ADMIN_PASSWORD after the first successful login.
    - See SECURITY.md and README.md for the Tailscale ACL sketch and
      health checks.
EOF
