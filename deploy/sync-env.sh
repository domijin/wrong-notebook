#!/usr/bin/env bash
# sync-env.sh — copy the local .env.local to the WSL host's .env
# and restart the wrong-notebook container so the new env takes effect.
#
# Usage:  ./deploy/sync-env.sh
#   ./deploy/sync-env.sh /path/to/.env.local
#
# Pre:  - ssh access to domi-wsl@domis-pc-tools works (key auth)
#       - the remote repo lives at ~/wrong-notebook on the WSL host
#       - the container is named wrong-notebook (or override CONTAINER)

set -euo pipefail

SRC="${1:-.env.local}"
REMOTE="${REMOTE:-domi-wsl@domis-pc-tools}"
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

echo "[sync-env] uploading $SRC -> $REMOTE:$REMOTE_DIR/.env"
scp "$SRC" "$REMOTE:$REMOTE_DIR/.env.new"
ssh "$REMOTE" bash -lc "set -e
cd '$REMOTE_DIR'
chmod 600 .env.new
mv .env.new .env
echo '[sync-env] recreate $CONTAINER (down + up so compose re-reads .env)'
docker compose down $CONTAINER
docker compose up -d $CONTAINER
sleep 5
echo '[sync-env] /api/version:'
curl -fsS -m 5 http://127.0.0.1:3000/api/version || true
"
echo "[sync-env] done"
