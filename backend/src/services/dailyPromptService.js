'use strict';

/**
 * dailyPromptService.js — фича «Вопрос дня».
 *
 * Карточка-вопрос отдаётся в общую ленту как сообщение с
 * attachment_type='daily_prompt' (переиспользует broadcast/push/пагинацию).
 * Ответы (текст/голос/кружок/медиа) живут в отдельной таблице и собираются в
 * треде вопроса — в основную ленту не попадают.
 *
 * Текст вопросов и ответов шифруется (AES-256-GCM) — плейнтекста at-rest нет.
 */

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { encrypt, decrypt } = require('../crypto/aes');
const { getMemberPermissions } = require('./chatPermissions');
const { builtinText, keysForBanks } = require('./dailyPromptBank');

const DEFAULT_TZ = 'Europe/Moscow';
const STREAK_SCAN_CAP = 400; // > 1 года ежедневных вопросов

// ── Helpers: время в часовом поясе чата ──────────────────────────────────────

/** Текущие дата/минуты в указанном IANA-поясе. Бросает при неизвестном поясе. */
function partsInTz(tz, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const hour = p.hour === '24' ? 0 : Number(p.hour); // некоторые ICU дают 24 для полуночи
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    minutes: hour * 60 + Number(p.minute),
  };
}

/** Предыдущий календарный день для ключа 'YYYY-MM-DD'. */
function prevDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** День недели (0=вс..6=сб) для ключа 'YYYY-MM-DD' (не зависит от пояса). */
function weekdayOf(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ── Конфиг ────────────────────────────────────────────────────────────────────

function parseJson(str, fallback) {
  try { const v = JSON.parse(str); return v == null ? fallback : v; }
  catch { return fallback; }
}

const DEFAULT_CONFIG = Object.freeze({
  enabled: 0,
  send_time: 1260,
  timezone: DEFAULT_TZ,
  schedule: { type: 'daily' },
  source: { banks: ['family'], use_builtin: 1, use_custom: 1 },
  order_mode: 'shuffle',
  push_enabled: 1,
  push_text: null,
});

/** Сырой ряд конфига или null. */
function getConfigRow(db, chatId) {
  return db.prepare('SELECT * FROM chat_daily_prompts WHERE chat_id = ?').get(chatId) || null;
}

/** Конфиг для отдачи на клиент (с распарсенными JSON и дефолтами). */
function getConfig(chatId) {
  const db = getDb();
  const row = getConfigRow(db, chatId);
  if (!row) return { ...DEFAULT_CONFIG, exists: false };
  return {
    exists: true,
    enabled: !!row.enabled,
    send_time: row.send_time,
    timezone: row.timezone,
    schedule: parseJson(row.schedule, DEFAULT_CONFIG.schedule),
    source: parseJson(row.source, DEFAULT_CONFIG.source),
    order_mode: row.order_mode,
    push_enabled: !!row.push_enabled,
    push_text: row.push_text,
    last_sent_date: row.last_sent_date,
    updated_at: row.updated_at,
  };
}

/** Проверка права управлять фичей (как у общего фона чата). */
function assertCanManage(db, chatId, userId) {
  const chat = db.prepare('SELECT type FROM chats WHERE id = ?').get(chatId);
  if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  if (chat.type === 'direct') return; // в ЛС оба равны
  const perms = getMemberPermissions(db, chatId, userId);
  if (!perms || !perms.edit_info) {
    throw Object.assign(new Error('Недостаточно прав для управления «Вопросом дня»'), { status: 403 });
  }
}

function assertMember(db, chatId, userId) {
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
}

const VALID_TZ_RE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/;

/** Создать/обновить конфиг. Возвращает getConfig(). */
function updateConfig(chatId, userId, patch = {}) {
  const db = getDb();
  assertCanManage(db, chatId, userId);

  const cur = getConfigRow(db, chatId);
  const merged = {
    enabled:      patch.enabled != null ? (patch.enabled ? 1 : 0) : (cur?.enabled ?? DEFAULT_CONFIG.enabled),
    send_time:    patch.send_time != null ? Math.max(0, Math.min(1439, Math.floor(patch.send_time))) : (cur?.send_time ?? DEFAULT_CONFIG.send_time),
    timezone:     patch.timezone != null ? String(patch.timezone) : (cur?.timezone ?? DEFAULT_TZ),
    schedule:     patch.schedule != null ? JSON.stringify(sanitizeSchedule(patch.schedule)) : (cur?.schedule ?? JSON.stringify(DEFAULT_CONFIG.schedule)),
    source:       patch.source != null ? JSON.stringify(sanitizeSource(patch.source)) : (cur?.source ?? JSON.stringify(DEFAULT_CONFIG.source)),
    order_mode:   patch.order_mode === 'sequential' ? 'sequential' : (patch.order_mode === 'shuffle' ? 'shuffle' : (cur?.order_mode ?? 'shuffle')),
    push_enabled: patch.push_enabled != null ? (patch.push_enabled ? 1 : 0) : (cur?.push_enabled ?? 1),
    push_text:    patch.push_text !== undefined ? (patch.push_text ? String(patch.push_text).slice(0, 120) : null) : (cur?.push_text ?? null),
  };

  if (!VALID_TZ_RE.test(merged.timezone)) merged.timezone = DEFAULT_TZ;
  // Валидируем пояс реальной попыткой форматирования
  try { partsInTz(merged.timezone); } catch { merged.timezone = DEFAULT_TZ; }

  const now = Date.now();
  if (cur) {
    db.prepare(`
      UPDATE chat_daily_prompts SET enabled=?, send_time=?, timezone=?, schedule=?, source=?,
        order_mode=?, push_enabled=?, push_text=?, updated_by=?, updated_at=?
      WHERE chat_id=?
    `).run([merged.enabled, merged.send_time, merged.timezone, merged.schedule, merged.source,
      merged.order_mode, merged.push_enabled, merged.push_text, userId, now, chatId]);
  } else {
    db.prepare(`
      INSERT INTO chat_daily_prompts (chat_id, enabled, send_time, timezone, schedule, source,
        order_mode, bag_state, push_enabled, push_text, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)
    `).run([chatId, merged.enabled, merged.send_time, merged.timezone, merged.schedule, merged.source,
      merged.order_mode, merged.push_enabled, merged.push_text, userId, now]);
  }
  return getConfig(chatId);
}

function sanitizeSchedule(s) {
  const type = ['daily', 'weekdays', 'weekly'].includes(s?.type) ? s.type : 'daily';
  if (type === 'daily') return { type };
  const days = Array.isArray(s?.days)
    ? [...new Set(s.days.map(Number).filter(d => d >= 0 && d <= 6))].sort()
    : [];
  return { type, days: days.length ? days : [1] }; // по умолчанию понедельник
}

function sanitizeSource(s) {
  const banks = Array.isArray(s?.banks)
    ? [...new Set(s.banks.map(String))].slice(0, 20)
    : [];
  return {
    banks,
    use_builtin: s?.use_builtin ? 1 : 0,
    use_custom:  s?.use_custom ? 1 : 0,
  };
}

// ── Свои вопросы чата ─────────────────────────────────────────────────────────

function listCustomQuestions(chatId, userId) {
  const db = getDb();
  assertMember(db, chatId, userId);
  return db.prepare(
    'SELECT id, text, sort_order, created_by, created_at FROM chat_daily_prompt_questions WHERE chat_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(chatId);
}

function addCustomQuestion(chatId, userId, text) {
  const db = getDb();
  assertCanManage(db, chatId, userId);
  const clean = String(text || '').trim().slice(0, 300);
  if (!clean) throw Object.assign(new Error('Пустой вопрос'), { status: 400 });
  const maxRow = db.prepare('SELECT MAX(sort_order) AS m FROM chat_daily_prompt_questions WHERE chat_id = ?').get(chatId);
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    'INSERT INTO chat_daily_prompt_questions (id, chat_id, text, sort_order, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run([id, chatId, clean, (maxRow?.m ?? 0) + 1, userId, now]);
  return { id, text: clean, sort_order: (maxRow?.m ?? 0) + 1, created_by: userId, created_at: now };
}

function deleteCustomQuestion(chatId, userId, questionId) {
  const db = getDb();
  assertCanManage(db, chatId, userId);
  const info = db.prepare('DELETE FROM chat_daily_prompt_questions WHERE id = ? AND chat_id = ?').run([questionId, chatId]);
  if (info.changes === 0) throw Object.assign(new Error('Not found'), { status: 404 });
  return { ok: true, id: questionId };
}

// ── Выбор следующего вопроса ──────────────────────────────────────────────────

/** Пул кандидатов: [{ key, text, category }]. */
function buildPool(db, chatId, source) {
  const pool = [];
  if (source.use_builtin) {
    for (const key of keysForBanks(source.banks)) {
      const text = builtinText(key);
      if (text) pool.push({ key, text, category: key.split(':')[1] });
    }
  }
  if (source.use_custom) {
    const customs = db.prepare(
      'SELECT id, text FROM chat_daily_prompt_questions WHERE chat_id = ? ORDER BY sort_order ASC, created_at ASC'
    ).all(chatId);
    for (const c of customs) pool.push({ key: `c:${c.id}`, text: c.text, category: 'custom' });
  }
  return pool;
}

/**
 * Выбрать следующий вопрос с учётом order_mode и bag_state.
 * Возвращает { picked, newBag } или null, если пул пуст.
 */
function pickNext(cfgRow, pool) {
  if (pool.length === 0) return null;
  const bag = parseJson(cfgRow.bag_state, {});

  if (cfgRow.order_mode === 'sequential') {
    const seq = Number.isInteger(bag.seq) ? bag.seq : 0;
    const picked = pool[seq % pool.length];
    return { picked, newBag: { ...bag, seq: seq + 1 } };
  }

  // shuffle: «мешок» без повторов, пока не исчерпан весь пул
  let used = Array.isArray(bag.used) ? bag.used : [];
  const usedSet = new Set(used);
  let remaining = pool.filter(p => !usedSet.has(p.key));
  if (remaining.length === 0) { used = []; remaining = pool; } // мешок исчерпан → заново
  const picked = remaining[Math.floor(Math.random() * remaining.length)];
  return { picked, newBag: { ...bag, used: [...used, picked.key] } };
}

// ── Создание инстанса (заданного вопроса) + карточка в ленте ──────────────────

/**
 * Создать инстанс вопроса в чате: запись в daily_prompt_instances + карточка в
 * messages (attachment_type='daily_prompt'). Возвращает объект для broadcast:
 * { message, members, push: { enabled, text } }.
 *
 * forceDate — для ручного «задать сейчас» можно передать готовый dateKey.
 */
function createInstanceTx(db, cfgRow, picked, dateKey) {
  const now = Date.now();
  const instanceId = uuidv4();
  const messageId = uuidv4();
  const enc = encrypt(picked.text);

  // Автор карточки для FK: тот, кто настроил фичу (или любой участник как fallback).
  let authorId = cfgRow.updated_by;
  if (!authorId) {
    const anyMember = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ? LIMIT 1').get(cfgRow.chat_id);
    authorId = anyMember?.user_id || null;
  }

  const meta = JSON.stringify({ kind: 'daily_prompt', instanceId, category: picked.category });

  db.prepare(`
    INSERT INTO messages (id, chat_id, sender_id, ciphertext, iv, auth_tag, created_at,
      attachment_type, attachment_meta, is_system, is_delivered, has_link)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'daily_prompt', ?, 1, 1, 0)
  `).run([messageId, cfgRow.chat_id, authorId, enc.ciphertext, enc.iv, enc.authTag, now, meta]);

  db.prepare(`
    INSERT INTO daily_prompt_instances (id, chat_id, ciphertext, iv, auth_tag, category,
      question_key, date_key, message_id, answer_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run([instanceId, cfgRow.chat_id, enc.ciphertext, enc.iv, enc.authTag, picked.category,
    picked.key, dateKey, messageId, now]);

  // Карточка-вопрос увеличивает unread у всех участников — чтобы заметили.
  db.prepare('UPDATE chat_members SET unread_count = unread_count + 1 WHERE chat_id = ?').run(cfgRow.chat_id);

  const message = {
    id: messageId, chat_id: cfgRow.chat_id, sender_id: authorId,
    text: picked.text, created_at: now,
    attachment_type: 'daily_prompt',
    attachment_meta: meta,
    is_system: true, is_delivered: true,
    daily_prompt: { instance_id: instanceId, category: picked.category, answer_count: 0 },
  };
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(cfgRow.chat_id);
  return { message, members, push: { enabled: !!cfgRow.push_enabled, text: cfgRow.push_text || '🌙 Вопрос дня' } };
}

// ── Воркер доставки ────────────────────────────────────────────────────────────

function isScheduledDay(schedule, dateKey) {
  const s = parseJson(typeof schedule === 'string' ? schedule : JSON.stringify(schedule), { type: 'daily' });
  if (s.type === 'daily') return true;
  const wd = weekdayOf(dateKey);
  if (s.type === 'weekdays') return wd >= 1 && wd <= 5;
  if (s.type === 'weekly') return Array.isArray(s.days) && s.days.includes(wd);
  return true;
}

/**
 * Найти все чаты, где пора отправить вопрос дня, создать инстансы и вернуть их
 * для broadcast'а. Вызывается из setInterval в socketServer (зеркало
 * deliverPendingMessages).
 *
 * @returns {{ message, members, push }[]}
 */
function deliverDueDailyPrompts() {
  const db = getDb();
  const configs = db.prepare('SELECT * FROM chat_daily_prompts WHERE enabled = 1').all();
  const results = [];

  for (const cfg of configs) {
    let parts;
    try { parts = partsInTz(cfg.timezone || DEFAULT_TZ); } catch { continue; }
    if (cfg.last_sent_date === parts.dateKey) continue;   // уже отправляли сегодня
    if (parts.minutes < cfg.send_time) continue;          // ещё не время
    if (!isScheduledDay(cfg.schedule, parts.dateKey)) continue; // не день по расписанию

    const source = parseJson(cfg.source, DEFAULT_CONFIG.source);
    const pool = buildPool(db, cfg.chat_id, source);
    const next = pickNext(cfg, pool);
    if (!next) continue; // нет вопросов в источнике

    try {
      const tx = db.transaction(() => {
        const out = createInstanceTx(db, cfg, next.picked, parts.dateKey);
        db.prepare('UPDATE chat_daily_prompts SET bag_state = ?, last_sent_date = ? WHERE chat_id = ?')
          .run([JSON.stringify(next.newBag), parts.dateKey, cfg.chat_id]);
        return out;
      });
      results.push(tx());
    } catch (e) {
      console.error('[DailyPrompt] deliver error for chat', cfg.chat_id, e.message);
    }
  }
  return results;
}

/** Ручной запуск «задать вопрос сейчас». Возвращает один результат для broadcast. */
function askNow(chatId, userId) {
  const db = getDb();
  assertCanManage(db, chatId, userId);
  let cfg = getConfigRow(db, chatId);
  if (!cfg) { updateConfig(chatId, userId, {}); cfg = getConfigRow(db, chatId); }

  const parts = partsInTz(cfg.timezone || DEFAULT_TZ);
  const source = parseJson(cfg.source, DEFAULT_CONFIG.source);
  const pool = buildPool(db, chatId, source);
  const next = pickNext(cfg, pool);
  if (!next) throw Object.assign(new Error('Нет вопросов в выбранных источниках'), { status: 400 });

  const tx = db.transaction(() => {
    const out = createInstanceTx(db, cfg, next.picked, parts.dateKey);
    db.prepare('UPDATE chat_daily_prompts SET bag_state = ?, last_sent_date = ? WHERE chat_id = ?')
      .run([JSON.stringify(next.newBag), parts.dateKey, chatId]);
    return out;
  });
  return tx();
}

// ── Стрик (серия) ──────────────────────────────────────────────────────────────

/**
 * Серия: число подряд идущих календарных дней с ≥1 ответом, считая с самого
 * свежего инстанса. Сегодняшний неотвеченный («pending») не обнуляет серию —
 * он пропускается; реальный пропущенный день — обрывает.
 */
function computeStreak(db, chatId) {
  const rows = db.prepare(`
    SELECT date_key, MAX(CASE WHEN answer_count > 0 THEN 1 ELSE 0 END) AS answered
    FROM daily_prompt_instances WHERE chat_id = ?
    GROUP BY date_key ORDER BY date_key DESC LIMIT ?
  `).all([chatId, STREAK_SCAN_CAP]);

  let streak = 0;
  let cursor = null; // ожидаемый date_key следующего звена
  for (const r of rows) {
    if (cursor && r.date_key !== cursor) break; // пропущенный день — обрыв
    if (r.answered) {
      streak++;
      cursor = prevDateKey(r.date_key);
    } else if (streak === 0 && cursor === null) {
      cursor = prevDateKey(r.date_key); // самый свежий день ещё без ответа — пропускаем
    } else {
      break;
    }
  }
  return streak;
}

// ── Ответы ──────────────────────────────────────────────────────────────────────

function decryptAnswer(row) {
  let text = '';
  if (row.ciphertext) {
    try { text = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }).trim(); }
    catch { text = ''; }
  }
  return {
    id: row.id, instance_id: row.instance_id, chat_id: row.chat_id, user_id: row.user_id,
    text,
    attachment_url: row.attachment_url || null,
    attachment_type: row.attachment_type || null,
    attachment_name: row.attachment_name || null,
    attachment_meta: row.attachment_meta || null,
    attachment_size: row.attachment_size || null,
    attachment_duration: row.attachment_duration != null ? row.attachment_duration : null,
    voice_waveform: row.voice_waveform || null,
    created_at: row.created_at,
  };
}

function getInstanceWithMeta(db, chatId, instanceId) {
  const inst = db.prepare('SELECT * FROM daily_prompt_instances WHERE id = ? AND chat_id = ?').get([instanceId, chatId]);
  if (!inst) throw Object.assign(new Error('Not found'), { status: 404 });
  let text = '';
  try { text = decrypt({ ciphertext: inst.ciphertext, iv: inst.iv, authTag: inst.auth_tag }).trim(); }
  catch { text = '[encrypted]'; }
  return {
    id: inst.id, chat_id: inst.chat_id, category: inst.category,
    date_key: inst.date_key, message_id: inst.message_id,
    answer_count: inst.answer_count, created_at: inst.created_at, text,
  };
}

/** Архив: список заданных вопросов (новые сверху), с пагинацией по created_at. */
function listInstances(chatId, userId, { limit = 30, before = null } = {}) {
  const db = getDb();
  assertMember(db, chatId, userId);
  const lim = Math.max(1, Math.min(100, limit));
  const rows = before
    ? db.prepare('SELECT * FROM daily_prompt_instances WHERE chat_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?').all([chatId, before, lim + 1])
    : db.prepare('SELECT * FROM daily_prompt_instances WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?').all([chatId, lim + 1]);
  const hasMore = rows.length > lim;
  if (hasMore) rows.pop();
  const items = rows.map(r => {
    let text = '';
    try { text = decrypt({ ciphertext: r.ciphertext, iv: r.iv, authTag: r.auth_tag }).trim(); }
    catch { text = '[encrypted]'; }
    return { id: r.id, category: r.category, date_key: r.date_key, message_id: r.message_id, answer_count: r.answer_count, created_at: r.created_at, text };
  });
  return { items, hasMore };
}

/** Тред: инстанс + все ответы (расшифрованы; вложения НЕ подписаны — это делает роут). */
function getInstanceThread(chatId, userId, instanceId) {
  const db = getDb();
  assertMember(db, chatId, userId);
  const instance = getInstanceWithMeta(db, chatId, instanceId);
  const rows = db.prepare('SELECT * FROM daily_prompt_answers WHERE instance_id = ? ORDER BY created_at ASC').all(instanceId);
  return { instance, answers: rows.map(decryptAnswer) };
}

/** Добавить ответ (текст и/или вложение). Возвращает { answer, members, instance }. */
function addAnswer(chatId, userId, instanceId, { text = '', attachment = {} } = {}) {
  const db = getDb();
  assertMember(db, chatId, userId);
  const inst = db.prepare('SELECT id FROM daily_prompt_instances WHERE id = ? AND chat_id = ?').get([instanceId, chatId]);
  if (!inst) throw Object.assign(new Error('Not found'), { status: 404 });

  const clean = String(text || '').trim();
  const hasAttachment = !!attachment?.attachment_url;
  if (!clean && !hasAttachment) throw Object.assign(new Error('Пустой ответ'), { status: 400 });

  const enc = clean ? encrypt(clean) : { ciphertext: '', iv: '', authTag: '' };
  const id = uuidv4();
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO daily_prompt_answers (id, instance_id, chat_id, user_id, ciphertext, iv, auth_tag,
        attachment_url, attachment_type, attachment_name, attachment_meta, attachment_size, attachment_duration, voice_waveform, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run([id, instanceId, chatId, userId, enc.ciphertext, enc.iv, enc.authTag,
      attachment.attachment_url || null, attachment.attachment_type || null,
      attachment.attachment_name || null, attachment.attachment_meta || null,
      attachment.attachment_size || null,
      attachment.attachment_duration != null ? attachment.attachment_duration : null,
      typeof attachment.voice_waveform === 'string' ? attachment.voice_waveform : null,
      now]);
    db.prepare('UPDATE daily_prompt_instances SET answer_count = answer_count + 1 WHERE id = ?').run(instanceId);
  });
  tx();

  const answer = decryptAnswer(db.prepare('SELECT * FROM daily_prompt_answers WHERE id = ?').get(id));
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);
  const newCount = db.prepare('SELECT answer_count FROM daily_prompt_instances WHERE id = ?').get(instanceId)?.answer_count ?? 0;
  return { answer, members, instance_id: instanceId, answer_count: newCount, streak: computeStreak(db, chatId) };
}

/** Удалить свой ответ. Возвращает { ok, id, instance_id, answer_count }. */
function deleteAnswer(chatId, userId, answerId) {
  const db = getDb();
  assertMember(db, chatId, userId);
  const ans = db.prepare('SELECT id, instance_id, user_id FROM daily_prompt_answers WHERE id = ? AND chat_id = ?').get([answerId, chatId]);
  if (!ans) throw Object.assign(new Error('Not found'), { status: 404 });
  if (ans.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM daily_prompt_answers WHERE id = ?').run(answerId);
    db.prepare('UPDATE daily_prompt_instances SET answer_count = MAX(0, answer_count - 1) WHERE id = ?').run(ans.instance_id);
  });
  tx();
  const newCount = db.prepare('SELECT answer_count FROM daily_prompt_instances WHERE id = ?').get(ans.instance_id)?.answer_count ?? 0;
  return { ok: true, id: answerId, instance_id: ans.instance_id, answer_count: newCount };
}

/** Сводка для GET конфига: текущий стрик + сегодняшний инстанс (если есть). */
function getStatus(chatId, userId) {
  const db = getDb();
  assertMember(db, chatId, userId);
  const streak = computeStreak(db, chatId);
  const cfg = getConfigRow(db, chatId);
  let today = null;
  if (cfg) {
    const parts = (() => { try { return partsInTz(cfg.timezone || DEFAULT_TZ); } catch { return null; } })();
    if (parts) {
      const row = db.prepare('SELECT * FROM daily_prompt_instances WHERE chat_id = ? AND date_key = ? ORDER BY created_at DESC LIMIT 1').get([chatId, parts.dateKey]);
      if (row) today = getInstanceWithMeta(db, chatId, row.id);
    }
  }
  return { streak, today };
}

module.exports = {
  // конфиг
  getConfig, updateConfig,
  // свои вопросы
  listCustomQuestions, addCustomQuestion, deleteCustomQuestion,
  // доставка
  deliverDueDailyPrompts, askNow,
  // ответы / архив
  listInstances, getInstanceThread, addAnswer, deleteAnswer,
  // статус
  getStatus, computeStreak,
  // helpers (для тестов)
  partsInTz, prevDateKey, weekdayOf, isScheduledDay, pickNext, buildPool,
};
