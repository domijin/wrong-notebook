# Deploy (Tailscale)

Files:

- `probe-port.sh` — pick a free loopback TCP port (`PREFERRED_PORT` or 3000–3010)
- `deploy.sh` — one-shot bring-up: probe port, write `.env`, `docker compose up -d`, optional Tailscale Serve
- `env.example` — copy to `.env` (chmod 600) before first run
- `com.wrong-notebook.plist` — macOS launchd agent that keeps `docker compose up` running on boot

## Prereqs

- Docker engine running (OrbStack on Mac mini recommended; Docker Desktop or colima also work)
- Tailscale installed and signed in on the host
- Tailscale ACL tagging the host and allowlisting users (see `../../README.md` and `../../SECURITY.md`)

## One-shot (after `git clone`)

```bash
cd /path/to/wrong-notebook
cp deploy/env.example .env
chmod 600 .env
$EDITOR .env                         # set NEXTAUTH_SECRET, NEXTAUTH_URL, ADMIN_*
./deploy/deploy.sh                   # probes port, writes .env if missing, starts
```

`deploy.sh` will:

1. Probe `PREFERRED_PORT` (if set) or the first free port in 3000–3010.
2. Add or rotate `NEXTAUTH_SECRET` (placeholder values are replaced).
3. Patch `docker-compose.yml` so the published host port matches the probed port.
4. `docker compose up -d`.
5. Run `tailscale serve --https=443 --set-path=/ http://127.0.0.1:<port>` (set `ENABLE_TAILSCALE_SERVE=0` to skip).

## Autostart on macOS (boot/login)

```bash
mkdir -p ~/Library/LaunchAgents ~/wrong-notebook/logs
cp deploy/com.wrong-notebook.plist ~/Library/LaunchAgents/
# edit the plist: replace 'you' and the docker binary path for your engine
launchctl unload ~/Library/LaunchAgents/com.wrong-notebook.plist 2>/dev/null || true
launchctl load   ~/Library/LaunchAgents/com.wrong-notebook.plist
```

Container restart on crash is handled by `restart: always` in compose. The plist keeps the wrapper itself alive.

## Health

```bash
ss -lnt | grep ':3000' | grep 127.0.0.1
docker compose -f docker-compose.yml ps
curl -fsS https://<host>.<tailnet>.ts.net/api/version
docker logs --tail=200 wrong-notebook
```

## Admin scripts

Manual maintenance scripts live in `deploy/admin/`. `admin-run.sh` copies one
into the running container (which has Prisma, the database and the AI config),
runs it there, and removes it again. It reads `REMOTE` from `deploy/hosts.env`.

```bash
./deploy/admin-run.sh ai-ping.mjs                                  # check the active AI provider
./deploy/admin-run.sh generate-questions.mjs --dry-run 数学:3 科学:3 # preview which knowledge points it would use
./deploy/admin-run.sh generate-questions.mjs 数学:3 科学:3           # AI-written practice questions
./deploy/admin-run.sh generate-questions.mjs '浮力的应用|科学'        # one named knowledge point (retry a failure)
./deploy/admin-run.sh list-generated.mjs                           # what has been generated, by owner and notebook
./deploy/admin-run.sh delete-generated.mjs                         # preview; add --yes to delete them
```

- Generated questions are saved as error items with source `中考知识点生成` in
  the owner's notebook for that subject. The answers are AI-written and not
  reviewed. `--owner=<email>` picks the account; without it the only active
  admin gets them. Re-running skips knowledge points that already have one.
- Back up the database before scripts that change data:
  `ssh "$REMOTE" 'docker exec wrong-notebook cp /app/data/dev.db /app/data/dev.db.bak-$(date +%s)'`
- `scripts/screenshot.mjs` runs on your machine instead: it signs in to a
  running instance (`WN_BASE_URL`, `WN_EMAIL`, `WN_PASSWORD`) and saves
  full-page screenshots for visual review.

## Notes on WSL

If the host is a Windows machine running WSL:

- Run the same `deploy.sh` from inside the WSL distribution; the probe will
  see WSL's loopback listeners (not the Windows host's).
- Tailscale on the Windows host already provides the `.ts.net` address;
  install Tailscale inside WSL only if you want WSL-internal routing.
- `tailscale serve` must be run on the host whose hostname appears in the
  HTTPS URL (`NEXTAUTH_URL`).
