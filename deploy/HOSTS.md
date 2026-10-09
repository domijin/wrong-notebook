# Access — `domis-pc-tools` (WSL Ubuntu-24.04)

Proven non-interactive path for wrong-notebook ops from this laptop.

## SSH access

```bash
ssh domi-wsl@domis-pc-tools 'whoami; uname -a'
# domi-wsl
# Linux Domis-PC 6.18.40.1-microsoft-standard-WSL2 ...
```

- **User:** `domi-wsl` (NOT `domijin` / `windy` / `domi` — those are denied).
- **Host:** `domis-pc-tools` (the WSL distro; the Windows host is `domis-pc`).
- **Auth:** key already trusted (no password prompt). `~/.ssh/config` resolves both aliases.
- **Default shell:** bash. Run with `bash -lc` only when you need the login environment; for one-liners use plain `ssh … 'cmd'`.

## Quoting / repeat-pattern reminders

Lessons from the assistant repo scars — apply when scripting:

- Avoid inline `ssh … 'bash -lc "…"'` with embedded quotes / `$()`. The triple nesting (local zsh → remote sh → bash) mangles them.
- Prefer **scp a script, then `ssh … 'bash /path/to/script.sh'`**, or feed via stdin for non-trivial code.
- If a long literal prefix trips the repeat-pattern gate (3×), wrap the varying part in a tiny helper at HOME: `~/.claude-dpush.sh <script> <wsl|ps>`.

## Already-running services on this WSL

```
NAMES              IMAGE                    STATUS       PORTS
healthchecks-dms   6b5f593d4099             Up 17h       100.66.58.7:8770->8000/tcp
alakazam           alakazam-replica:3.4.0   Up 17h       0.0.0.0:8791->8791/tcp
```

Don't collide with 8770 (healthchecks) or 8791 (alakazam).

## Port landscape (probed 2026-10-09, all loopback)

Free: 80, 443, 3000, 3001, 4000, 4173, 5000, 5050, 5432, 6379, 7070, 8000, 8080, 8443, 9000, 9090, 9443, 10000, 10080, 20080.
Take: 22 (sshd), 53 (systemd-resolved), 8770 (healthchecks-dms), 8791 (alakazam), 100.66.58.7:52070 (tailscaled health).

## WSL-specific gotchas

- Tailscale lives on the **Windows host** (`domis-pc`, `domis-pc-tools.taila7d2b1.ts.net`). `tailscale serve` on the WSL side reaches the host via `100.66.58.7:<port>`.
- WSL2 distros are per-Windows-user; a SYSTEM boot task cannot start them (per `memory/scars/2026-06-24-system-task-cannot-boot-per-user-wsl2-distro.md`). The current autostart is the user's `start-wsl-tools` AtLogon task.
- Don't bind the app to `0.0.0.0`; bind to `127.0.0.1` (the compose default) and let the host's `tailscale serve` do the rest.
- Stopped a service and it didn't come back? Re-check the `domis-pc` runbook entry first — the WSL distro is logon-gated on this host.

## Reference

- `assistant/docs/container-host-domis-pc-spec_2026-06-14.md` — host facts, BitLocker/TPM, ESU cliff (~Oct 2026)
- `assistant/docs/runbooks/mempalace-domis-pc-cutover-runbook.md` — access patterns + authority model
- `assistant/memory/scars/2026-06-14-nested-ssh-wsl-bash-lc-inline-quote-mangle.md`
