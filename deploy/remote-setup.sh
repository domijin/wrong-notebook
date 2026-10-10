#!/usr/bin/env bash
# remote-setup.sh — bootstrap wrong-notebook on the WSL host in deploy/hosts.env.
# Run LOCALLY. Streams progress to stderr; only the last "ok" line goes to stdout.

set -euo pipefail

# 主机信息放在不提交的 deploy/hosts.env（模板见 hosts.env.example），调用时的环境变量优先
HOSTS_ENV="$(dirname "$0")/hosts.env"
[[ -f "$HOSTS_ENV" ]] && . "$HOSTS_ENV"
REMOTE="${REMOTE:?set REMOTE in deploy/hosts.env (see deploy/hosts.env.example)}"
# REMOTE_DIR is resolved on the REMOTE side (uses remote $HOME)
REMOTE_DIR="${REMOTE_DIR:-~/wrong-notebook}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
SSH_OPTS=(-o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ConnectTimeout=10)
APP_PORT="${APP_PORT:-3000}"

log()  { printf '[deploy] %s\n' "$*" >&2; }
die()  { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }
runr() { ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"; }

log "verify ssh to $REMOTE"
runr 'command -v docker >/dev/null && docker info >/dev/null 2>&1 && echo "docker ok" || { echo "docker missing" >&2; exit 1; }' \
  || die "remote docker not ready"

log "port probe on $REMOTE (prefer $APP_PORT)"
PORT_CHOICE="$(runr "command -v ss >/dev/null && ss -lnt 'sport = :$APP_PORT' 2>/dev/null | awk 'NR>1{found=1} END{exit !found}' && echo taken || echo free" || true)"
if [[ "$PORT_CHOICE" == "taken" ]]; then
  log "warn: $APP_PORT taken on remote; trying 3001"
  APP_PORT=3001
fi
log "APP_PORT=$APP_PORT"

log "ensure $REMOTE_DIR exists on remote"
runr "mkdir -p '$REMOTE_DIR'"

log "rsync repo -> $REMOTE_DIR"
# Exclude heavy/unneeded bits. Note: REMOTE_DIR is a tilde-path; rsync to a
# literal path. Expand on the remote first.
REMOTE_HOME="$(runr 'printf "%s" "$HOME"' )"
REMOTE_DIR_ABS="${REMOTE_DIR/#\~/$REMOTE_HOME}"
log "remote HOME=$REMOTE_HOME  REMOTE_DIR_ABS=$REMOTE_DIR_ABS"

rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude '.next' --exclude 'data' --exclude 'config' \
  --exclude '/logs' --exclude 'coverage' --exclude '.env' --exclude '*.log' \
  --exclude '.assistant-staging' --exclude '*.bak' \
  -e "ssh ${SSH_OPTS[*]}" \
  "$REPO_DIR/" "$REMOTE:$REMOTE_DIR_ABS/"

log "build env on remote"
NEXTAUTH_SECRET_VAL="${NEXTAUTH_SECRET_VAL:-$(openssl rand -base64 32)}"
NEXTAUTH_URL_VAL="${NEXTAUTH_URL_VAL:?set NEXTAUTH_URL_VAL in deploy/hosts.env}"

runr bash -lc "set -e
cd '$REMOTE_DIR_ABS/deploy'
APP_PORT='$APP_PORT' NEXTAUTH_URL='$NEXTAUTH_URL_VAL' NEXTAUTH_SECRET='$NEXTAUTH_SECRET_VAL' \
  ENABLE_TAILSCALE_SERVE=0 \
  REPO_DIR='$REMOTE_DIR_ABS' \
  bash ./deploy.sh
"

log "patch compose publish port to $APP_PORT on remote (if not already)"
runr "grep -q '127.0.0.1:${APP_PORT}:3000' '$REMOTE_DIR_ABS/docker-compose.yml' || sed -i -E 's|\"127.0.0.1:[0-9]+:3000\"|\"127.0.0.1:${APP_PORT}:3000\"|g' '$REMOTE_DIR_ABS/docker-compose.yml'"

log "compose up -d on remote"
runr "cd '$REMOTE_DIR_ABS' && docker compose up -d"

log "verify container status"
runr "docker ps --filter name=wrong-notebook --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"

log "verify loopback listener"
runr "ss -lnt 'sport = :3000' 2>/dev/null | head -3"

log "smoke /api/version from remote loopback"
runr "curl -fsS -m 10 http://127.0.0.1:3000/api/version || true"

cat <<EOF

[deploy] REMOTE OK.

  remote host     : $REMOTE
  remote dir      : $REMOTE_DIR
  APP_PORT        : $APP_PORT (bound to 127.0.0.1)
  NEXTAUTH_URL    : $NEXTAUTH_URL_VAL

  Next (on the WINDOWS host that runs Tailscale, not WSL):
    ssh ${WINDOWS_HOST:-<windows-host>} 'tailscale serve --https=443 --set-path=/ http://${REMOTE#*@}:$APP_PORT'
    # Or use the WSL host's Tailscale IP if MagicDNS does not resolve it there.

  Then open $NEXTAUTH_URL_VAL in your tailnet browser.

  After first admin login, rotate ADMIN_PASSWORD and remove it from
  $REMOTE_DIR/.env on the remote.
EOF
