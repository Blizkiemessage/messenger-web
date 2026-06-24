/**
 * assistantService.js — ассистент-помощник (Этап C): генератор ответа по базе знаний.
 *
 * LLM получает свободный вопрос пользователя + базу знаний приложения (FAQ:
 * вопрос/ответ/доступные кнопки-действия) и формулирует КАЧЕСТВЕННЫЙ ответ
 * строго по этой базе:
 *   - covered=true  → ответ под конкретный вопрос + relatedIds (темы, чьи
 *     кнопки-навигации уместны). Кнопки берёт ФРОНТ по id → deep-links всегда
 *     валидны (LLM не выдумывает действия).
 *   - covered=false → честно «в приложении этого нет / не нашёл» → фронт
 *     предлагает поддержку. Никаких выдуманных фактов.
 *
 * Провайдер переиспользуется от AI-сводки (OpenAI-совместимый, у пользователя —
 * Groq + llama-3.3-70b). Env (с фолбэком на AI_SUMMARY_*):
 *   AI_ASSISTANT_ENABLED  | AI_SUMMARY_ENABLED   — "true" чтобы включить
 *   AI_ASSISTANT_API_KEY  | AI_SUMMARY_API_KEY   — ключ
 *   AI_ASSISTANT_BASE_URL | AI_SUMMARY_BASE_URL  — base URL (OpenAI-совместимый)
 *   AI_ASSISTANT_MODEL    | AI_SUMMARY_MODEL      — модель
 */
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL    = 'llama-3.3-70b-versatile';

const MAX_KB        = 60;    // макс. тем в базе (защита payload)
const MAX_QUESTION  = 400;   // макс. длина вопроса (символов)
const MAX_ANSWER    = 600;   // макс. длина ответа темы, отдаваемой модели
const CACHE_TTL_MS  = 60 * 60 * 1000;
const CACHE_MAX     = 500;

// Простой in-memory кэш по нормализованному вопросу (экономит токены/латентность).
const cache = new Map(); // key → { value, at }

function cfg() {
  const enabled =
    process.env.AI_ASSISTANT_ENABLED === 'true' ||
    process.env.AI_SUMMARY_ENABLED === 'true';
  const apiKey  = process.env.AI_ASSISTANT_API_KEY || process.env.AI_SUMMARY_API_KEY || '';
  const baseUrl = (process.env.AI_ASSISTANT_BASE_URL || process.env.AI_SUMMARY_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model   = process.env.AI_ASSISTANT_MODEL || process.env.AI_SUMMARY_MODEL || DEFAULT_MODEL;
  return { enabled, apiKey, baseUrl, model };
}

/** Доступен ли LLM-слой (включён и есть ключ). */
function isEnabled() {
  const c = cfg();
  return c.enabled && !!c.apiKey;
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, at: Date.now() });
}

/** Достать первый JSON-объект из ответа модели (на случай текста вокруг). */
function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fallthrough */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const SYSTEM_PROMPT =
  'Ты — встроенный помощник мессенджера Blizkie (тёплый мессенджер для семьи и ' +
  'близких; интерфейс на русском). Отвечай ТОЛЬКО на основе предоставленной базы ' +
  'знаний (FAQ). Правила:\n' +
  '1) Сформулируй краткий, понятный и доброжелательный ответ ИМЕННО на вопрос ' +
  'пользователя (2–4 предложения), на русском, с практическим решением. Можно ' +
  'короткий список шагов. Используй факты ТОЛЬКО из базы — ничего не выдумывай.\n' +
  '2) Если в базе есть подходящие темы, укажи их id в relatedIds (0–2 самых ' +
  'релевантных) — по ним пользователю покажут кнопки-навигации. Бери id ТОЛЬКО ' +
  'из базы.\n' +
  '3) Если вопрос НЕ покрыт базой или относится к отсутствующей функции — поставь ' +
  'covered=false, честно и кратко объясни это и не выдумывай несуществующих ' +
  'возможностей. relatedIds в этом случае пустой.\n' +
  'Верни СТРОГО JSON: {"reply": string, "covered": boolean, "relatedIds": string[]}. ' +
  'Без какого-либо текста вне JSON.';

async function callAI(question, kb, config) {
  const url = `${config.baseUrl}/chat/completions`;
  const kbText = kb.map(i => {
    const acts = (i.actions || []).map(a => a.label).filter(Boolean);
    const actsLine = acts.length ? `\n  кнопки: ${acts.join(' / ')}` : '';
    return `[id: ${i.id}]\n  вопрос: ${i.question}\n  ответ: ${i.answer}${actsLine}`;
  }).join('\n\n');

  const userMsg =
    `Вопрос пользователя:\n"${question}"\n\n` +
    `База знаний приложения (темы):\n${kbText}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      max_tokens: 500,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`AI provider error ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * Сгенерировать ответ помощника по базе знаний.
 * @param {string} question — свободный вопрос пользователя
 * @param {Array<{id,question,answer,actions?:Array<{label}>}>} kb — база (от фронта)
 * @returns {Promise<{reply:string, covered:boolean, relatedIds:string[]}>}
 */
async function answerQuestion(question, kb) {
  const config = cfg();
  if (!config.enabled || !config.apiKey) {
    throw Object.assign(new Error('AI-помощник не включён на сервере.'), { status: 503 });
  }

  const q = String(question || '').trim().slice(0, MAX_QUESTION);
  if (!q) return { reply: '', covered: false, relatedIds: [] };

  // Санитизация базы: только нужные поля, обрезка, лимит количества.
  const list = (Array.isArray(kb) ? kb : [])
    .slice(0, MAX_KB)
    .map(i => ({
      id: String(i?.id ?? '').slice(0, 60),
      question: String(i?.question ?? '').slice(0, 200),
      answer: String(i?.answer ?? '').slice(0, MAX_ANSWER),
      actions: Array.isArray(i?.actions)
        ? i.actions.slice(0, 3).map(a => ({ label: String(a?.label ?? '').slice(0, 60) })).filter(a => a.label)
        : [],
    }))
    .filter(i => i.id && i.question);
  if (!list.length) return { reply: '', covered: false, relatedIds: [] };

  const validIds = new Set(list.map(i => i.id));
  const cacheKey = `${config.model}::${q.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const raw = await callAI(q, list, config);
  const parsed = extractJson(raw) || {};

  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  const covered = parsed.covered === true && !!reply;
  const relatedIds = Array.isArray(parsed.relatedIds)
    ? parsed.relatedIds.filter(id => typeof id === 'string' && validIds.has(id)).slice(0, 2)
    : [];

  const result = covered
    ? { reply, covered: true, relatedIds }
    : { reply: reply || '', covered: false, relatedIds: [] };

  cacheSet(cacheKey, result);
  return result;
}

module.exports = { answerQuestion, isEnabled };
