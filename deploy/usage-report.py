#!/usr/bin/env python3
"""Print a quick usage summary from the wrong-notebook SQLite DB.

Usage:
  python3 deploy/usage-report.py [path/to/dev.db]
  DB_PATH=./data/dev.db python3 deploy/usage-report.py
  DATABASE_URL=file:./prisma/dev.db python3 deploy/usage-report.py
"""

from __future__ import annotations

import collections
import datetime
import os
import sqlite3
import sys
from pathlib import Path


def resolve_db_path() -> Path:
    if len(sys.argv) > 1:
        raw = sys.argv[1]
    else:
        raw = os.environ.get("DB_PATH") or os.environ.get("DATABASE_URL") or ""
        if raw.startswith("file:"):
            raw = raw[len("file:") :]
    if not raw:
        # repo-relative defaults (local / deploy layouts)
        here = Path(__file__).resolve().parent
        for candidate in (
            here.parent / "prisma" / "dev.db",
            here.parent / "data" / "dev.db",
            Path("prisma/dev.db"),
            Path("data/dev.db"),
        ):
            if candidate.is_file():
                return candidate
        print(
            "usage: usage-report.py <path/to/dev.db>\n"
            "   or: DB_PATH=... / DATABASE_URL=file:... usage-report.py",
            file=sys.stderr,
        )
        sys.exit(2)
    path = Path(raw).expanduser()
    if not path.is_file():
        print(f"DB not found: {path}", file=sys.stderr)
        sys.exit(1)
    return path


def ts(v: object) -> str:
    try:
        n = int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return str(v)[:19]
    if n > 10**12:
        n //= 1000
    return datetime.datetime.fromtimestamp(n).strftime("%Y-%m-%d %H:%M")


db_path = resolve_db_path()
print(f"(db: {db_path})")
con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
con.row_factory = sqlite3.Row

print("=== ERROR ITEMS BY DATE ===")
rows = con.execute("SELECT createdAt FROM ErrorItem").fetchall()
by = collections.Counter(ts(r["createdAt"])[:10] for r in rows)
for d in sorted(by):
    print("  %s  %d item(s)" % (d, by[d]))

print()
print("=== ERROR ITEMS BY SUBJECT ===")
for r in con.execute(
    "SELECT COALESCE(s.name,'(none)') nm, count(*) n FROM ErrorItem e "
    "LEFT JOIN Subject s ON s.id=e.subjectId GROUP BY nm ORDER BY n DESC"
):
    print("  %-14s %d" % (r["nm"], r["n"]))

print()
print("=== LAST MODIFIED (per user) ===")
for r in con.execute(
    "SELECT u.email, max(e.updatedAt) last, count(*) n FROM ErrorItem e "
    "JOIN User u ON u.id=e.userId GROUP BY u.email"
):
    print("  %-28s %d items, last touched %s" % (r["email"], r["n"], ts(r["last"])))

print()
print("=== PRACTICE RECORDS ===")
for r in con.execute(
    "SELECT u.email, count(*) n, max(p.createdAt) last FROM PracticeRecord p "
    "JOIN User u ON u.id=p.userId GROUP BY u.email"
):
    print("  %-28s %d practice, last %s" % (r["email"], r["n"], ts(r["last"])))

print()
print("=== AI USAGE (daily) ===")
for r in con.execute(
    "SELECT key,count,updatedAt FROM AiUsageCounter ORDER BY updatedAt DESC LIMIT 8"
):
    print("  %-46s %3d  (%s)" % (r["key"], r["count"], ts(r["updatedAt"])))

print()
print("=== AUDIT LOG (recent 12) ===")
for r in con.execute(
    "SELECT createdAt, actorId, action, target FROM AuditLog ORDER BY createdAt DESC LIMIT 12"
):
    who = (r["actorId"] or "system")[:12]
    print(
        "  %s  %-12s %-16s %s"
        % (ts(r["createdAt"]), who, r["action"], str(r["target"])[:20])
    )

print()
print("=== TRANSLATIONS ===")
for r in con.execute(
    "SELECT language, count(*) n FROM ErrorItemTranslation GROUP BY language ORDER BY n DESC"
):
    print("  %-8s %d" % (r["language"], r["n"]))

print()
print("=== AUTH THROTTLE ===")
rows = con.execute(
    "SELECT * FROM AuthThrottle ORDER BY lastFailureAt DESC LIMIT 8"
).fetchall()
for r in rows:
    print(
        "  %-46s failures=%s locked=%s"
        % (r["key"], r["failures"], ts(r["lockedUntil"]) if r["lockedUntil"] else "no")
    )
if not rows:
    print("  (empty)")
