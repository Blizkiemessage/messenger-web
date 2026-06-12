'use strict';

/**
 * chatPermissions.js — единый источник правды по правам участника группы.
 *
 * Вынесено в отдельный модуль (без зависимостей от других сервисов), чтобы
 * и chatService, и messageService могли его использовать без циклического require.
 *
 * Роли:
 *   - admin      → все права всегда true (создатель/админ группы).
 *   - moderator  → права из chat_members.permissions (JSON); NULL = DEFAULT_MOD_PERMS.
 *   - member     → все права false.
 *
 * Права:
 *   - edit_info       — менять имя/описание/аватар/фон группы.
 *   - delete_messages — удалять чужие сообщения.
 *   - manage_members  — добавлять/удалять участников.
 */

const PERMISSION_KEYS = ['edit_info', 'delete_messages', 'manage_members'];

// Дефолт для модератора без явно заданных прав — сохраняет историческое
// поведение (модератор мог удалять сообщения и управлять участниками).
const DEFAULT_MOD_PERMS = Object.freeze({
  edit_info: false,
  delete_messages: true,
  manage_members: true,
});

/** Нормализовать произвольный объект прав к разрешённым ключам (boolean). */
function sanitizePermissions(input) {
  const out = {};
  for (const key of PERMISSION_KEYS) out[key] = !!(input && input[key]);
  return out;
}

/**
 * Вернуть эффективные права участника: { role, edit_info, delete_messages, manage_members }
 * или null, если пользователь не состоит в чате.
 * @param {import('better-sqlite3').Database} db
 */
function getMemberPermissions(db, chatId, userId) {
  const m = db
    .prepare('SELECT role, permissions FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, userId]);
  if (!m) return null;

  if (m.role === 'admin') {
    return { role: 'admin', edit_info: true, delete_messages: true, manage_members: true };
  }
  if (m.role === 'moderator') {
    let perms = { ...DEFAULT_MOD_PERMS };
    if (m.permissions) {
      try { perms = { ...DEFAULT_MOD_PERMS, ...sanitizePermissions(JSON.parse(m.permissions)) }; }
      catch { /* битый JSON — оставляем дефолт */ }
    }
    return { role: 'moderator', ...perms };
  }
  return { role: 'member', edit_info: false, delete_messages: false, manage_members: false };
}

/** Права модератора для отдачи на клиент (для UI-переключателей). null для не-модераторов. */
function parseModeratorPermissions(role, permissionsJson) {
  if (role !== 'moderator') return null;
  if (!permissionsJson) return { ...DEFAULT_MOD_PERMS };
  try { return { ...DEFAULT_MOD_PERMS, ...sanitizePermissions(JSON.parse(permissionsJson)) }; }
  catch { return { ...DEFAULT_MOD_PERMS }; }
}

module.exports = {
  PERMISSION_KEYS,
  DEFAULT_MOD_PERMS,
  sanitizePermissions,
  getMemberPermissions,
  parseModeratorPermissions,
};
