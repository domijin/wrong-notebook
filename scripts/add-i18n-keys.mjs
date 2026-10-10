#!/usr/bin/env node
/**
 * add-i18n-keys.mjs — merge newly-needed UI strings into the three catalogs.
 * Idempotent: existing keys are never overwritten, safe to re-run.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = {
  en: 'deploy/i18n/en.json',
  zh: 'deploy/i18n/zh.json',
  es: 'deploy/i18n/es.json',
};

const ADDITIONS = {
  en: {
    passwordConfirm: { title: 'Confirm your identity', desc: 'Enter your current password to perform this admin action.', label: 'Current password', submit: 'Confirm' },
    account: { currentPasswordLabel: 'Current password (required to change email or password)', enterCurrentFirst: 'Enter your current password above first', reloginHint: 'Sign in again with your new credentials…' },
    filter: { allGrades: 'All grades', allChapters: 'All chapters', allKnowledge: 'All knowledge points' },
    detail: {
      hideQuestionImage: 'Hide original image', viewQuestionImage: 'View original image',
      hideImage: 'Hide image', viewImage: 'View image',
      referenceImageAlt: 'Reference image', ownImageAlt: 'My answer image',
      geogebraTitle: 'GeoGebra interactive demo', geogebraGenerate: 'Generate demo',
      geogebraAnalyzing: 'AI analyzing...',
      geogebraHint: 'AI will judge whether this question suits an interactive GeoGebra demo and generate one automatically if so',
    },
    geogebra: { regenerate: 'Regenerate', reset: 'Reset' },
    tags: { otherCategory: 'Other' },
    admin: { retry: 'Retry' },
    translate: {
      title: 'Translate', description: 'Content is not in your interface language.',
      action: 'Translate content', translating: 'Translating...',
      original: 'Original', translated: 'Translated', backToOriginal: 'Show original',
      applyTranslation: 'Use this translation', translationSaved: 'Translation applied',
      failed: 'Translation failed',
      unsupportedPair: 'Translation is not available for this language pair yet. You can still edit the text manually.',
      targetLanguage: 'Translate to', noContent: 'There is no content to translate yet.',
    },
  },
  zh: {
    passwordConfirm: { title: '验证身份', desc: '请输入当前密码以执行管理操作。', label: '当前密码', submit: '确认' },
    account: { currentPasswordLabel: '当前密码（修改邮箱或密码时必填）', enterCurrentFirst: '请先在上方输入当前密码', reloginHint: '请用新的凭据重新登录…' },
    filter: { allGrades: '全部年级', allChapters: '全部章节', allKnowledge: '全部知识点' },
    detail: {
      hideQuestionImage: '隐藏原题图片', viewQuestionImage: '查看原题图片',
      hideImage: '隐藏图片', viewImage: '查看图片',
      referenceImageAlt: '参考图片', ownImageAlt: '我的答案图片',
      geogebraTitle: 'GeoGebra 动态演示', geogebraGenerate: '生成演示',
      geogebraAnalyzing: 'AI 分析中...',
      geogebraHint: 'AI 将判断本题是否可以用 GeoGebra 进行动态演示，如适合则自动生成交互式图形',
    },
    geogebra: { regenerate: '重新生成', reset: '重置' },
    tags: { otherCategory: '其他' },
    admin: { retry: '重试' },
    translate: {
      title: '翻译', description: '内容语言与界面语言不一致。',
      action: '翻译内容', translating: '正在翻译…',
      original: '原文', translated: '译文', backToOriginal: '查看原文',
      applyTranslation: '使用该译文', translationSaved: '译文已应用',
      failed: '翻译失败',
      unsupportedPair: '暂不支持该语言对的翻译，你仍可手动编辑文本。',
      targetLanguage: '翻译为', noContent: '暂无可翻译的内容。',
    },
  },
  es: {
    passwordConfirm: { title: 'Confirma tu identidad', desc: 'Introduce tu contraseña actual para realizar esta acción de administración.', label: 'Contraseña actual', submit: 'Confirmar' },
    account: { currentPasswordLabel: 'Contraseña actual (obligatoria para cambiar el correo o la contraseña)', enterCurrentFirst: 'Introduce primero tu contraseña actual arriba', reloginHint: 'Vuelve a iniciar sesión con tus nuevas credenciales…' },
    filter: { allGrades: 'Todos los cursos', allChapters: 'Todos los temas', allKnowledge: 'Todos los puntos de conocimiento' },
    detail: {
      hideQuestionImage: 'Ocultar la imagen original', viewQuestionImage: 'Ver la imagen original',
      hideImage: 'Ocultar la imagen', viewImage: 'Ver la imagen',
      referenceImageAlt: 'Imagen de referencia', ownImageAlt: 'Imagen de mi respuesta',
      geogebraTitle: 'Demo interactiva de GeoGebra', geogebraGenerate: 'Generar demo',
      geogebraAnalyzing: 'La IA está analizando...',
      geogebraHint: 'La IA decidirá si esta pregunta admite una demo interactiva de GeoGebra y la generará automáticamente si es así',
    },
    geogebra: { regenerate: 'Regenerar', reset: 'Restablecer' },
    tags: { otherCategory: 'Otras' },
    admin: { retry: 'Reintentar' },
    translate: {
      title: 'Traducir', description: 'El contenido no está en el idioma de tu interfaz.',
      action: 'Traducir contenido', translating: 'Traduciendo...',
      original: 'Original', translated: 'Traducción', backToOriginal: 'Ver el original',
      applyTranslation: 'Usar esta traducción', translationSaved: 'Traducción aplicada',
      failed: 'Error al traducir',
      unsupportedPair: 'La traducción no está disponible para este par de idiomas. Aun así, puedes editar el texto manualmente.',
      targetLanguage: 'Traducir a', noContent: 'Todavía no hay contenido que traducir.',
    },
  },
};

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object') {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], v);
    } else if (!(k in target)) {
      target[k] = v;
    }
  }
  return target;
}

for (const [locale, file] of Object.entries(FILES)) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  deepMerge(json, ADDITIONS[locale]);
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  console.log(locale + ': updated ' + file);
}
