const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');

async function seedAdmin({ prisma, hash: hashPassword, env = process.env }) {
    // Provision only on an empty installation. Never restore or promote existing accounts.
    if (await prisma.user.count()) return { action: 'skipped' };
    const email = env.ADMIN_EMAIL?.trim();
    const password = env.ADMIN_PASSWORD;
    if (!email && !password && env.NODE_ENV !== 'production') return { action: 'skipped' };
    if (!email || !/^[^\s@]+@[^\s@]+$/.test(email) || !password || password.length < 12 || Buffer.byteLength(password) > 72
        || /^(123456|password|change.?me|your[_-]|replace|example)/i.test(password)) {
        throw new Error('First-time provisioning requires ADMIN_EMAIL and a strong ADMIN_PASSWORD (12–72 bytes)');
    }
    await prisma.user.create({ data: {
        email, password: await hashPassword(password, 12), name: env.ADMIN_NAME || 'Admin',
        role: 'admin', isActive: true,
    } });
    return { action: 'created', email };
}

async function main() {
    const prisma = new PrismaClient();
    try {
        const result = await seedAdmin({ prisma, hash });
        console.log(result.action === 'created' ? 'First-time admin provisioned.' : 'Existing accounts left unchanged.');
    } finally { await prisma.$disconnect(); }
}
if (require.main === module) {
    main().catch(error => { console.error(error.message); process.exit(1); });
}
module.exports = { seedAdmin };
