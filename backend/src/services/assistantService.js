/**
 * assistantService.js — ассистент-помощник (Этап C, v2): LLM-маршрутизатор.
 *
 * НЕ генерирует свободные ответы. Получает свободный вопрос пользователя +
 * каталог тем помощи (id → вопрос) и просит LLM выбрать ОДНУ самую подходящую
 * тему (или null). Фронт показывает уже выверенный ответ и кнопки-действия по
 * выбранному id. Так LLM понимает любые формулировки/опечатки/синонимы, но не
 * может выдумать ответ или несуществующее действие.
 *
 * Провайдер переиспользуется от AI-сводки (OpenAI-совместимый эндпоинт), чтобы
 * не плодить интеграций. Env (с фолбэком на AI_SUMMARY_*):
 *   AI_ASSISTANT_ENABLED  | AI_SUMMARY_ENABLED   — "true" чтобы включить
 *   AI_ASSISTANT_API_KEY  | AI_SUMMARY_API_KEY   — ключ
 *   AI_ASSISTANT_BASE_URL | AI_SUMMARY_BASE_URL  — base URL (OpenAI-совместимый)
 *   AI_ASSISTANT_MODEL    | AI_SUMMARY_MODEL      — модель
 */
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL    = 'gemini-2.0-flash';

const MAX_INTENTS  = 60;   // защита от раздутого payload от клиента
const MAX_QUESTION = 300;  // макс. длина вопроса (символов)

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

/** Достать первый JSON-объект из ответа модели (на случай code-fence/текста). */
function extractJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function callAI(question, catalog, config) {
  const url = `${config.baseUrl}/chat/completions`;
  const system =
    'Ты — маршрутизатор справки в мессенджере Blizkie. Тебе дают вопрос ' +
    'пользователя и список тем помощи в формате "id: вопрос". Выбери ОДНУ самую ' +
    'подходящую тему. Верни СТРОГО JSON вида {"id":"<id>"} — id берётся ТОЛЬКО ' +
    'из списка. Если ни одна тема не подходит, верни {"id":null}. Никакого ' +
    'текста, кроме JSON. Не придумывай id и не отвечай на сам вопрос.';
  const user = `Вопрос пользователя: "${question}"\n\nТемы помощи:\n${catalog}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 30,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`AI provider error ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * Выбрать подходящий интент.
 * @param {string} question — свободный вопрос пользователя
 * @param {Array<{id:string,question:string}>} intents — каталог тем (от фронта)
 * @returns {Promise<{intentId: string|null}>}
 */
async function routeQuestion(question, intents) {
  const config = cfg();
  if (!config.enabled || !config.apiKey) {
    throw Object.assign(new Error('AI-помощник не включён на сервере.'), { status: 503 });
  }

  const q = String(question || '').trim().slice(0, MAX_QUESTION);
  if (!q) return { intentId: null };

  // Санитизация каталога: только id+вопрос, обрезка, лимит количества.
  const list = (Array.isArray(intents) ? intents : [])
    .slice(0, MAX_INTENTS)
    .map(i => ({ id: String(i?.id ?? '').slice(0, 60), question: String(i?.question ?? '').slice(0, 200) }))
    .filter(i => i.id && i.question);
  if (!list.length) return { intentId: null };

  const validIds = new Set(list.map(i => i.id));
  const catalog = list.map(i => `${i.id}: ${i.question}`).join('\n');

  const raw = await callAI(q, catalog, config);
  const parsed = extractJson(raw);
  const id = parsed && typeof parsed.id === 'string' ? parsed.id : null;

  // Жёсткая валидация: id должен быть из присланного каталога, иначе — null.
  return { intentId: id && validIds.has(id) ? id : null };
}

module.exports = { routeQuestion, isEnabled };
