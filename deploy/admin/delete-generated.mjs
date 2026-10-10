#!/usr/bin/env node
/**
 * delete-generated.mjs — delete the AI-generated practice questions
 * (source "中考知识点生成"). Lists what would go and changes nothing unless
 * --yes is given. Back up the database first.
 *
 * Run inside the app container (see deploy/admin-run.sh):
 *   node delete-generated.mjs [--owner=<email>] [--yes] [--db=<path>]
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const flags = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
if (flags.db) process.env.DATABASE_URL = `file:${flags.db}`;
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const prisma = new PrismaClient();

try {
  const where = { source: '中考知识点生成' };
  if (typeof flags.owner === 'string') {
    const user = await prisma.user.findUnique({ where: { email: flags.owner }, select: { id: true } });
    if (!user) throw new Error(`no account ${flags.owner}`);
    where.userId = user.id;
  }
  const items = await prisma.errorItem.findMany({
    where,
    select: { id: true, questionText: true, user: { select: { email: true } }, subject: { select: { name: true } } },
  });
  for (const it of items) {
    console.log(`  ${it.id}  ${it.user.email} · ${it.subject?.name || '-'}  ${(it.questionText || '').replace(/\s+/g, ' ').slice(0, 50)}`);
  }
  if (flags.yes !== true) {
    console.log(`${items.length} generated questions would be deleted; re-run with --yes to delete them`);
  } else {
    const { count } = await prisma.errorItem.deleteMany({ where: { id: { in: items.map(i => i.id) } } });
    console.log(`deleted ${count}; error items left: ${await prisma.errorItem.count()}`);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
