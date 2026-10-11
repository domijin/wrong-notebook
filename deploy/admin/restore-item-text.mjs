#!/usr/bin/env node
/**
 * restore-item-text.mjs — put an error item's text back from a database backup,
 * for example after an old build overwrote originals with a machine translation.
 * Only the text fields (question, answer, analysis, mistake analysis, notes) of
 * the chosen items change; nothing else in the live database is touched.
 *
 * Run inside the app container (see deploy/admin-run.sh):
 *   node restore-item-text.mjs --backup=/app/data/dev.db.bak-<ts>            # list items whose text differs
 *   node restore-item-text.mjs --backup=/app/data/dev.db.bak-<ts> --id=<id>   # preview one item
 *   node restore-item-text.mjs --backup=/app/data/dev.db.bak-<ts> --id=<id> --yes
 *
 * Options: --db=<live path> (default: the image's DATABASE_URL).
 * Back up the live database first.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('/app/node_modules/@prisma/client');

const FIELDS = ['questionText', 'answerText', 'analysis', 'mistakeAnalysis', 'userNotes'];
const flags = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
if (typeof flags.backup !== 'string') {
  console.error('usage: restore-item-text.mjs --backup=<backup db> [--id=<item id>] [--yes] [--db=<live db>]');
  process.exit(2);
}

// Each client gets its own URL explicitly. Setting DATABASE_URL twice does not work:
// Prisma reads it when it first connects, so both clients would open the same file.
const liveUrl = typeof flags.db === 'string' ? `file:${flags.db}` : process.env.DATABASE_URL;
const live = new PrismaClient({ datasources: { db: { url: liveUrl } } });
const backup = new PrismaClient({ datasources: { db: { url: `file:${flags.backup}` } } });
const short = s => (s || '').replace(/\s+/g, ' ').slice(0, 70);

try {
  const select = Object.fromEntries([['id', true], ['userId', true], ...FIELDS.map(f => [f, true])]);
  const where = typeof flags.id === 'string' ? { id: flags.id } : {};
  const [before, now] = await Promise.all([backup.errorItem.findMany({ where, select }), live.errorItem.findMany({ where, select })]);
  const liveById = new Map(now.map(i => [i.id, i]));
  const changed = before
    .map(old => ({ old, cur: liveById.get(old.id) }))
    .filter(({ cur }) => cur)
    .map(({ old, cur }) => ({ id: old.id, fields: FIELDS.filter(f => (old[f] ?? '') !== (cur[f] ?? '')), old, cur }))
    .filter(c => c.fields.length);

  if (!changed.length) console.log('no text differences between the backup and the live database');
  for (const c of changed) {
    console.log(`${c.id}  fields: ${c.fields.join(', ')}`);
    for (const f of c.fields) console.log(`    ${f}\n      backup: ${short(c.old[f])}\n      live:   ${short(c.cur[f])}`);
  }

  if (typeof flags.id === 'string' && changed.length) {
    if (flags.yes !== true) {
      console.log('preview only; add --yes to restore these fields from the backup');
    } else {
      const c = changed[0];
      await live.errorItem.update({ where: { id: c.id }, data: Object.fromEntries(c.fields.map(f => [f, c.old[f]])) });
      console.log(`restored ${c.fields.length} field(s) of ${c.id}`);
    }
  } else if (changed.length) {
    console.log('pass --id=<item id> to preview and restore one item');
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
} finally {
  await Promise.all([live.$disconnect(), backup.$disconnect()]);
}
