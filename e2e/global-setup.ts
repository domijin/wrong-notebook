import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { ADMIN, PW_USER } from './helpers';

// globalSetup runs before Playwright starts webServer, so it does NOT inherit
// `webServer.env` from playwright.config.ts. Pin the same values here, or the
// fixtures land in a different database than the app reads.
process.env.DATABASE_URL = process.env.E2E_DATABASE_URL || 'file:./e2e.db';
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://127.0.0.1:3000';

/**
 * Make the suite self-contained, then seed the accounts it needs.
 *
 * 1. Push the schema into the disposable e2e database. Prisma resolves a
 *    relative SQLite path against prisma/schema.prisma, so the file lands at
 *    prisma/e2e.db and the app (also resolving via DATABASE_URL) finds it.
 *    Without this a fresh checkout fails with "table main.User does not exist".
 * 2. Seed ADMIN — most specs sign in as admin (settings, auth-flow,
 *    upload-correction), and the seeder is the only thing that can create it
 *    with the exact credentials helpers.ts expects.
 * 3. Seed PW_USER — a dedicated ordinary user for the password-change spec.
 *    Deliberately a separate account: rotating the shared admin's password
 *    would sign the other specs out mid-run.
 *
 * Both are reset to their initial password on every run.
 */
export default async function globalSetup() {
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
        env: process.env,
        stdio: 'pipe',
    });

    const prisma = new PrismaClient();
    try {
        const adminPassword = await hash(ADMIN.password, 12);
        await prisma.user.upsert({
            where: { email: ADMIN.email },
            update: {
                password: adminPassword,
                isActive: true,
                role: 'admin',
                sessionVersion: { increment: 1 },
            },
            create: {
                email: ADMIN.email,
                password: adminPassword,
                name: 'E2E Admin',
                role: 'admin',
            },
        });

        const password = await hash(PW_USER.password, 12);
        await prisma.user.upsert({
            where: { email: PW_USER.email },
            update: { password, isActive: true, sessionVersion: { increment: 1 } },
            create: {
                email: PW_USER.email,
                password,
                name: 'E2E Password User',
                role: 'user',
            },
        });

        // Clear throttle/lock state so a previous failed run can't lock accounts out.
        await prisma.authThrottle.deleteMany({
            where: {
                OR: [
                    { key: { contains: PW_USER.email } },
                    { key: { contains: ADMIN.email } },
                ],
            },
        });
    } finally {
        await prisma.$disconnect();
    }
}
