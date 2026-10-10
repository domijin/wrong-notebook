# Access — `<wsl-host>` (WSL Ubuntu-24.04)

Proven non-interactive path for wrong-notebook ops from a laptop. The real
host names, users, addresses and ports live in `deploy/HOSTS.local.md`
(git-ignored); this file keeps the procedure with placeholders:

| Placeholder | Meaning |
| --- | --- |
| `<ssh-user>` | the only account allowed to SSH into the WSL distro |
| `<wsl-host>` | the WSL distro's tailnet machine name |
| `<windows-host>` | the Windows machine that runs Tailscale |
| `<tailnet>` | the tailnet's MagicDNS suffix (`<tailnet>.ts.net`) |
| `<tailscale-ip>` | the Windows host's Tailscale address that WSL reaches |

## SSH access

```bash
ssh <ssh-user>@<wsl-host> 'whoami; uname -a'
# <ssh-user>
# Linux <windows-host> ...-microsoft-standard-WSL2 ...
```

- **User:** `<ssh-user>` only; other local accounts are denied.
- **Host:** `<wsl-host>` (the WSL distro; the Windows host is `<windows-host>`).
- **Auth:** key already trusted (no password prompt). `~/.ssh/config` resolves both aliases.
- **Default shell:** bash. Run with `bash -lc` only when you need the login environment; for one-liners use plain `ssh … 'cmd'`.

## Quoting / repeat-pattern reminders

- Avoid inline `ssh … 'bash -lc "…"'` with embedded quotes / `$()`. The triple nesting (local zsh → remote sh → bash) mangles them.
- Prefer **feeding a script on stdin** (`ssh host bash -l -s <<'EOF'`) or scp a script, then `ssh … 'bash /path/to/script.sh'`.
- If a long literal prefix trips a repeat-pattern gate, wrap the varying part in a tiny helper script on the host.

## Other services on this WSL

Other containers already run on the host. Before picking a port, check them
and the loopback listeners instead of relying on a recorded list:

```bash
ssh <ssh-user>@<wsl-host> 'docker ps --format "table {{.Names}}\t{{.Ports}}"; ss -lnt'
```

`deploy/probe-port.sh` picks the first free loopback port in 3000–3010.

## WSL-specific gotchas

- Tailscale lives on the **Windows host** (`<windows-host>`, `<wsl-host>.<tailnet>.ts.net`). `tailscale serve` on the WSL side reaches the host via `<tailscale-ip>:<port>`.
- WSL2 distros are per-Windows-user; a SYSTEM boot task cannot start them. Autostart needs a task that runs at the Windows user's logon.
- Don't bind the app to `0.0.0.0`; bind to `127.0.0.1` (the compose default) and let the host's `tailscale serve` do the rest.
- Stopped a service and it didn't come back? The WSL distro is logon-gated on this host: check that the Windows user is logged in first.
