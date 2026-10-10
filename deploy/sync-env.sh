#!/usr/bin/env bash
# sync-env.sh — copy the local .env.local to the WSL host's .env
# and restart the wrong-notebook container so the new env takes effect.
#
# Usage:  ./deploy/sync-env.sh
#   ./deploy/sync-env.sh /path/to/.env.local
#
# Pre:  - deploy/hosts.env sets REMOTE (see hosts.env.example) and ssh
#         access to it works (key auth)
#       - the remote repo lives at ~/wrong-notebook on the WSL host
#       - the container is named wrong-notebook (or override CONTAINER)

set -euo pipefail

# 主机信息放在不提交的 deploy/hosts.env（模板见 hosts.env.example），调用时的环境变量优先
HOSTS_ENV="$(dirname "$0")/hosts.env"
[[ -f "$HOSTS_ENV" ]] && . "$HOSTS_ENV"

SRC="${1:-.env.local}"
REMOTE="${REMOTE:?set REMOTE in deploy/hosts.env (see deploy/hosts.env.example)}"
REMOTE_DIR="${REMOTE_DIR:-~/wrong-notebook}"
CONTAINER="${CONTAINER:-wrong-notebook}"

[[ -f "$SRC" ]] || { echo "missing: $SRC" >&2; exit 1; }

# Don't sync placeholder secrets to production. Force a real one if the
# source file has a placeholder NEXTAUTH_SECRET.
if grep -qE '^NEXTAUTH_SECRET=(supersecret-dev-secret|your_secret_key|changeme|placeholder|dev-only-secret)' "$SRC"; then
  echo "refusing to sync a placeholder NEXTAUTH_SECRET to production" >&2
  echo "rotate NEXTAUTH_SECRET in $SRC first (openssl rand -base64 32)" >&2
  exit 2
fi

# Resolve $REMOTE_DIR on the remote side to avoid tilde expansion issues
# with scp; scp only expands ~ if it's the first char after the colon.
REMOTE_HOME="$(ssh -o ConnectTimeout=10 "$REMOTE" 'printf %s "$HOME"')"
REMOTE_DIR_ABS="${REMOTE_DIR/#\~/$REMOTE_HOME}"

echo "[sync-env] uploading $SRC -> $REMOTE:$REMOTE_DIR_ABS/.env"
scp "$SRC" "$REMOTE:$REMOTE_DIR_ABS/.env.new"
# Feed the script on stdin: `ssh host bash -lc "<multi-line>"` is re-split by
# the remote shell, so bash only ran `set` and the rest ran without `set -e`.
# Variables below expand locally before the script is sent.
ssh "$REMOTE" bash -l -s <<EOF
set -e
cd '$REMOTE_DIR_ABS'
chmod 600 .env.new
mv .env.new .env
echo '[sync-env] recreate $CONTAINER (down + up so compose re-reads .env)'
docker compose down $CONTAINER
docker compose up -d $CONTAINER
sleep 5
echo '[sync-env] /api/version:'
curl -fsS -m 5 http://127.0.0.1:3000/api/version || true
EOF
echo "[sync-env] done"
