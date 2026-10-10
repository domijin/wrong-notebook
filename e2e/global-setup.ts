import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PW_USER } from './helpers';

/**
 * 给改密码测试准备一个独立的普通用户：测试文件会并行跑，
 * 改共享管理员的密码会把正在跑的其他用例踢下线。每次运行都把它重置回初始密码。
 */
export default async function globalSetup() {
    const prisma = new PrismaClient();
    try {
        const password = await hash(PW_USER.password, 12);
        await prisma.user.upsert({
            where: { email: PW_USER.email },
            update: { password, isActive: true, sessionVersion: { increment: 1 } },
            create: { email: PW_USER.email, password, name: 'E2E Password User', role: 'user' },
        });
        await prisma.authThrottle.deleteMany({ where: { key: { contains: PW_USER.email } } });
    } finally {
        await prisma.$disconnect();
    }
}
