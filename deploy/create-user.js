// create-user.js — create a user account from env vars (bypasses the
// registration toggle, which defaults to off).
//
// Usage:
//   ADMIN_EMAIL=... ADMIN_PW=... node create-user.js /data/dev.db
//
// Optional: USER_NAME, USER_STAGE (primary|junior_high|senior_high|university),
//           USER_YEAR (enrollment year, e.g. 2026)
// If the email already exists, prints the existing row instead of failing.
//
// Run inside the app image with /data mounted, e.g.:
//
//   docker run --rm \
//     -v ~/wrong-notebook/data:/data \
//     -v ~/wrong-notebook/create-user.js:/app/create-user.js:ro \
//     -e ADMIN_EMAIL='kid@example.com' -e ADMIN_PW='...' \
//     -e USER_NAME='Kid' -e USER_STAGE=junior_high -e USER_YEAR=2026 \
//     --entrypoint /bin/sh wrong-notebook:local \
//     -c 'node /app/create-user.js /data/dev.db'

const path = require("path");
const { PrismaClient } = require(path.join("/app", "node_modules", "@prisma", "client"));
const bcrypt = require("/app/node_modules/bcryptjs");

const dbPath = process.argv[2] || "/data/dev.db";
const email = (process.env.ADMIN_EMAIL || "").trim();
const password = process.env.ADMIN_PW || "";
const name = process.env.USER_NAME || email.split("@")[0];
const stage = process.env.USER_STAGE || "junior_high";
const year = process.env.USER_YEAR ? parseInt(process.env.USER_YEAR, 10) : undefined;

if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) {
  console.error("ADMIN_EMAIL is required and must look like an email");
  process.exit(2);
}
if (!password || [...password].length < 12 || Buffer.byteLength(password) > 72) {
  console.error("ADMIN_PW must be at least 12 characters and at most 72 bytes");
  process.exit(2);
}

process.env.DATABASE_URL = `file:${dbPath}`;

(async () => {
  const p = new PrismaClient();
  try {
    const existing = await p.user.findUnique({ where: { email } });
    if (existing) {
      console.log(
        `already exists: ${existing.email} role=${existing.role} isActive=${existing.isActive}`
      );
      process.exitCode = 3;
      return;
    }

    const created = await p.user.create({
      data: {
        email,
        name,
        password: await bcrypt.hash(password, 12),
        role: "user",
        isActive: true,
        educationStage: stage,
        enrollmentYear: Number.isNaN(year) ? undefined : year,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        educationStage: true,
        enrollmentYear: true,
      },
    });

    console.log(
      `created: ${created.email} role=${created.role} isActive=${created.isActive} ` +
        `stage=${created.educationStage} year=${created.enrollmentYear}`
    );
  } catch (e) {
    console.error("FAIL:", e.message);
    process.exitCode = 1;
  } finally {
    await p.$disconnect();
  }
})();