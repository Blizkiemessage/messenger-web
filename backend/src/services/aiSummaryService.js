/**
 * aiSummaryService.js — F2: AI-powered chat summary.
 *
 * Provider is fully configurable via env vars:
 *   AI_SUMMARY_ENABLED      — "true" to enable (default: false)
 *   AI_SUMMARY_API_KEY      — API key for the provider
 *   AI_SUMMARY_BASE_URL     — OpenAI-compatible base URL
 *                             default: https://generativelanguage.googleapis.com/v1beta/openai
 *   AI_SUMMARY_MODEL        — model name (default: gemini-2.0-flash)
 *   AI_SUMMARY_MAX_MESSAGES — how many recent messages to include (default: 50)
 *   AI_SUMMARY_CACHE_TTL_MS — cache TTL in ms (default: 300000 = 5 min)
 */
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { decrypt } = require('../crypto/aes');

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL    = 'gemini-2.0-flash';
const DEFAULT_MAX_MSG  = 50;
const DEFAULT_TTL_MS   = 5 * 60 * 1000; // 5 min

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

function getFromCache(db, chatId, userId, ttlMs) {
  const row = db.prepare(
    'SELECT summary, message_count, generated_at FROM chat_summary_cache WHERE chat_id = ? AND user_id = ?'
  ).get([chatId, userId]);
  if (!row) return null;
  if (Date.now() - row.generated_at > ttlMs) return null;
  return { summary: row.summary, messageCount: row.message_count, fromCache: true };
}

function saveToCache(db, chatId, userId, summary, messageCount) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO chat_summary_cache (id, chat_id, user_id, summary, message_count, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      summary = excluded.summary,
      message_count = excluded.message_count,
      generated_at = excluded.generated_at
  `).run([uuidv4(), chatId, userId, summary, messageCount, now]);
}

function collectMessages(db, chatId, userId, maxMsg) {
  const member = db.prepare(
    'SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?'
  ).get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const rows = db.prepare(`
    SELECT m.id, m.sender_id, m.ciphertext, m.iv, m.auth_tag,
           m.attachment_type, m.is_system, m.created_at,
           u.display_name, u.username
    FROM messages m
    LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.chat_id = ?
      AND m.deleted_at IS NULL
      AND m.is_delivered = 1
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all([chatId, maxMsg]);

  return rows.reverse().map(row => {
    let text = '';
    if (!row.is_system) {
      try {
        text = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }).trim();
      } catch { text = ''; }
    }
    const senderName = row.display_name || row.username || 'Unknown';
    const attachInfo = row.attachment_type ? `[${row.attachment_type}]` : '';
    const content = [text, attachInfo].filter(Boolean).join(' ').trim();
    if (!content) return null;
    return { senderName, content, createdAt: row.created_at };
  }).filter(Boolean);
}

function buildPrompt(messages) {
  const lines = messages.map(m => `${m.senderName}: ${m.content}`).join('\n');
  return `Ниже приведена история сообщений из чата. Напиши краткую сводку на русском языке (3–7 предложений): о чём говорили, какие ключевые темы и решения были затронуты. Без лишних вводных слов — сразу по существу.\n\n${lines}`;
}

async function callAI(prompt, config) {
  const url = `${config.baseUrl}/chat/completions`;
  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: 'Ты — помощник, который делает краткие сводки переписок на русском языке.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 600,
    temperature: 0.4,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`AI provider error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty response from AI provider');
  return text;
}

async function getChatSummary(chatId, userId) {
  const config = cfg();
  if (!config.enabled) {
    throw Object.assign(new Error('AI summary feature is not enabled'), { status: 503 });
  }
  if (!config.apiKey) {
    throw Object.assign(new Error('AI summary API key not configured'), { status: 503 });
  }

  const db = getDb();

  const cached = getFromCache(db, chatId, userId, config.cacheTtlMs);
  if (cached) return cached;

  const messages = collectMessages(db, chatId, userId, config.maxMsg);
  if (messages.length === 0) {
    return { summary: 'В этом чате пока нет сообщений для анализа.', messageCount: 0, fromCache: false };
  }

  const prompt = buildPrompt(messages);
  const summary = await callAI(prompt, config);

  saveToCache(db, chatId, userId, summary, messages.length);

  return { summary, messageCount: messages.length, fromCache: false };
}

module.exports = { getChatSummary };
