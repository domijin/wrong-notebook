import { adminAction } from "@/lib/admin-action";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { internalError, unauthorized, forbidden } from "@/lib/api-errors";
import { seedSystemTags, findSystemTagByName } from "@/lib/tag-data/seed";
import { createLogger } from "@/lib/logger";
import { findParentTagIdForGrade } from "@/lib/tag-recognition";

const logger = createLogger('api:admin:migrate-tags');

// 定义关联备份类型
interface TagAssociation {
    errorItemId: string;
    tagName: string;
    subject: string;
}

export async function POST(req: Request) {
    return adminAction(req, 'tags.migrate', 'system', async session => {
        try {
            logger.info({ email: session.user.email }, 'Tag migration initiated');
            let totalCreated = 0;
            let associationsRestored = 0;
            let customTagsCreated = 0;

            await prisma.$transaction(async (tx) => {
                // ========== STEP 1: 备份现有关联关系 ==========
                logger.info('Step 1: Backing up tag associations...');
                const associations: TagAssociation[] = [];

                // 查询所有带有系统标签的错题
                const errorItemsWithSystemTags = await tx.errorItem.findMany({
                    select: {
                        id: true,
                        tags: {
                            where: { isSystem: true },
                            select: { name: true, subject: true }
                        }
                    }
                });

                // 构建关联备份
                for (const item of errorItemsWithSystemTags) {
                    for (const tag of item.tags) {
                        associations.push({
                            errorItemId: item.id,
                            tagName: tag.name,
                            subject: tag.subject,
                        });
                    }
                }
                logger.info({ associationCount: associations.length, itemCount: errorItemsWithSystemTags.length }, 'Backup complete');

                // ========== STEP 2: 删除旧标签并重建 ==========
                logger.info('Step 2: Rebuilding system tags...');

                totalCreated = await seedSystemTags(tx);

                logger.info({ totalCreated }, 'Tags created');

                // ========== STEP 3: 恢复关联关系 ==========
                logger.info('Step 3: Restoring associations...');

                // 按 errorItemId 分组
                const associationsByItem = new Map<string, TagAssociation[]>();
                for (const assoc of associations) {
                    const list = associationsByItem.get(assoc.errorItemId) || [];
                    list.push(assoc);
                    associationsByItem.set(assoc.errorItemId, list);
                }

                // 为每个错题恢复关联
                for (const [errorItemId, itemAssociations] of associationsByItem) {
                    const newTagIds: string[] = [];

                    for (const assoc of itemAssociations) {
                        // 按名称+学科查找新标签
                        const newTag = await findSystemTagByName(tx, assoc.tagName, assoc.subject);

                        if (newTag) {
                            newTagIds.push(newTag.id);
                            associationsRestored++;
                        } else {
                            // 系统标签未找到，创建为自定义标签（绑定到执行迁移的管理员）
                            logger.warn({ tagName: assoc.tagName, subject: assoc.subject }, 'Tag not found, creating as custom tag');

                            // 查找执行操作的用户
                            const adminUser = await tx.user.findUnique({
                                where: { email: session.user!.email! },
                                select: { id: true }
                            });

                            if (adminUser) {
                                // 检查是否已存在同名自定义标签
                                let customTag = await tx.knowledgeTag.findFirst({
                                    where: {
                                        name: assoc.tagName,
                                        subject: assoc.subject,
                                        userId: adminUser.id
                                    },
                                    select: { id: true }
                                });

                                if (!customTag) {
                                    // Try to find grade context - this is tricky here as we only have tagName.
                                    // But we know errorItemId is associated with this tag.
                                    // We can fetch the error item to get the grade.
                                    // However, we are inside a loop over associations.
                                    // Let's simplify: If we are creating custom tags here, it's a fallback.
                                    // Can we get grade from assoc? We need to update TagAssociation interface Step 1.
                                    // For now, let's leave as is or fetch item?
                                    // Fetching item per tag creation is ok (rare case).
                                    const errorItem = await tx.errorItem.findUnique({
                                        where: { id: errorItemId },
                                        select: { gradeSemester: true }
                                    });

                                    const parentId = await findParentTagIdForGrade(errorItem?.gradeSemester, assoc.subject);

                                    customTag = await tx.knowledgeTag.create({
                                        data: {
                                            name: assoc.tagName,
                                            subject: assoc.subject,
                                            isSystem: false,
                                            userId: adminUser.id,
                                            parentId: parentId || null
                                        },
                                        select: { id: true }
                                    });
                                    customTagsCreated++;
                                }

                                newTagIds.push(customTag.id);
                                associationsRestored++;
                            }
                        }
                    }

                    if (newTagIds.length > 0) {
                        // 更新错题的标签关联（使用 connect 而非 set，保留自定义标签）
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

                logger.info({ associationsRestored, customTagsCreated }, 'Associations restored');
            }, {
                timeout: 120000 // 增加超时时间以处理关联恢复
            });

            logger.info({ totalCreated, associationsRestored, customTagsCreated }, 'Tag migration completed');
            return NextResponse.json({
                success: true,
                count: totalCreated,
                associationsRestored,
                customTagsCreated,
                message: "Tag migration complete with associations preserved"
            });

        } catch (error) {
            logger.error({ error }, 'Tag migration error');
            return internalError("Failed to migrate tags");
        }
    });
}
