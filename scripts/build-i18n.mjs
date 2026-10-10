#!/usr/bin/env node
/**
 * build-i18n.mjs — generate the locale blocks inside src/lib/translations.ts
 * from the canonical JSON catalogs in deploy/i18n/{en,zh,es}.json.
 *
 * translations.ts stays readable (all locales side by side, matching the
 * existing file style) while the catalogs stay reviewable and translatable as
 * plain JSON. Run after editing any catalog:
 *
 *   node scripts/build-i18n.mjs          # rewrite the locale blocks
 *   node scripts/build-i18n.mjs --check  # fail if translations.ts is stale
 *
 * The tail of translations.ts (helper functions and exports added after the
 * `translations` object) is preserved verbatim.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CATALOGS = [
  { locale: 'en', file: 'deploy/i18n/en.json' },
  { locale: 'zh', file: 'deploy/i18n/zh.json' },
  { locale: 'es', file: 'deploy/i18n/es.json' },
];

const TARGET = 'src/lib/translations.ts';
const BARE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (k) => (BARE.test(k) ? k : JSON.stringify(k));

function render(obj, indent) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      lines.push(pad + key(k) + ': {');
      lines.push(render(v, indent + 4));
      lines.push(pad + '},');
    } else {
      lines.push(pad + key(k) + ': ' + JSON.stringify(v) + ',');
    }
  }
  return lines.join('\n');
}

function shape(o, p = '', out = new Set()) {
  for (const [k, v] of Object.entries(o)) {
    const kp = p ? p + '.' + k : k;
    if (v && typeof v === 'object') shape(v, kp, out);
    else out.add(kp);
  }
  return out;
}

function countLeaves(o) {
  let n = 0;
  for (const v of Object.values(o)) n += v && typeof v === 'object' ? countLeaves(v) : 1;
  return n;
}

const catalogs = CATALOGS.map(({ locale, file }) => ({
  locale,
  obj: JSON.parse(readFileSync(file, 'utf8')),
}));

// --- key-parity gate --------------------------------------------------------
const shapes = catalogs.map((c) => ({ locale: c.locale, shape: shape(c.obj) }));
const base = shapes[0];
let drift = 0;
for (const s of shapes.slice(1)) {
  const missing = [...base.shape].filter((k) => !s.shape.has(k));
  const extra = [...s.shape].filter((k) => !base.shape.has(k));
  if (missing.length || extra.length) {
    drift++;
    console.error('drift in ' + s.locale + ': ' + missing.length + ' missing, ' + extra.length + ' extra');
    if (missing.length) console.error('  missing: ' + missing.slice(0, 12).join(', '));
    if (extra.length) console.error('  extra:   ' + extra.slice(0, 12).join(', '));
  }
}

// --- assemble ---------------------------------------------------------------
const existing = readFileSync(TARGET, 'utf8');
const headerEnd = existing.indexOf('\nexport const translations = {');
if (headerEnd === -1) throw new Error('cannot find the translations object in ' + TARGET);

const objStart = existing.indexOf('{', headerEnd);
let depth = 1;
let i = objStart + 1;
let inStr = null;
while (i < existing.length && depth > 0) {
  const c = existing[i];
  if (inStr) {
    if (c === '\\') i++;
    else if (c === inStr) inStr = null;
  } else if (c === '"' || c === "'" || c === '`') inStr = c;
  else if (c === '{') depth++;
  else if (c === '}') depth--;
  i++;
}
// The object literal ends at i-1; skip any stray statement terminators left
// behind by earlier edits so the generated file stays byte-stable.
while (i < existing.length && existing[i] === ';') i++;
const tail = existing.slice(i);

const head = existing.slice(0, headerEnd + 1).replace(/\n+$/, '\n');
const blocks = catalogs.map((c) => '    ' + c.locale + ': {\n' + render(c.obj, 8) + '\n    }').join(',\n');
const body = head + '\nexport const translations = {\n' + blocks + '\n};' + tail;

if (process.argv.includes('--check')) {
  if (body !== existing) {
    console.error('translations.ts is stale - run: node scripts/build-i18n.mjs');
    process.exit(1);
  }
  console.log('translations.ts is up to date');
} else {
  writeFileSync(TARGET, body);
  console.log('wrote ' + TARGET);
}

for (const c of catalogs) console.log('  ' + c.locale + ': ' + countLeaves(c.obj) + ' keys');
if (drift) {
  console.error('FAILED: ' + drift + ' locale(s) drift from en');
  process.exit(1);
}
console.log('key parity OK');
