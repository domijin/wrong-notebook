#!/usr/bin/env node
/**
 * generate-questions.mjs — have the configured AI provider write practice
 * questions for Hangzhou zhongkao knowledge points and save them as error
 * items (source "中考知识点生成") in the owner's per-subject notebook.
 *
 * Run inside the app container (see deploy/admin-run.sh):
 *
 *   # N questions per subject, preferring high-frequency points from grade 9
 *   node generate-questions.mjs 数学:3 语文:3 科学:3 社会:3 英语:3
 *
 *   # specific knowledge points, by name and subject (retry failures this way)
 *   node generate-questions.mjs '一元二次方程的解法|数学' '浮力|科学'
 *
 * Options:
 *   --owner=<email>   account that receives the questions (default: the only
 *                     active admin; required when there are several)
 *   --dry-run         list the chosen knowledge points without calling the AI
 *   --db=<path>       SQLite file (default: the image's DATABASE_URL)
 *
 * Re-running is safe: a knowledge point that already has a generated question
 * for the owner is skipped. The AI provider, key and model come from
 * APP_CONFIG_FILE (default /app/config/app-config.json); the key is never printed.
 * The answers are AI-written and unreviewed; delete-generated.mjs removes them all.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const SOURCE = '中考知识点生成';
const SUBJECTS = {
  数学: { key: 'math', edition: '浙教版（2024 新版）' },
  语文: { key: 'chinese', edition: '统编版（2024 新版）' },
  英语: { key: 'english', edition: '人教版（2024 新版）' },
  科学: { key: 'science', edition: '浙教版（2024 新版）' },
  社会: { key: 'society', edition: '统编道德与法治 + 统编历史 + 人文地理（浙江）' },
};
const LABEL_BY_KEY = Object.fromEntries(Object.entries(SUBJECTS).map(([label, s]) => [s.key, label]));

// ---- arguments ---------------------------------------------------------------
const flags = {};
const specs = [];
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] ?? true;
  else specs.push(arg);
}
if (!specs.length) {
  console.error('usage: generate-questions.mjs [--owner=email] [--dry-run] [--db=path] <科目:数量 | 知识点|科目> ...');
  process.exit(2);
}
if (flags.db) process.env.DATABASE_URL = `file:${flags.db}`;
const dryRun = flags['dry-run'] === true;

const { PrismaClient } = require('/app/node_modules/@prisma/client');
const prisma = new PrismaClient();

// ---- AI provider ---------------------------------------------------------------
function resolveProvider() {
  const file = process.env.APP_CONFIG_FILE || '/app/config/app-config.json';
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (config.aiProvider !== 'openai') throw new Error(`unsupported aiProvider: ${config.aiProvider}`);
  const instances = config.openai?.instances || [];
  const active = instances.find(i => i.id === config.openai?.activeInstanceId) || instances[0];
  if (!active?.apiKey) throw new Error('no OpenAI-compatible instance with an API key is configured');
  return { baseURL: active.baseUrl.replace(/\/+$/, ''), apiKey: active.apiKey, model: active.model };
}

async function generateQuestion(provider, point) {
  const { label } = point;
  const prompt = [
    `你是中国浙江省杭州市中考命题组的老师。请出一道【${label}】的典型题。`,
    ``,
    `教材版本：${SUBJECTS[label].edition}`,
    `年级/章节：${point.path}`,
    `考查知识点：${point.name}`,
    ``,
    `要求：`,
    `1. 题目必须紧扣「${point.name}」这个知识点，难度贴合杭州中考`,
    `2. 题面用纯文本，数学公式用 LaTeX（$...$），不要用图片`,
    `3. 必须给出：题干、答案、详细解析`,
    `4. 解析要讲清解题思路和关键步骤，适合初中生理解`,
    `5. 不要输出思考过程，直接给 JSON。题干控制在 300 字以内，解析控制在 500 字以内`,
    `6. 优先选择有明确唯一答案的题型（选择题、填空题、简答题），避免需要大量背景材料或时政背景的开放题`,
    ``,
    `只输出 JSON，不要任何其他文字或代码块标记，格式：`,
    `{ "questionText": "题干（LaTeX 公式用 $...$）", "answerText": "最终答案", "analysis": "详细解析（Markdown）" }`,
  ].join('\n');

  const res = await fetch(`${provider.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
      // some gateways reject non-browser user agents
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      // reasoning models spend reasoning tokens from this budget, so leave a wide margin
      max_tokens: 16000,
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new Error(`AI reply truncated (reasoning tokens: ${data?.usage?.completion_tokens_details?.reasoning_tokens})`);
  }
  const text = (choice?.message?.content || '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last <= first) throw new Error(`no JSON object in reply: ${text.slice(0, 160)}`);
  const parsed = JSON.parse(text.slice(first, last + 1));
  for (const k of ['questionText', 'answerText', 'analysis']) {
    if (typeof parsed[k] !== 'string' || !parsed[k]) throw new Error(`reply is missing ${k}`);
  }
  return parsed;
}

// ---- knowledge points ----------------------------------------------------------
/** All leaf tags of a subject in tree order, each with its ancestor path. */
async function loadLeaves(subjectKey) {
  const tags = await prisma.knowledgeTag.findMany({
    where: { subject: subjectKey, isSystem: true },
    select: { id: true, name: true, parentId: true, order: true, isHighFrequency: true },
    orderBy: { order: 'asc' },
  });
  const children = new Map();
  for (const t of tags) {
    if (!children.has(t.parentId)) children.set(t.parentId, []);
    children.get(t.parentId).push(t);
  }
  const leaves = [];
  const walk = (parentId, path) => {
    for (const t of children.get(parentId) || []) {
      if (children.has(t.id)) walk(t.id, [...path, t.name]);
      else if (path.length) leaves.push({ id: t.id, name: t.name, hf: t.isHighFrequency === true, path: path.join(' / ') });
    }
  };
  walk(null, []);
  return leaves;
}

/** Prefer high-frequency points from grade 9 and the exam topics, one per chapter first. */
function pickPoints(leaves, count) {
  const score = p => (p.hf ? 100 : 0)
    + (/九年级下/.test(p.path) ? 40 : /中考专项/.test(p.path) ? 35 : /九年级上/.test(p.path) ? 30 : /八年级/.test(p.path) ? 10 : 0);
  const sorted = [...leaves].sort((a, b) => score(b) - score(a));
  const picked = [];
  const chapters = new Set();
  for (const p of sorted) {
    if (picked.length >= count) break;
    const chapter = p.path.split(' / ').slice(0, 2).join(' / ');
    if (chapters.has(chapter)) continue;
    chapters.add(chapter);
    picked.push(p);
  }
  for (const p of sorted) {
    if (picked.length >= count) break;
    if (!picked.includes(p)) picked.push(p);
  }
  return picked;
}

function subjectLabel(input) {
  if (SUBJECTS[input]) return input;
  if (LABEL_BY_KEY[input]) return LABEL_BY_KEY[input];
  throw new Error(`unknown subject: ${input} (use one of ${Object.keys(SUBJECTS).join(' ')})`);
}

// ---- main ------------------------------------------------------------------------
async function resolveOwner() {
  if (typeof flags.owner === 'string') {
    const user = await prisma.user.findUnique({ where: { email: flags.owner }, select: { id: true, email: true, isActive: true } });
    if (!user?.isActive) throw new Error(`no active account ${flags.owner}`);
    return user;
  }
  const admins = await prisma.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true, email: true } });
  if (admins.length !== 1) {
    throw new Error(`found ${admins.length} active admins; pass --owner=<email> to choose who gets the questions`);
  }
  return admins[0];
}

async function main() {
  const owner = await resolveOwner();
  const provider = dryRun ? null : resolveProvider();
  const done = await generatedTagIds(owner.id);
  console.log(`[generate] owner ${owner.email}${provider ? `, model ${provider.model}` : ', dry run'}`);

  // Build the work list: "科目:数量" picks points, "知识点|科目" names one.
  const work = [];
  const leavesBySubject = new Map();
  const leavesFor = async label => {
    if (!leavesBySubject.has(label)) leavesBySubject.set(label, await loadLeaves(SUBJECTS[label].key));
    return leavesBySubject.get(label);
  };
  for (const spec of specs) {
    if (spec.includes('|')) {
      const [name, subject] = spec.split('|');
      const label = subjectLabel(subject.trim());
      const matches = (await leavesFor(label)).filter(p => p.name === name.trim());
      if (!matches.length) {
        const similar = [...new Set((await leavesFor(label)).filter(p => p.name.includes(name.trim())).map(p => p.name))].slice(0, 8);
        console.error(`✗ knowledge point not found: ${name} (${label})${similar.length ? `; similar: ${similar.join('、')}` : ''}`);
        continue;
      }
      const point = matches.find(p => p.hf) || matches[0];
      work.push({ ...point, label });
    } else {
      const [subject, rawCount] = spec.split(':');
      const label = subjectLabel(subject.trim());
      const count = parseInt(rawCount || '3', 10);
      // Skip points that already have a question before picking, so re-runs add new ones.
      const leaves = (await leavesFor(label)).filter(p => !done.has(p.id));
      for (const p of pickPoints(leaves, count)) work.push({ ...p, label });
    }
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const point of work) {
    const tag = `${point.label} · ${point.name}  [${point.path}]${point.hf ? ' ★' : ''}`;
    if (done.has(point.id)) { skipped++; console.log(`  = ${tag} (already has one)`); continue; }
    if (dryRun) { console.log(`  · ${tag}`); continue; }
    try {
      const q = await generateQuestion(provider, point);
      const notebook = await prisma.subject.findFirst({ where: { name: point.label, userId: owner.id }, select: { id: true } })
        || await prisma.subject.create({ data: { name: point.label, userId: owner.id }, select: { id: true } });
      const item = await prisma.errorItem.create({
        data: {
          userId: owner.id,
          subjectId: notebook.id,
          originalImageUrl: '',
          questionText: q.questionText,
          answerText: q.answerText,
          analysis: q.analysis,
          wrongAnswerText: '',
          mistakeAnalysis: '',
          mistakeStatus: 'not_attempted',
          source: SOURCE,
          errorType: '练习题',
          masteryLevel: 0,
          paperLevel: '中考',
          tags: { connect: [{ id: point.id }] },
        },
        select: { id: true },
      });
      created++;
      done.add(point.id);
      console.log(`  ✓ ${tag} → ${item.id}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${tag}: ${e.message}`);
    }
  }
  console.log(`[generate] created ${created}, skipped ${skipped}, failed ${failed}`);
  if (failed) console.log(`[generate] retry failures by name: generate-questions.mjs '<知识点>|<科目>'`);
  return failed ? 1 : 0;
}

/** Knowledge points that already have a generated question for this owner. */
async function generatedTagIds(userId) {
  const items = await prisma.errorItem.findMany({ where: { userId, source: SOURCE }, select: { tags: { select: { id: true } } } });
  return new Set(items.flatMap(i => i.tags.map(t => t.id)));
}

main()
  .then(code => { process.exitCode = code; })
  .catch(e => { console.error(`[generate] ${e.message}`); process.exitCode = 2; })
  .finally(() => prisma.$disconnect());
