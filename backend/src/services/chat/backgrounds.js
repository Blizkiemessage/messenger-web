/**
 * services/chat/backgrounds.js — per-chat backgrounds (личный/общий).
 *   setChatBackground (+ internal sanitizeChatBg)
 */
const { getDb } = require('../../config/database');
const { getMemberPermissions } = require('../chatPermissions');

const CHAT_BG_TYPES = new Set(['solid', 'gradient', 'image']);
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);

/** Валидировать/нормализовать ChatBg; бросает 400 на мусоре. */
function sanitizeChatBg(bg) {
  const bad = () => Object.assign(new Error('Некорректный фон чата'), { status: 400 });
  if (!bg || typeof bg !== 'object' || !CHAT_BG_TYPES.has(bg.type)) throw bad();
  const out = { type: bg.type };
  if (bg.type === 'solid') {
    if (!isHex(bg.c1)) throw bad();
    out.c1 = bg.c1;
  } else if (bg.type === 'gradient') {
    if (!isHex(bg.c1) || !isHex(bg.c2)) throw bad();
    out.c1 = bg.c1; out.c2 = bg.c2;
    out.angle = Number.isFinite(bg.angle) ? Math.max(0, Math.min(360, Math.round(bg.angle))) : 160;
  } else { // image
    if (typeof bg.url !== 'string' || !bg.url || bg.url.length > 1000) throw bad();
    out.url = bg.url;
    out.dim = Number.isFinite(bg.dim) ? Math.max(0, Math.min(0.8, bg.dim)) : 0.35;
  }
  return out;
}

/**
 * setChatBackground — задать фон чата.
 *   forEveryone=true  → ОБЩИЙ фон (chats.chat_bg). Группа: нужно право edit_info; ЛС: любой участник.
 *   forEveryone=false → ЛИЧНЫЙ фон (chat_backgrounds) только для requesterId.
 *   bg=null           → снять фон на соответствующем уровне.
 * Только мутация + проверки; полный объект чата собирает роут через getChatById
 * (так сервис остаётся тестируемым без тяжёлых зависимостей getChatById).
 */
function setChatBackground(chatId, requesterId, bg, forEveryone) {
  const db = getDb();
  const chat = db.prepare('SELECT type FROM chats WHERE id = ?').get(chatId);
  if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, requesterId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const bgJson = bg == null ? null : JSON.stringify(sanitizeChatBg(bg));

  if (forEveryone) {
    if (chat.type === 'group') {
      const perms = getMemberPermissions(db, chatId, requesterId);
      if (!perms || !perms.edit_info) {
        throw Object.assign(new Error('Недостаточно прав для смены фона группы'), { status: 403 });
      }
    }
    // ЛС: любой из собеседников может менять общий фон (membership уже проверено).
    // chat_bg_updated_at — момент смены общего фона; по нему клиент решает, показывать
    // ли участнику с личным фоном плашку «Фон чата обновлён».
    db.prepare('UPDATE chats SET chat_bg = ?, chat_bg_updated_at = ? WHERE id = ?')
      .run([bgJson, Date.now(), chatId]);
    // Автор осознанно делает фон общим — снимаем его личный фон, чтобы он сразу
    // увидел результат (личный фон иначе перекрыл бы только что выставленный общий).
    db.prepare('DELETE FROM chat_backgrounds WHERE user_id = ? AND chat_id = ?').run([requesterId, chatId]);
  } else if (bgJson == null) {
    db.prepare('DELETE FROM chat_backgrounds WHERE user_id = ? AND chat_id = ?').run([requesterId, chatId]);
  } else {
    db.prepare(`
      INSERT INTO chat_backgrounds (user_id, chat_id, bg, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, chat_id) DO UPDATE SET bg = excluded.bg, updated_at = excluded.updated_at
    `).run([requesterId, chatId, bgJson, Date.now()]);
  }
}

module.exports = { setChatBackground, sanitizeChatBg };
