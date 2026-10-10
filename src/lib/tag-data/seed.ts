/**
 * 系统标签树的唯一构建入口：rebuild-system-tags 脚本和 /api/admin/migrate-tags 共用。
 * 初中部分（七至九年级、中考专项）来自 scripts/zhongkao/build.mjs 生成的 zhongkao/*.json，
 * 小学和高中部分沿用各学科原有的手写数据。
 *
 * 只用相对路径导入：Docker 构建时用 tsc 单独编译 scripts/rebuild-system-tags.ts。
 */
import { MATH_CURRICULUM, MATH_GRADE_ORDER } from './math';
import { PHYSICS_CURRICULUM, PHYSICS_GRADE_ORDER } from './physics';
import { ENGLISH_CURRICULUM, ENGLISH_GRADE_ORDER } from './english';
import { CHEMISTRY_CURRICULUM, CHEMISTRY_GRADE_ORDER } from './chemistry';
import { BIOLOGY_CURRICULUM, BIOLOGY_GRADE_ORDER } from './biology';
import { CHINESE_CURRICULUM, CHINESE_GRADE_ORDER } from './chinese';
import { HISTORY_CURRICULUM, HISTORY_GRADE_ORDER } from './history';
import { GEOGRAPHY_CURRICULUM, GEOGRAPHY_GRADE_ORDER } from './geography';
import { POLITICS_CURRICULUM, POLITICS_GRADE_ORDER } from './politics';
import zhongkaoMath from './zhongkao/math.json';
import zhongkaoScience from './zhongkao/science.json';
import zhongkaoSociety from './zhongkao/society.json';
import zhongkaoChinese from './zhongkao/chinese.json';
import zhongkaoEnglish from './zhongkao/english.json';

export interface ZhongkaoCurriculum {
    subject: string;
    name: string;
    edition: string;
    sources: string[];
    grades: Array<{
        name: string;
        order: number;
        provisional: boolean;
        chapters: Array<{
            name: string;
            sections: Array<{ name: string; tags: Array<{ name: string; hf?: boolean }> }>;
        }>;
    }>;
}

export interface SeedNode {
    name: string;
    isHighFrequency?: boolean;
    children?: SeedNode[];
}

export const ZHONGKAO_CURRICULA: Record<string, ZhongkaoCurriculum> = {
    math: zhongkaoMath,
    science: zhongkaoScience,
    society: zhongkaoSociety,
    chinese: zhongkaoChinese,
    english: zhongkaoEnglish,
};

const JUNIOR_GRADE = /^[七八九]年级/;

type LegacyChapter = { chapter: string; tags?: string[]; sections?: Array<{ section: string; tags: string[] }> };

function fromLegacy(curriculum: Record<string, LegacyChapter[]>, gradeOrder: Record<string, number>, skipJunior: boolean) {
    return Object.entries(curriculum)
        .filter(([grade, chapters]) => chapters.length > 0 && !(skipJunior && JUNIOR_GRADE.test(grade)))
        .map(([grade, chapters]) => ({
            order: gradeOrder[grade] ?? 99,
            node: {
                name: grade,
                children: chapters.map(chapter => ({
                    name: chapter.chapter,
                    children: chapter.sections
                        ? chapter.sections.map(section => ({ name: section.section, children: section.tags.map(name => ({ name })) }))
                        : (chapter.tags || []).map(name => ({ name })),
                })),
            } as SeedNode,
        }));
}

function fromZhongkao(curriculum: ZhongkaoCurriculum): SeedNode[] {
    return curriculum.grades.map(grade => ({
        name: grade.name,
        children: grade.chapters.map(chapter => ({
            name: chapter.name,
            children: chapter.sections.map(section => ({
                name: section.name,
                children: section.tags.map(tag => ({ name: tag.name, isHighFrequency: tag.hf === true })),
            })),
        })),
    }));
}

/** 小学排在初中前、高中排在初中后，初中整体替换为中考数据 */
function merge(legacy: ReturnType<typeof fromLegacy>, junior: SeedNode[]): SeedNode[] {
    const sorted = [...legacy].sort((a, b) => a.order - b.order);
    const before = sorted.filter(g => !/^高/.test(g.node.name)).map(g => g.node);
    const after = sorted.filter(g => /^高/.test(g.node.name)).map(g => g.node);
    return [...before, ...junior, ...after];
}

export function buildSystemTagTrees(): Record<string, SeedNode[]> {
    const standard = (curriculum: Record<string, LegacyChapter[]>, order: Record<string, number>) =>
        merge(fromLegacy(curriculum, order, false), []);
    return {
        math: merge(fromLegacy(MATH_CURRICULUM, MATH_GRADE_ORDER, true), fromZhongkao(ZHONGKAO_CURRICULA.math)),
        science: fromZhongkao(ZHONGKAO_CURRICULA.science),
        society: fromZhongkao(ZHONGKAO_CURRICULA.society),
        chinese: merge(fromLegacy(CHINESE_CURRICULUM, CHINESE_GRADE_ORDER, true), fromZhongkao(ZHONGKAO_CURRICULA.chinese)),
        english: merge(fromLegacy(ENGLISH_CURRICULUM, ENGLISH_GRADE_ORDER, true), fromZhongkao(ZHONGKAO_CURRICULA.english)),
        physics: standard(PHYSICS_CURRICULUM, PHYSICS_GRADE_ORDER),
        chemistry: standard(CHEMISTRY_CURRICULUM, CHEMISTRY_GRADE_ORDER),
        biology: standard(BIOLOGY_CURRICULUM, BIOLOGY_GRADE_ORDER),
        history: standard(HISTORY_CURRICULUM, HISTORY_GRADE_ORDER),
        geography: standard(GEOGRAPHY_CURRICULUM, GEOGRAPHY_GRADE_ORDER),
        politics: standard(POLITICS_CURRICULUM, POLITICS_GRADE_ORDER),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createNodes(tx: any, subject: string, nodes: SeedNode[], parentId: string | null): Promise<number> {
    let count = 0;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const created = await tx.knowledgeTag.create({
            data: {
                name: node.name,
                subject,
                parentId,
                isSystem: true,
                isHighFrequency: node.isHighFrequency === true,
                order: i + 1,
            },
            select: { id: true },
        });
        count++;
        if (node.children?.length) count += await createNodes(tx, subject, node.children, created.id);
    }
    return count;
}

/** 删除并重建全部系统标签，返回创建的数量。调用方负责事务与关联备份/恢复。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedSystemTags(tx: any): Promise<number> {
    let total = 0;
    for (const [subject, roots] of Object.entries(buildSystemTagTrees())) {
        await tx.knowledgeTag.deleteMany({ where: { isSystem: true, subject } });
        total += await createNodes(tx, subject, roots, null);
    }
    return total;
}

/** 按名称恢复关联时优先匹配叶子节点：知识点可能与它所在的节同名（如「垂径定理」）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findSystemTagByName(tx: any, name: string, subject: string): Promise<{ id: string } | null> {
    return await tx.knowledgeTag.findFirst({
        where: { name, subject, isSystem: true, children: { none: {} } },
        select: { id: true },
    }) ?? await tx.knowledgeTag.findFirst({
        where: { name, subject, isSystem: true },
        select: { id: true },
    });
}
