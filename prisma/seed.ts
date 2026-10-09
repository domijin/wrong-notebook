import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { seedAdmin } from '../scripts/seed-admin';

const prisma = new PrismaClient();
seedAdmin({ prisma, hash })
    .then(result => console.log(`Admin provisioning: ${result.action}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
