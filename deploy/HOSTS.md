# Access — `<wsl-host>` (WSL Ubuntu-24.04)

Proven non-interactive path for wrong-notebook ops from this laptop.

## SSH access

```bash
ssh <ssh-user>@<wsl-host> 'whoami; uname -a'
# <ssh-user>
# Linux Domis-PC 6.18.40.1-microsoft-standard-WSL2 ...
```

- **User:** `<ssh-user>` (NOT other local accounts — those are denied).
- **Host:** `<wsl-host>` (the WSL distro; the Windows host is `<windows-host>`).
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
<other-service-1>   <image-id>             Up 17h       <tailscale-ip>:8770->8000/tcp
<other-service-2>           <other-service-2>:3.4.0   Up 17h       0.0.0.0:8791->8791/tcp
```

Don't collide with 8770 (<other-service-1>) or 8791 (<other-service-2>).

## Port landscape (probed 2026-10-09, all loopback)

Free: 80, 443, 3000, 3001, 4000, 4173, 5000, 5050, 5432, 6379, 7070, 8000, 8080, 8443, 9000, 9090, 9443, 10000, 10080, 20080.
Take: 22 (sshd), 53 (systemd-resolved), 8770 (<other-service-1>), 8791 (<other-service-2>), <tailscale-ip>:52070 (tailscaled health).

## WSL-specific gotchas

- Tailscale lives on the **Windows host** (`<windows-host>`, `<wsl-host>.<tailnet>.ts.net`). `tailscale serve` on the WSL side reaches the host via `<tailscale-ip>:<port>`.
- WSL2 distros are per-Windows-user; a SYSTEM boot task cannot start them (per `memory/scars/2026-06-24-system-task-cannot-boot-per-user-wsl2-distro.md`). The current autostart is the user's `start-wsl-tools` AtLogon task.
- Don't bind the app to `0.0.0.0`; bind to `127.0.0.1` (the compose default) and let the host's `tailscale serve` do the rest.
- Stopped a service and it didn't come back? Re-check the `<windows-host>` runbook entry first — the WSL distro is logon-gated on this host.

## Reference

- `assistant/docs/container-host-<windows-host>-spec_2026-06-14.md` — host facts, host hardware and OS lifecycle notes
- `assistant/docs/runbooks/<windows-host>-cutover-runbook.md` — access patterns + authority model
- `assistant/memory/scars/2026-06-14-nested-ssh-wsl-bash-lc-inline-quote-mangle.md`
