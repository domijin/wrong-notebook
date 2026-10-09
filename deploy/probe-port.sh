#!/usr/bin/env bash
# probe-port.sh — find a free TCP port for the wrong-notebook container
#
# Usage: ./probe-port.sh [start] [end]
#   start default 3000
#   end   default 3010
#
# Exits 0 and prints the first free loopback TCP port.
# Honors a caller-supplied PREFERRED_PORT first.

set -euo pipefail

start="${1:-3000}"
end="${2:-3010}"

is_free() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    if ss -lnt "sport = :$p" 2>/dev/null | awk 'NR>1 {found=1} END {exit !found}'; then
      return 1
    fi
  fi
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      return 1
    fi
  fi
  # Fall back to a TCP connect probe on loopback.
  if (echo > /dev/tcp/127.0.0.1/"$p") 2>/dev/null; then
    return 1
  fi
  return 0
}

if [[ -n "${PREFERRED_PORT:-}" ]] && is_free "${PREFERRED_PORT}"; then
  echo "${PREFERRED_PORT}"
  exit 0
fi

for ((p = start; p <= end; p++)); do
  if is_free "$p"; then
    echo "$p"
    exit 0
  fi
done

echo "No free port in ${start}-${end} on this host" >&2
exit 1
