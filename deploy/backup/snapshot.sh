#!/usr/bin/env bash
# snapshot.sh — runs on the app host. Writes a consistent snapshot of the SQLite
# database plus the app config (provider settings, including the AI key) to
# stdout as a .tar.gz. The backup machine calls it over SSH with a key that is
# restricted to this one command in ~/.ssh/authorized_keys:
#
#   command="/home/<user>/bin/wrong-notebook-snapshot.sh",restrict ssh-ed25519 AAAA... backup@mini
#
# Install a copy outside the deploy folder (a code sync must not change it):
#   install -m 755 deploy/backup/snapshot.sh ~/bin/wrong-notebook-snapshot.sh
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/wrong-notebook}"
CONTAINER="${CONTAINER:-wrong-notebook}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# SQLite's online backup API copies a consistent database while the app keeps
# writing; a plain cp can catch it half way through a transaction.
python3 - "$APP_DIR/data/dev.db" "$tmp/dev.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
result = dst.execute("PRAGMA integrity_check").fetchone()[0]
src.close()
dst.close()
if result != "ok":
    sys.exit(f"integrity_check failed: {result}")
PY

# The config file belongs to the container user (0600); read it through the container.
docker exec "$CONTAINER" cat /app/config/app-config.json > "$tmp/app-config.json"

tar -C "$tmp" -czf - dev.db app-config.json
