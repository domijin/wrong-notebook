/**
 * 系统标签重建脚本 - 可在 Docker entrypoint 中自动运行
 * 用于版本升级时自动重建系统标签并保留关联关系
 */
import { PrismaClient } from '@prisma/client';
import { seedSystemTags, findSystemTagByName } from '../src/lib/tag-data/seed';

const prisma = new PrismaClient();

interface TagAssociation {
    errorItemId: string;
    tagName: string;
    subject: string;
}

async function main() {
    console.log('[RebuildTags] Starting automatic system tag rebuild...');

    let totalCreated = 0;
    let associationsRestored = 0;
    let customTagsCreated = 0;

    await prisma.$transaction(async (tx) => {
        // ========== STEP 1: 备份现有关联关系 ==========
        console.log('[RebuildTags] Step 1: Backing up tag associations...');
        const associations: TagAssociation[] = [];

        const errorItemsWithSystemTags = await tx.errorItem.findMany({
            select: {
                id: true,
                tags: {
                    where: { isSystem: true },
                    select: { name: true, subject: true }
                }
            }
        });

        for (const item of errorItemsWithSystemTags) {
            for (const tag of item.tags) {
                associations.push({
                    errorItemId: item.id,
                    tagName: tag.name,
                    subject: tag.subject,
                });
            }
        }
        console.log(`[RebuildTags] Backed up ${associations.length} associations from ${errorItemsWithSystemTags.length} items`);

        // ========== STEP 2: 删除旧标签并重建 ==========
        console.log('[RebuildTags] Step 2: Rebuilding system tags...');

        totalCreated = await seedSystemTags(tx);

        console.log(`[RebuildTags] Created ${totalCreated} tags`);

        // ========== STEP 3: 恢复关联关系 ==========
        console.log('[RebuildTags] Step 3: Restoring associations...');

        const associationsByItem = new Map<string, TagAssociation[]>();
        for (const assoc of associations) {
            const list = associationsByItem.get(assoc.errorItemId) || [];
            list.push(assoc);
            associationsByItem.set(assoc.errorItemId, list);
        }

        // 获取第一个 admin 用户用于创建自定义标签
        const adminUser = await tx.user.findFirst({
            where: { role: 'admin' },
            select: { id: true }
        });

        for (const [errorItemId, itemAssociations] of associationsByItem) {
            const newTagIds: string[] = [];

            for (const assoc of itemAssociations) {
                const newTag = await findSystemTagByName(tx, assoc.tagName, assoc.subject);

                if (newTag) {
                    newTagIds.push(newTag.id);
                    associationsRestored++;
                } else if (adminUser) {
                    // 系统标签未找到，创建为自定义标签
                    console.warn(`[RebuildTags] Tag not found: "${assoc.tagName}" (${assoc.subject}), creating as custom tag`);

                    let customTag = await tx.knowledgeTag.findFirst({
                        where: {
                            name: assoc.tagName,
                            subject: assoc.subject,
                            userId: adminUser.id
                        },
                        select: { id: true }
                    });

                    if (!customTag) {
                        customTag = await tx.knowledgeTag.create({
                            data: {
                                name: assoc.tagName,
                                subject: assoc.subject,
                                isSystem: false,
                                userId: adminUser.id,
                            },
                            select: { id: true }
                        });
                        customTagsCreated++;
                    }

                    newTagIds.push(customTag.id);
                    associationsRestored++;
                }
            }

            if (newTagIds.length > 0) {
                await tx.errorItem.update({
                    where: { id: errorItemId },
                    data: {
                        tags: {
                            connect: newTagIds.map(id => ({ id }))
                        }
                    }
                });
            }
        }

        console.log(`[RebuildTags] Restored ${associationsRestored} associations, created ${customTagsCreated} custom tags`);
    }, {
        timeout: 120000
    });

    console.log(`[RebuildTags] Completed. System tags: ${totalCreated}, Associations: ${associationsRestored}, Custom tags: ${customTagsCreated}`);
}

main()
    .catch((e) => {
        console.error('[RebuildTags] Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
