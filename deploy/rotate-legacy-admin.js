// rotate-legacy-admin.js — rotate the password + email of the legacy
// "admin@localhost" account left over from the upstream public image.
//
// Usage:  ADMIN_PW=... node rotate-legacy-admin.js /path/to/dev.db
//
// The DB is provided as an argument; defaults to ./prisma/dev.db.
// Connects via Prisma. Idempotent: if the legacy admin doesn't exist,
// creates a new admin with the env ADMIN_EMAIL / ADMIN_PW (and a
// sessionVersion of 1).

const path = require("path");
const { PrismaClient } = require(path.join("/app", "node_modules", "@prisma", "client"));
const bcrypt = require("/app/node_modules/bcryptjs");

const dbPath = process.argv[2] || "/data/dev.db";
const newEmail = process.env.ADMIN_EMAIL || "domi.kingdom@gmail.com";
const newPassword = process.env.ADMIN_PW;
if (!newPassword || newPassword.length < 12) {
  console.error("ADMIN_PW must be set and at least 12 chars");
  process.exit(2);
}

process.env.DATABASE_URL = `file:${dbPath}`;

(async () => {
  const p = new PrismaClient();
  try {
    const existing = await p.user.findUnique({ where: { email: "admin@localhost" } });
    const hash = await bcrypt.hash(newPassword, 12);
    if (existing) {
      const updated = await p.user.update({
        where: { email: "admin@localhost" },
        data: {
          email: newEmail,
          password: hash,
          isActive: true,
          role: "admin",
          sessionVersion: (existing.sessionVersion || 0) + 1,
        },
      });
      console.log("rotated legacy admin ->", updated.email, "role=" + updated.role, "isActive=" + updated.isActive);
    } else {
      // No legacy admin: create fresh
      const created = await p.user.create({
        data: {
          email: newEmail,
          password: hash,
          name: "Admin",
          role: "admin",
          isActive: true,
        },
      });
      console.log("created new admin ->", created.email, "role=" + created.role);
    }
  } catch (e) {
    console.error("FAIL:", e.message);
    process.exitCode = 1;
  } finally {
    await p.$disconnect();
  }
})();
