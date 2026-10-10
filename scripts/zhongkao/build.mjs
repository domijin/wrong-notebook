#!/usr/bin/env node
/**
 * 杭州中考知识点批量生成流水线
 *
 *   node scripts/zhongkao/build.mjs fetch   抓取教材目录 -> scripts/zhongkao/toc/<subject>.json
 *   node scripts/zhongkao/build.mjs enrich  按章调用 LLM 生成细粒度知识点与高频标记（结果缓存）
 *   node scripts/zhongkao/build.mjs review  按章让 LLM 审查已输出的知识点，生成修正建议 review-proposals.json
 *   node scripts/zhongkao/build.mjs emit    应用 corrections.json，校验并输出 src/lib/tag-data/zhongkao/<subject>.json 和审核报告
 *   node scripts/zhongkao/build.mjs all     依次执行以上三步
 *
 * 选项：--subject=math,science  只处理指定学科
 *       --concurrency=3         LLM 并发数
 *       --refresh               忽略缓存重新抓取 / 重新生成
 *
 * LLM 走 OpenAI 兼容接口：ZK_API_KEY（缺省读 MINIMAX_API_KEY，或 .env.local 里的同名变量）、
 * ZK_BASE_URL（缺省 https://api.minimax.io/v1）、ZK_MODEL（缺省 MiniMax-M3.1-Flash-Preview）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BASE_URL, GRADES, SUBJECTS, CORRECTIONS } from './sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CACHE = path.join(ROOT, '.cache/zhongkao');
const TOC_DIR = path.join(HERE, 'toc');
const STATIC_DIR = path.join(HERE, 'static');
const OUT_DIR = path.join(ROOT, 'src/lib/tag-data/zhongkao');
const REPORT = path.join(ROOT, 'doc/zhongkao-tags-report.md');
const PROMPT_VERSION = 4;

const args = Object.fromEntries(process.argv.slice(3).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
}));
const step = process.argv[2];
const subjects = args.subject ? String(args.subject).split(',') : Object.keys(SUBJECTS);

const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------- fetch

async function fetchPage(bookPath) {
    const file = path.join(CACHE, 'html', `${bookPath.replace(/\//g, '_')}.html`);
    if (!args.refresh && fs.existsSync(file)) return fs.readFileSync(file);
    const res = await fetch(`${BASE_URL}/${bookPath}/`, { headers: { 'User-Agent': 'Mozilla/5.0 wrong-notebook-toc' } });
    if (!res.ok) throw new Error(`${bookPath}: HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    await sleep(1500); // 礼貌限速
    return body;
}

function correct(text) {
    let out = text.replace(/[?？]+$/g, '').replace(/　|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    for (const [wrong, right] of Object.entries(CORRECTIONS)) out = out.split(wrong).join(right);
    return out.replace(/\s*\?\s*/g, '·');
}

const CHAPTER = /^第\s*([一二三四五六七八九十]+|\d+)\s*(章|单元)\s*(.*)$/;
const SECTION_PATTERNS = [
    /^第\s*\d+\s*节\s*(.+)$/,                     // 科学：第1节 科学并不神秘
    /^\d+\.\d+\s*(.+)$/,                          // 数学：1.1 从自然数到有理数
    /^第\s*\d+\s*课\s*(.+)$/,                     // 历史：第1课 远古时期的人类活动
    /^第[一二三四五六七八九十]+课\s*(.+)$/,        // 道法：第一课 开启初中生活
    /^\d+\s*\*?\s*(.+)$/,                         // 语文：12 《论语》十二章
];
const SKIP_UNTIL_CHAPTER = /^(学史方法|附录|研究性学习课题|书法|语言表述专题复习)/;
const NOISE = /^(阅读|阅读综合实践)$|^(小结与反思|目标与评定|单元思考与行动|本章复习与测试|复习题|赞助商链接|阅读材料|综合实践活动|活动·探究|任务[一二三]|.*活动课)/;

function parseToc(html) {
    let text = new TextDecoder('gbk').decode(html);
    text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
    const lines = text.replace(/<[^>]+>/g, '\n').split('\n').map(correct).filter(Boolean);
    const start = lines.indexOf('关注公众号快速搜索电子课本') + 1;
    const end = lines.findIndex((l, i) => i > start && /^(人教版|浙教版)?[七八九]年级(数学|科学)?电子课本$/.test(l));
    const chapters = [];
    let chapter = null, section = null, skipping = false, pending = null;

    const addSection = name => {
        section = { name, hints: [] };
        chapter.sections.push(section);
    };
    for (const line of lines.slice(start, end === -1 ? undefined : end)) {
        const ch = line.match(CHAPTER);
        if (ch) {
            const title = ch[3].trim();
            chapter = { name: title || line.replace(/\s+/g, ''), sections: [] };
            chapters.push(chapter);
            section = null; skipping = false; pending = null;
            continue;
        }
        if (!chapter || skipping) continue;
        if (SKIP_UNTIL_CHAPTER.test(line)) { skipping = true; continue; }
        if (NOISE.test(line)) { section = null; pending = null; continue; }

        // 语文：写作 / 整本书阅读 / 名著导读 / 综合性学习 / 课外古诗词诵读 的标题可能在下一行
        const marker = line.match(/^(写作|整本书阅读|名著导读|综合性学习|课外古诗词诵读)\s*(.*)$/);
        if (marker) {
            const label = marker[1] === '名著导读' ? '整本书阅读' : marker[1];
            if (label === '课外古诗词诵读') { addSection('课外古诗词诵读'); pending = null; continue; }
            if (marker[2]) { addSection(`${label}：${marker[2]}`); pending = null; }
            else pending = label;
            continue;
        }
        if (pending) {
            if (!SECTION_PATTERNS.some(p => p.test(line))) { addSection(`${pending}：${line}`); pending = null; continue; }
            pending = null;
        }
        const match = SECTION_PATTERNS.map(p => line.match(p)).find(Boolean);
        if (match) { addSection(match[1].trim()); continue; }
        if (section) section.hints.push(line);           // 框题、诗词篇目等
        else addSection(line);
    }
    return chapters.filter(c => c.sections.length > 0);
}

async function runFetch() {
    for (const key of subjects) {
        const subject = SUBJECTS[key];
        const volumes = [];
        for (const volume of subject.volumes) {
            const chapters = parseToc(await fetchPage(volume.path));
            if (chapters.length === 0) throw new Error(`${volume.path}: no chapters parsed`);
            volumes.push({ ...volume, source: `${BASE_URL}/${volume.path}/`, chapters });
            console.log(`[fetch] ${key} ${volume.grade}${volume.module ? ' ' + volume.module : ''}: ${chapters.length} 章`);
        }
        writeJSON(path.join(TOC_DIR, `${key}.json`), { subject: key, volumes });
    }
}

// ---------------------------------------------------------------- enrich

function loadVolumes(key) {
    const toc = readJSON(path.join(TOC_DIR, `${key}.json`)).volumes;
    const extra = (SUBJECTS[key].static || []).flatMap(file => readJSON(path.join(STATIC_DIR, file)).volumes);
    return [...toc, ...extra];
}

function loadEvidence() {
    const text = fs.readFileSync(path.join(HERE, 'evidence.md'), 'utf8');
    const bySubject = {};
    for (const block of text.split(/^## /m).slice(1)) {
        const [head, ...rest] = block.split('\n');
        const body = rest.join('\n').trim();
        bySubject[head.trim()] = {
            text: body,
            quotable: body.split('\n').filter(l => l.startsWith('- ')).join('\n'),
        };
    }
    return bySubject;
}

const GUIDANCE = {
    math: '数学：知识点要具体到概念、定理、公式、方法或典型题型（如「完全平方公式」「垂径定理」「二次函数图象的平移」）。',
    science: '科学（浙江综合科学，含物理、化学、生物、地球与宇宙）：知识点要具体到概念、规律、实验或计算（如「液体压强的影响因素」「质量守恒定律的应用」）。技术与工程章节只保留可考查的概念。',
    society: '社会（道德与法治、历史、人文地理）：道法写成可考查的观点或法律常识（如「宪法是国家的根本法」）；历史写成具体事件、人物、制度或影响（如「商鞅变法的内容与影响」）；地理写成具体技能或区域特征。hints 是教材框题或子目，可作为参考。',
    chinese: '语文：只为中考能考的内容出知识点。文言文篇目写成「《篇名》文言实词」「《篇名》句子翻译」「《篇名》主旨理解」之类；古诗词写成「《诗名》默写与赏析」，课外古诗词诵读的篇目在 hints 里，逐首列出；名著写成「《书名》主要情节与人物」「《书名》阅读方法」；写作写成写作方法本身；现代文课文只在体现明确文体阅读能力时出 1 个知识点（如「散文中的情景交融」），否则 tags 为空。',
    english: '英语：知识点写成具体语法项或题型能力。',
};

function buildPrompt(key, grade, chapter, evidence) {
    return `你在为浙江杭州初中生的错题本整理${SUBJECTS[key].name}知识点标签。教材：${SUBJECTS[key].edition}。
下面是 ${grade} 的一章（JSON，含各节名称 sections[].name 和教材子目 hints）。请为每一节给出 2–4 个可考查、可用于给错题打标签的知识点。
粒度以「一道中考题考查的知识点」为准：合并琐碎的子结论（不要把「正数的绝对值」「负数的绝对值」拆开），也不要笼统到等于整章。

要求：
1. 只写本节教材内实际包含的内容，不要编造。${GUIDANCE[key]}
2. 知识点名称 2–16 个字，不带编号，不与节名或章名完全相同，同一章内不重复。
3. 高频标记：只有当知识点与下方【官方评析依据】中以「- 」开头的具体考点直接对应时，hf 才为 true，并在 evidence 中原样复制该考点里的一个词（必须是原文的连续片段）；「> 」开头的是背景描述，不能作为依据。每节最多 1 个高频，选与考点最直接对应的那个；其余 hf 为 false、evidence 为空字符串。不要凭经验标高频。
4. 某节没有可考查内容时 tags 返回空数组。
5. 只输出 JSON，放在 <json> 与 </json> 之间，格式：
{"sections":[{"name":"<原节名>","tags":[{"name":"知识点","hf":false,"evidence":""}]}]}

【官方评析依据】
${evidence[key]?.text || '（无）'}

【本章】
${JSON.stringify({ chapter: chapter.name, sections: chapter.sections.map(s => ({ name: s.name, hints: s.hints })) }, null, 1)}`;
}

function loadApiKey() {
    if (process.env.ZK_API_KEY || process.env.MINIMAX_API_KEY) return process.env.ZK_API_KEY || process.env.MINIMAX_API_KEY;
    const envFile = path.join(ROOT, '.env.local');
    if (fs.existsSync(envFile)) {
        const line = fs.readFileSync(envFile, 'utf8').split('\n').find(l => l.startsWith('MINIMAX_API_KEY='));
        if (line) return line.slice('MINIMAX_API_KEY='.length).trim();
    }
    throw new Error('Set ZK_API_KEY or MINIMAX_API_KEY');
}

async function callLLM(prompt, field = 'sections', tag = 'enrich') {
    const baseUrl = process.env.ZK_BASE_URL || 'https://api.minimax.io/v1';
    const model = process.env.ZK_MODEL || 'MiniMax-M3.1-Flash-Preview';
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST', redirect: 'error', signal: AbortSignal.timeout(300000),
                headers: { Authorization: `Bearer ${loadApiKey()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model, max_completion_tokens: 16000, reasoning_effort: 'medium',
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
            const content = body.choices?.[0]?.message?.content || '';
            const json = content.match(/<json>([\s\S]*?)<\/json>/)?.[1] ?? content.match(/\{[\s\S]*\}/)?.[0];
            const parsed = JSON.parse(json);
            if (!Array.isArray(parsed[field])) throw new Error(`missing ${field} array`);
            return { model, [field]: parsed[field], usage: body.usage };
        } catch (error) {
            if (attempt >= 3) throw error;
            console.warn(`[${tag}] retry ${attempt}: ${error.message}`);
            await sleep(5000 * attempt);
        }
    }
}

const hasAllTags = chapter => chapter.sections.every(s => Array.isArray(s.tags));

async function runEnrich() {
    const evidence = loadEvidence();
    const jobs = [];
    for (const key of subjects) {
        for (const volume of loadVolumes(key)) {
            for (const chapter of volume.chapters) {
                if (hasAllTags(chapter)) continue; // 静态种子已写明知识点
                const prompt = buildPrompt(key, volume.grade, chapter, evidence);
                const hash = crypto.createHash('sha256').update(`${PROMPT_VERSION}\n${process.env.ZK_MODEL || ''}\n${prompt}`).digest('hex').slice(0, 16);
                const file = path.join(CACHE, 'llm', key, `${hash}.json`);
                if (!args.refresh && fs.existsSync(file)) continue;
                jobs.push({ key, label: `${key} ${volume.grade} ${chapter.name}`, prompt, file });
            }
        }
    }
    console.log(`[enrich] ${jobs.length} 章待生成`);
    await runPool('enrich', jobs, job => callLLM(job.prompt));
}

async function runPool(tag, jobs, call) {
    let done = 0, failed = 0;
    const worker = async () => {
        for (let job = jobs.shift(); job; job = jobs.shift()) {
            const started = Date.now();
            try {
                const result = await call(job);
                writeJSON(job.file, { label: job.label, ...result });
                console.log(`[${tag}] ${++done} ok ${job.label} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
            } catch (error) {
                failed++;
                console.error(`[${tag}] FAILED ${job.label}: ${error.message}`);
            }
        }
    };
    await Promise.all(Array.from({ length: Number(args.concurrency || 3) }, worker));
    if (failed) { console.error(`[${tag}] ${failed} 章失败，重跑只会补跑失败的章`); process.exitCode = 1; }
}

// ---------------------------------------------------------------- review

const REVIEW_VERSION = 1;
const PROPOSALS = path.join(HERE, 'review-proposals.json');
const CORRECTIONS_FILE = path.join(HERE, 'corrections.json');

function buildReviewPrompt(key, grade, chapter) {
    return `你是熟悉浙江杭州初中教学的${SUBJECTS[key].name}教研员，正在审核错题本的知识点标签。教材：${SUBJECTS[key].edition}。
下面是 ${grade}「${chapter.name}」一章已生成的知识点（按节列出）。请逐条检查，只报告实质性错误：
1. 事实或概念错误（如把性质写成判定、把定理条件写反、历史事件张冠李戴、语文篇目与作者或单元不符）；
2. 明显不属于该节或该年级教材的内容；
3. 把两个以上独立知识点合成一条（如同时含两首诗名）；
4. 不是可考查知识点的条目（如空泛的“综合运用”）。
不要报告措辞偏好、粒度偏好或可有可无的改进；没有问题就返回空数组。
对每个问题给出处理：action 为 "rename"（给出更正后的 newName，2–16 字）或 "remove"。
只输出 JSON，放在 <json> 与 </json> 之间：
{"issues":[{"section":"节名","tag":"原知识点","problem":"问题说明","action":"rename","newName":"更正后名称"}]}

【本章】
${JSON.stringify(chapter.sections.map(s => ({ section: s.name, tags: s.tags.map(t => t.name) })), null, 1)}`;
}

async function runReview() {
    const jobs = [];
    const all = [];
    for (const key of subjects) {
        const output = readJSON(path.join(OUT_DIR, `${key}.json`));
        for (const grade of output.grades) {
            for (const chapter of grade.chapters) {
                const prompt = buildReviewPrompt(key, grade.name, chapter);
                const hash = crypto.createHash('sha256').update(`${REVIEW_VERSION}\n${process.env.ZK_MODEL || ''}\n${prompt}`).digest('hex').slice(0, 16);
                const file = path.join(CACHE, 'review', key, `${hash}.json`);
                all.push({ key, grade: grade.name, chapter: chapter.name, file });
                if (!args.refresh && fs.existsSync(file)) continue;
                jobs.push({ label: `${key} ${grade.name} ${chapter.name}`, prompt, file });
            }
        }
    }
    console.log(`[review] ${jobs.length} 章待审核`);
    await runPool('review', jobs, job => callLLM(job.prompt, 'issues', 'review'));

    // 汇总成修正建议，供人工逐条确认后写入 corrections.json
    const proposals = [];
    for (const item of all) {
        if (!fs.existsSync(item.file)) continue;
        for (const issue of readJSON(item.file).issues) {
            proposals.push({ subject: item.key, grade: item.grade, chapter: item.chapter, ...issue });
        }
    }
    writeJSON(PROPOSALS, proposals);
    console.log(`[review] ${proposals.length} 条修正建议 -> ${path.relative(ROOT, PROPOSALS)}`);
}

// ---------------------------------------------------------------- emit

const stripNumber = name => name.replace(/^第\s*([一二三四五六七八九十]+|\d+)\s*(章|单元)\s*/, '').trim() || name;

function cleanTagName(name) {
    return String(name || '').replace(/^(\d+[.、．)）]|[(（]\d+[)）])\s*/, '').replace(/\s+/g, '').trim();
}

async function runEmit() {
    const evidence = loadEvidence();
    const subjects = Object.keys(SUBJECTS);
    // 人工确认过的修正：{ subject: { 原名: { rename: 新名 } | { remove: true }, reason } }，独立于 LLM 缓存
    const corrections = fs.existsSync(CORRECTIONS_FILE) ? readJSON(CORRECTIONS_FILE) : {};
    const usedCorrections = new Set();
    const report = ['# 杭州中考知识点生成报告', '',
        '由 `node scripts/zhongkao/build.mjs all` 生成，请人工抽查后再发布。高频标记只来自浙江省教育考试院 2024、2025 年官方试题评析（见 `scripts/zhongkao/evidence.md`）。', ''];

    for (const key of subjects) {
        const subject = SUBJECTS[key];
        const grades = new Map(GRADES.map((g, i) => [g, { name: g, order: i + 1, provisional: false, chapters: [] }]));
        const seen = new Map();
        const issues = [];
        let total = 0, hfCount = 0, missing = 0;
        const hfList = [];

        // 人工整理的条目（静态种子里写明 tags 的章）在重名时优先，LLM 生成的同名条目让位
        const curated = new Set(loadVolumes(key).flatMap(v => v.chapters.filter(hasAllTags)
            .flatMap(c => c.sections.flatMap(s => s.tags.map(t => cleanTagName(typeof t === 'string' ? t : t.name))))));
        for (const volume of loadVolumes(key)) {
            const grade = grades.get(volume.grade);
            if (!grade) throw new Error(`${key}: unknown grade ${volume.grade}`);
            grade.provisional ||= Boolean(volume.provisional);
            for (const chapter of volume.chapters) {
                let sections = chapter.sections;
                const generated = !hasAllTags(chapter);
                if (generated) {
                    const prompt = buildPrompt(key, volume.grade, chapter, evidence);
                    const hash = crypto.createHash('sha256').update(`${PROMPT_VERSION}\n${process.env.ZK_MODEL || ''}\n${prompt}`).digest('hex').slice(0, 16);
                    const file = path.join(CACHE, 'llm', key, `${hash}.json`);
                    if (!fs.existsSync(file)) { missing++; issues.push(`缺少 LLM 结果：${volume.grade} ${chapter.name}`); continue; }
                    const llmSections = readJSON(file).sections;
                    sections = chapter.sections.map(s => ({ name: s.name, tags: llmSections.find(g => g.name === s.name)?.tags || [] }));
                }
                const chapterName = (volume.module ? `${volume.module}·` : '') + stripNumber(chapter.name);
                const outChapter = { name: chapterName, sections: [] };
                // 允许与节名相同（如「垂径定理」节下的「垂径定理」）：AI 打标签只用叶子节点，丢掉会缺核心考点
                const reserved = new Set([chapterName]);
                for (const section of sections) {
                    const tags = [];
                    // 先应用人工修正：删除、改名或拆成多条（拆出的条目不继承高频）
                    const corrected = section.tags.flatMap(raw => {
                        const tag = typeof raw === 'string' ? { name: raw, hf: false, evidence: '' } : raw;
                        const name = cleanTagName(tag.name);
                        const fix = corrections[key]?.[name];
                        if (!fix || (fix.grade && fix.grade !== volume.grade)) return [tag]; // grade 可限定只改某个年级的同名条目
                        usedCorrections.add(`${key}\u0000${name}`);
                        if (fix.remove) { issues.push(`人工修正：删除「${name}」（${fix.reason}）`); return []; }
                        if (fix.split) {
                            issues.push(`人工修正：「${name}」拆为「${fix.split.join('」「')}」（${fix.reason}）`);
                            return fix.split.map(part => ({ name: part, hf: false, evidence: '' }));
                        }
                        issues.push(`人工修正：「${name}」→「${fix.rename}」（${fix.reason}）`);
                        return [{ ...tag, name: fix.rename }];
                    });
                    for (const tag of corrected) {
                        const name = cleanTagName(tag.name);
                        if (name.length < 2 || name.length > 20) { issues.push(`名称长度不合规，已丢弃：${name}`); continue; }
                        if (reserved.has(name)) { issues.push(`与章名相同，已丢弃：${volume.grade} ${name}`); continue; }
                        if (generated && curated.has(name)) { issues.push(`与人工整理条目重名，保留人工条目：${volume.grade} ${name}`); continue; }
                        if (seen.has(name)) { issues.push(`重复，保留 ${seen.get(name)} 的那一条：${volume.grade} ${name}`); continue; }
                        let hf = tag.hf === true && !(generated && subject.llmHighFrequency === false);
                        const quote = String(tag.evidence || '').trim();
                        // LLM 只能引用具体考点；人工整理的条目可引用依据全文（含背景行）
                        const citable = generated ? evidence[key]?.quotable : evidence[key]?.text;
                        if (hf && (quote.length < 2 || !(citable || '').includes(quote))) {
                            issues.push(`高频依据无法核实，降为普通：${name}（引用「${quote}」）`);
                            hf = false;
                        }
                        // 每节最多 1 个高频只约束 LLM 生成的节；静态种子里人工整理的题型清单不受限
                        if (hf && generated && tags.some(t => t.hf)) {
                            issues.push(`本节已有高频，降为普通：${name}`);
                            hf = false;
                        }
                        seen.set(name, volume.grade);
                        tags.push(hf ? { name, hf: true } : { name });
                        total++;
                        if (hf) { hfCount++; hfList.push(`${volume.grade} · ${name} ← ${quote}`); }
                    }
                    if (tags.length > 0) outChapter.sections.push({ name: section.name, tags });
                    else issues.push(`无知识点，已省略该节：${volume.grade} ${chapterName} / ${section.name}`);
                }
                if (outChapter.sections.length > 0) grade.chapters.push(outChapter);
            }
        }

        const output = {
            subject: key,
            name: subject.name,
            edition: subject.edition,
            sources: [...new Set(loadVolumes(key).map(v => v.source).filter(Boolean))],
            grades: [...grades.values()].filter(g => g.chapters.length > 0),
        };
        if (missing === 0) writeJSON(path.join(OUT_DIR, `${key}.json`), output);
        else console.error(`[emit] ${key}: ${missing} 章缺少 LLM 结果，未写出（先跑 enrich）`);

        report.push(`## ${subject.name}（${key}）`, '', `教材：${subject.edition}`, '',
            `知识点 ${total} 个，其中高频 ${hfCount} 个。`, '');
        for (const g of output.grades) {
            const count = g.chapters.reduce((n, c) => n + c.sections.reduce((m, s) => m + s.tags.length, 0), 0);
            report.push(`- ${g.name}${g.provisional ? '（暂列，待新版教材发行后核对）' : ''}：${g.chapters.length} 章，${count} 个知识点`);
        }
        report.push('', '<details><summary>高频知识点及依据</summary>', '', ...hfList.map(l => `- ${l}`), '', '</details>', '');
        if (issues.length) report.push('<details><summary>校验记录</summary>', '', ...issues.map(l => `- ${l}`), '', '</details>', '');
        console.log(`[emit] ${key}: ${total} 个知识点，高频 ${hfCount}，校验记录 ${issues.length} 条`);
    }
    const stale = Object.entries(corrections).flatMap(([key, fixes]) =>
        Object.keys(fixes).filter(name => !usedCorrections.has(`${key}\u0000${name}`)).map(name => `${key}：${name}`));
    if (stale.length) {
        console.warn(`[emit] ${stale.length} 条修正没有匹配到知识点（数据重新生成后可能已过期）：${stale.join('；')}`);
        report.push('## 未匹配的修正', '', ...stale.map(l => `- ${l}`), '');
    }
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, report.join('\n') + '\n');
}

// ---------------------------------------------------------------- main

const steps = { fetch: runFetch, enrich: runEnrich, review: runReview, emit: runEmit };
if (step === 'all') {
    await runFetch(); await runEnrich(); await runEmit();
} else if (steps[step]) {
    await steps[step]();
} else {
    console.error('usage: node scripts/zhongkao/build.mjs <fetch|enrich|emit|all> [--subject=a,b] [--concurrency=3] [--refresh]');
    process.exit(2);
}
