#!/usr/bin/env bash
# pull-backup.sh — runs on the backup machine. Pulls a snapshot from the app host
# (see snapshot.sh), checks it, stores it, and keeps the newest $KEEP copies.
# The backup machine pulls, so a compromised app host cannot reach or delete
# the backups.
#
#   BACKUP_SOURCE=user@app-host ./pull-backup.sh
#
# Env: BACKUP_SOURCE (required), BACKUP_KEY (default ~/.ssh/wrong-notebook-backup),
#      BACKUP_DIR (default ~/backups/wrong-notebook), KEEP (default 30).
set -euo pipefail

SRC="${BACKUP_SOURCE:?set BACKUP_SOURCE=user@app-host}"
KEY="${BACKUP_KEY:-$HOME/.ssh/wrong-notebook-backup}"
DEST="${BACKUP_DIR:-$HOME/backups/wrong-notebook}"
KEEP="${KEEP:-30}"

umask 077
mkdir -p "$DEST"
out="$DEST/wrong-notebook-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
part="$out.part"
check="$(mktemp -d)"
trap 'rm -rf "$check" "$part"' EXIT

# The key is restricted to snapshot.sh on the app host, so no remote command is given.
ssh -T -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=20 "$SRC" > "$part"

# Only keep a snapshot that unpacks, passes SQLite's integrity check and has its tables.
tar -C "$check" -xzf "$part"
[[ "$(sqlite3 "$check/dev.db" 'PRAGMA integrity_check;')" == ok ]] || { echo "integrity check failed" >&2; exit 1; }
users="$(sqlite3 "$check/dev.db" 'SELECT count(*) FROM "User";')"
items="$(sqlite3 "$check/dev.db" 'SELECT count(*) FROM "ErrorItem";')"
mv "$part" "$out"

# Keep the newest $KEEP snapshots by count, not by age, so a long outage never
# leaves the folder empty. The UTC timestamps in the names sort chronologically.
snapshots=("$DEST"/wrong-notebook-*.tar.gz)
for ((i = 0; i < ${#snapshots[@]} - KEEP; i++)); do rm -f "${snapshots[i]}"; done

echo "$(date -u +%FT%TZ) ok $(basename "$out") users=$users items=$items size=$(du -h "$out" | cut -f1)"
