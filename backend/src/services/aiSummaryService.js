/**
 * aiSummaryService.js — F2: AI-powered chat summary.
 *
 * Env vars:
 *   AI_SUMMARY_ENABLED      — "true" to enable
 *   AI_SUMMARY_API_KEY      — API key
 *   AI_SUMMARY_BASE_URL     — OpenAI-compatible base URL
 *                             default: https://generativelanguage.googleapis.com/v1beta/openai
 *   AI_SUMMARY_MODEL        — model (default: gemini-2.0-flash)
 *   AI_SUMMARY_MAX_MESSAGES — max messages to include (default: 100)
 *   AI_SUMMARY_CACHE_TTL_MS — cache TTL ms (default: 300000)
 */
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { decrypt } = require('../crypto/aes');

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL    = 'gemini-2.0-flash';
const DEFAULT_MAX_MSG  = 100;
const DEFAULT_TTL_MS   = 5 * 60 * 1000;

// Period → milliseconds back from now (null = all time)
const PERIOD_MS = {
  all:  null,
  '1h':  1 * 60 * 60 * 1000,
  '6h':  6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d':  3 * 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  unread: 'unread', // special — uses last_read_at
};

const FORMAT_TOKENS = { short: 250, normal: 500, detailed: 900 };
const FORMAT_TEMP   = { short: 0.3, normal: 0.4, detailed: 0.5 };

function formatInstruction(format) {
  if (format === 'short')    return 'Напиши очень краткую сводку (2–3 предложения) — только самое главное.';
  if (format === 'detailed') return 'Напиши подробный структурированный разбор: основные темы, ключевые решения или договорённости, открытые вопросы без ответа. Используй короткие списки там, где уместно.';
  return 'Напиши сводку (4–6 предложений): о чём говорили, какие темы и решения затронуты.';
}

function cfg() {
  return {
    enabled:    process.env.AI_SUMMARY_ENABLED === 'true',
    apiKey:     process.env.AI_SUMMARY_API_KEY || '',
    baseUrl:    (process.env.AI_SUMMARY_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model:      process.env.AI_SUMMARY_MODEL || DEFAULT_MODEL,
    maxMsg:     parseInt(process.env.AI_SUMMARY_MAX_MESSAGES || String(DEFAULT_MAX_MSG), 10),
    cacheTtlMs: parseInt(process.env.AI_SUMMARY_CACHE_TTL_MS || String(DEFAULT_TTL_MS), 10),
  };
}

function getFromCache(db, chatId, userId, period, format, ttlMs) {
  const row = db.prepare(`
    SELECT summary, message_count, generated_at
    FROM chat_summary_cache
    WHERE chat_id = ? AND user_id = ? AND period = ? AND format = ?
  `).get([chatId, userId, period, format]);
  if (!row) return null;
  if (Date.now() - row.generated_at > ttlMs) return null;
  return { summary: row.summary, messageCount: row.message_count, fromCache: true };
}

function saveToCache(db, chatId, userId, period, format, summary, messageCount) {
  // Delete old entry for this combination first (avoids stale UNIQUE violation)
  db.prepare(`DELETE FROM chat_summary_cache WHERE chat_id = ? AND user_id = ? AND period = ? AND format = ?`)
    .run([chatId, userId, period, format]);
  db.prepare(`
    INSERT INTO chat_summary_cache (id, chat_id, user_id, period, format, summary, message_count, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run([uuidv4(), chatId, userId, period, format, summary, messageCount, Date.now()]);
}

function getSinceTimestamp(db, chatId, userId, period) {
  if (period === 'unread') {
    const row = db.prepare(
      'SELECT last_read_at FROM chat_members WHERE chat_id = ? AND user_id = ?'
    ).get([chatId, userId]);
    return row?.last_read_at ?? 0;
  }
  const ms = PERIOD_MS[period];
  if (ms == null) return 0; // all
  return Date.now() - ms;
}

function queryMessages(db, chatId, sinceTs, maxMsg) {
  // is_delivered may be NULL on rows created before the F1 migration — treat NULL as delivered
  return db.prepare(`
    SELECT m.sender_id, m.ciphertext, m.iv, m.auth_tag,
           m.attachment_type, m.is_system, m.created_at,
           u.display_name, u.username
    FROM messages m
    LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.chat_id = ?
      AND m.deleted_at IS NULL
      AND (m.is_delivered IS NULL OR m.is_delivered = 1)
      AND m.created_at >= ?
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all([chatId, sinceTs, maxMsg]);
}

function collectMessages(db, chatId, userId, period, maxMsg) {
  const member = db.prepare(
    'SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?'
  ).get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  let sinceTs = getSinceTimestamp(db, chatId, userId, period);
  let rows = queryMessages(db, chatId, sinceTs, maxMsg);

  // If "unread" returned nothing, fall back to last maxMsg messages of all time
  if (rows.length === 0 && period === 'unread') {
    sinceTs = 0;
    rows = queryMessages(db, chatId, 0, maxMsg);
  }

  return rows.reverse().map(row => {
    let text = '';
    if (!row.is_system) {
      try {
        text = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }).trim();
      } catch { text = ''; }
    }
    const senderName = row.display_name || row.username || 'Пользователь';
    const attachInfo = row.attachment_type ? `[вложение: ${row.attachment_type}]` : '';
    const content = [text, attachInfo].filter(Boolean).join(' ').trim();
    if (!content) return null;
    return { senderName, content };
  }).filter(Boolean);
}

function buildPrompt(messages, format) {
  const lines = messages.map(m => `${m.senderName}: ${m.content}`).join('\n');
  const instruction = formatInstruction(format);
  return `${instruction} Отвечай на русском языке. Не добавляй вводных фраз вроде «Вот сводка» — сразу по существу.\n\nПереписка:\n${lines}`;
}

async function callAI(prompt, format, config) {
  const url = `${config.baseUrl}/chat/completions`;
  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: 'Ты — помощник, который делает краткие и точные сводки переписок на русском языке.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: FORMAT_TOKENS[format] ?? FORMAT_TOKENS.normal,
    temperature: FORMAT_TEMP[format] ?? FORMAT_TEMP.normal,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`AI provider error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('AI provider вернул пустой ответ');
  return text;
}

async function getChatSummary(chatId, userId, { period = 'all', format = 'normal' } = {}) {
  const config = cfg();

  if (!config.enabled) {
    throw Object.assign(new Error('AI-сводка не включена. Добавьте AI_SUMMARY_ENABLED=true в конфигурацию сервера.'), { status: 503 });
  }
  if (!config.apiKey) {
    throw Object.assign(new Error('AI-сводка: API ключ не настроен (AI_SUMMARY_API_KEY).'), { status: 503 });
  }

  const periodKey = PERIOD_MS.hasOwnProperty(period) ? period : 'all';
  const formatKey = FORMAT_TOKENS.hasOwnProperty(format) ? format : 'normal';

  const db = getDb();

  const cached = getFromCache(db, chatId, userId, periodKey, formatKey, config.cacheTtlMs);
  if (cached) return cached;

  const messages = collectMessages(db, chatId, userId, periodKey, config.maxMsg);

  if (messages.length === 0) {
    const label = periodKey === 'unread'
      ? 'среди непрочитанных сообщений'
      : periodKey === 'all' ? 'в этом чате' : 'за выбранный период';
    return {
      summary: `Нет текстовых сообщений ${label} для анализа.`,
      messageCount: 0,
      fromCache: false,
    };
  }

  const prompt = buildPrompt(messages, formatKey);
  const summary = await callAI(prompt, formatKey, config);

  try {
    saveToCache(db, chatId, userId, periodKey, formatKey, summary, messages.length);
  } catch (cacheErr) {
    // Cache write failing must never break the user-facing response
    console.error('[AI Summary] cache write error:', cacheErr?.message);
  }

  const result = { summary, messageCount: messages.length, fromCache: false };
  console.log(`[AI Summary] ok — chat=${chatId} period=${periodKey} format=${formatKey} msgs=${messages.length} summaryLen=${summary.length}`);
  return result;
}

module.exports = { getChatSummary };
