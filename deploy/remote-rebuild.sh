#!/usr/bin/env bash
# remote-rebuild.sh — patch remote compose to build from local Dockerfile,
# drop the wrong image, build, and start the patched app.
set -euo pipefail
# 主机信息放在不提交的 deploy/hosts.env（模板见 hosts.env.example），调用时的环境变量优先
HOSTS_ENV="$(dirname "$0")/hosts.env"
[[ -f "$HOSTS_ENV" ]] && . "$HOSTS_ENV"
REMOTE="${REMOTE:?set REMOTE in deploy/hosts.env (see deploy/hosts.env.example)}"
NEXTAUTH_URL_VAL="${NEXTAUTH_URL_VAL:?set NEXTAUTH_URL_VAL in deploy/hosts.env}"
SSH_OPTS=(-o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ConnectTimeout=10)
runr() { ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"; }
# 远端命令里路径被单引号包住，~ 不会展开，所以先在远端解析 $HOME
REMOTE_DIR="${REMOTE_DIR:-~/wrong-notebook}"
REMOTE_DIR="${REMOTE_DIR/#\~/$(runr 'printf %s "$HOME"')}"

log()  { printf '[rebuild] %s\n' "$*" >&2; }

log "patch docker-compose.yml to build from ./Dockerfile"
runr bash -lc "set -e
cd '$REMOTE_DIR'
# Insert build context after 'services: wrong-notebook:'
python3 - <<PY
from pathlib import Path
p = Path('docker-compose.yml')
t = p.read_text()
if 'build:' not in t:
    needle = '    image: ghcr.io/wttwins/wrong-notebook:latest\n'
    repl = '    image: wrong-notebook:local\n    build:\n      context: .\n      dockerfile: Dockerfile\n'
    assert needle in t, 'compose image line not found'
    p.write_text(t.replace(needle, repl, 1))
    print('compose patched')
else:
    print('compose already has build:')
PY
"

log "down + remove old image, build local, up"
runr bash -lc "set -e
cd '$REMOTE_DIR'
set -a; . ./.env; set +a
docker compose down --remove-orphans || true
docker rmi ghcr.io/wttwins/wrong-notebook:latest 2>/dev/null || true
docker compose build --pull
docker compose up -d
"

log "verify"
runr bash -lc "set -e
echo '--- container ---'
docker ps --filter name=wrong-notebook --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
echo '--- env ---'
docker exec wrong-notebook env | grep -E 'NEXTAUTH_(URL|SECRET)|ADMIN_|DATABASE_URL'
echo '--- loopback listener ---'
ss -lnt 'sport = :3000' 2>/dev/null
echo '--- /api/version ---'
for i in 1 2 3 4 5 6 7 8 9 10; do
  v=\$(curl -fsS -m 4 http://127.0.0.1:3000/api/version 2>/dev/null) && { echo \"\$v\"; break; }
  echo \"  wait \$i\"
  sleep 3
done
echo '--- final image ---'
docker images wrong-notebook --format 'table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedSince}}'
"
