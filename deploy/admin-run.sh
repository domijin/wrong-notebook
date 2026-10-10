#!/usr/bin/env bash
# admin-run.sh — run one of the deploy/admin/*.mjs scripts inside the live
# wrong-notebook container, which has Prisma, the database and the AI config.
#
# Usage:  ./deploy/admin-run.sh <script> [args...]
#   ./deploy/admin-run.sh list-generated.mjs
#   ./deploy/admin-run.sh generate-questions.mjs --dry-run 数学:3
#   ./deploy/admin-run.sh delete-generated.mjs --yes
#
# Pre:  deploy/hosts.env sets REMOTE (see hosts.env.example) and ssh access to
#       it works; override CONTAINER if it isn't named wrong-notebook.
#       Scripts that change data don't back up the database; back it up first:
#         ssh "$REMOTE" 'docker exec wrong-notebook cp /app/data/dev.db /app/data/dev.db.bak-$(date +%s)'

set -euo pipefail

HOSTS_ENV="$(dirname "$0")/hosts.env"
[[ -f "$HOSTS_ENV" ]] && . "$HOSTS_ENV"

REMOTE="${REMOTE:?set REMOTE in deploy/hosts.env (see deploy/hosts.env.example)}"
CONTAINER="${CONTAINER:-wrong-notebook}"

SCRIPT="${1:?usage: admin-run.sh <script> [args...] (scripts live in deploy/admin/)}"
shift
SRC="$(dirname "$0")/admin/$(basename "$SCRIPT")"
[[ -f "$SRC" ]] || { echo "missing: $SRC" >&2; exit 1; }

DEST="/tmp/$(basename "$SRC")"
# Quote each argument for the remote shell so values like '浮力|科学' survive.
ARGS=""
for arg in "$@"; do ARGS+=" $(printf '%q' "$arg")"; done

ssh "$REMOTE" "docker exec -i $CONTAINER sh -c 'cat > $DEST'" < "$SRC"
ssh -t "$REMOTE" "docker exec $CONTAINER node $DEST$ARGS; status=\$?; docker exec $CONTAINER rm -f $DEST; exit \$status"
