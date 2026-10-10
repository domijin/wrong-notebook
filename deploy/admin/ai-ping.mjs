#!/usr/bin/env node
/**
 * ai-ping.mjs — send one tiny request to the active OpenAI-compatible AI
 * instance and print the status, finish reason, token usage and the start
 * of the reply. Use it when AI features fail. The API key is never printed.
 *
 * Run inside the app container (see deploy/admin-run.sh):
 *   node ai-ping.mjs
 */

import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(process.env.APP_CONFIG_FILE || '/app/config/app-config.json', 'utf8'));
const instances = config.openai?.instances || [];
const inst = instances.find(i => i.id === config.openai?.activeInstanceId) || instances[0];
if (!inst) {
  console.error(`no OpenAI-compatible instance configured (aiProvider: ${config.aiProvider})`);
  process.exit(2);
}
console.log('provider:', config.aiProvider, 'base:', inst.baseUrl, 'model:', inst.model, 'key set:', !!inst.apiKey);

const started = Date.now();
const res = await fetch(`${inst.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${inst.apiKey}`,
    // some gateways reject non-browser user agents
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
  body: JSON.stringify({
    model: inst.model,
    messages: [{ role: 'user', content: 'reply with JSON only: {"a":1,"b":"x"}' }],
    temperature: 0.2,
    max_tokens: 400,
  }),
  signal: AbortSignal.timeout(60000),
});

console.log('status:', res.status, `(${Date.now() - started} ms)`);
const text = await res.text();
try {
  const data = JSON.parse(text);
  console.log('finish_reason:', data.choices?.[0]?.finish_reason);
  console.log('usage:', JSON.stringify(data.usage));
  console.log('content:', JSON.stringify((data.choices?.[0]?.message?.content || '').slice(0, 700)));
} catch {
  console.log('non-JSON reply:', text.slice(0, 700));
}
process.exitCode = res.ok ? 0 : 1;
