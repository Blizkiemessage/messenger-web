'use strict';

/**
 * 022_welcome_guide_card.js — конвертирует старые (литеральные RU, is_system=0)
 * приветственные сообщения «Избранного» в новую карточку welcome_guide
 * (is_system=1 + attachment_type/attachment_meta) — рендерится компонентом
 * WelcomeGuideCard и переводится на текущий язык UI, а не остаётся навсегда
 * замороженным русским текстом в ciphertext.
 *
 * Новые saved-чаты уже сеются в новом формате (services/chat/create.js).
 * Эта миграция — одноразовый бэкфилл для юзеров, у которых Избранное было
 * создано ДО этой правки. Строки ниже — замороженный снимок оригинального
 * seedSavedWelcome (сознательно НЕ импортируются из create.js — нужен именно
 * старый текст для точного сопоставления, даже если create.js изменится позже).
 *
 * Сопоставление строгое (точный текст после дешифровки) — на сообщение,
 * которое пользователь мог отредактировать/удалить/дополнить, миграция не
 * посягает: ложных срабатываний не будет, а если совпадений 0 — чат просто
 * не трогается (значит все 3 уже удалены или это чат, созданный уже в новом
 * формате). Из нескольких совпавших строк в одном чате оставляем самую
 * раннюю как единственную карточку, остальные — просто удаляем (это
 * посевной, а не авторский контент).
 */
const { decrypt } = require('../../crypto/aes');

const LEGACY_SAVED_WELCOME = [
  '👋 Это ваше «Избранное» — личное пространство только для вас: сохраняйте заметки, ссылки, файлы и идеи.',
  'С чего начать в Blizkie:\n- [Пригласить близких](blz:invite)\n- [Найти друзей](blz:find-friends)\n- [Создать группу](blz:create-group)\n- [Настроить внешний вид](blz:appearance)',
  '🌙 В любом чате можно включить «Вопрос дня», поменять фон, отправлять голосовые, видео-кружки и отложенные сообщения. Приятного общения! 💜',
];

function up(db) {
  const rows = db.prepare(
    `SELECT m.id, m.chat_id, m.ciphertext, m.iv, m.auth_tag
     FROM messages m
     JOIN chats c ON c.id = m.chat_id
     WHERE c.type = 'saved' AND c.creator_id = m.sender_id AND m.is_system = 0
     ORDER BY m.chat_id ASC, m.created_at ASC`
  ).all();
  if (rows.length === 0) return;

  const matchedByChat = new Map();
  for (const row of rows) {
    let text;
    try { text = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }); }
    catch { continue; }
    if (!LEGACY_SAVED_WELCOME.includes(text)) continue;
    if (!matchedByChat.has(row.chat_id)) matchedByChat.set(row.chat_id, []);
    matchedByChat.get(row.chat_id).push(row.id);
  }
  if (matchedByChat.size === 0) return;

  const meta = JSON.stringify({ kind: 'welcome_guide' });
  const toCard = db.prepare(
    `UPDATE messages SET is_system = 1, attachment_type = 'welcome_guide', attachment_meta = ? WHERE id = ?`
  );
  const del = db.prepare('DELETE FROM messages WHERE id = ?');

  const run = db.transaction(() => {
    for (const ids of matchedByChat.values()) {
      const [keepId, ...dropIds] = ids;
      toCard.run(meta, keepId);
      for (const id of dropIds) del.run(id);
    }
  });
  run();
}

module.exports = { up };
