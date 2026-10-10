#!/usr/bin/env node
/**
 * list-generated.mjs — list the AI-generated practice questions
 * (source "中考知识点生成") by owner and notebook. Read-only.
 *
 * Run inside the app container (see deploy/admin-run.sh):
 *   node list-generated.mjs [--db=<path>]
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const db = process.argv.slice(2).find(a => a.startsWith('--db='));
if (db) process.env.DATABASE_URL = `file:${db.slice(5)}`;
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const prisma = new PrismaClient();

try {
  const items = await prisma.errorItem.findMany({
    where: { source: '中考知识点生成' },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { email: true } },
      subject: { select: { name: true } },
      tags: { where: { isSystem: true }, select: { name: true } },
    },
  });
  console.log(`generated questions: ${items.length}`);

  const groups = new Map();
  for (const it of items) {
    const key = `${it.user.email} · ${it.subject?.name || '(no notebook)'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const [key, list] of groups) {
    console.log(`\n${key}  (${list.length})`);
    for (const it of list) {
      const oneLine = s => (s || '').replace(/\s+/g, ' ');
      console.log(`  * ${it.tags.map(t => t.name).join(', ') || '(no tag)'}  [${it.id}]`);
      console.log(`    Q: ${oneLine(it.questionText).slice(0, 88)}`);
      console.log(`    A: ${oneLine(it.answerText).slice(0, 55)}`);
    }
  }
} finally {
  await prisma.$disconnect();
}
