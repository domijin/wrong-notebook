import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/**
 * Restore one error item's text from a pre-translation database backup,
 * leaving every other row in the live database untouched.
 *
 * Usage:
 *   BACKUP=/data/dev.db.bak-x TARGET=cmv... node restore-one-item.js /data/dev.db
 */
const livePath = process.argv[2] || '/data/dev.db';
const backupPath = process.env.BACKUP;
const targetId = process.env.TARGET;

if (!backupPath || !targetId) {
    console.error('BACKUP and TARGET are required');
    process.exit(2);
}

process.env.DATABASE_URL = `file:${backupPath}`;
const backup = new (require('/app/node_modules/@prisma/client').PrismaClient)();

process.env.DATABASE_URL = `file:${livePath}`;
const live = new (require('/app/node_modules/@prisma/client').PrismaClient)();

const before = await backup.errorItem.findUnique({ where: { id: targetId } });
if (!before) {
    console.error('item not present in backup');
    process.exit(1);
}

await live.errorItem.update({
    where: { id: targetId },
    data: {
        questionText: before.questionText,
        answerText: before.answerText,
        analysis: before.analysis,
        mistakeAnalysis: before.mistakeAnalysis,
        userNotes: before.userNotes,
    },
});

const after = await live.errorItem.findUnique({ where: { id: targetId } });
console.log('restored', targetId);
console.log('  questionText:', (after.questionText || '').slice(0, 70));

await backup.$disconnect();
await live.$disconnect();
