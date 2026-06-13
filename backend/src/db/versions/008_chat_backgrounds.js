/**
 * 008_chat_backgrounds.js — индивидуальные фоны чатов.
 *
 * Два уровня (приоритет на клиенте: личный → общий → фон приложения → дефолт):
 *   - chats.chat_bg            — ОБЩИЙ фон чата (JSON ChatBg). Виден всем участникам.
 *                                Ставит: в группе admin/модератор с edit_info; в ЛС любой собеседник.
 *   - chat_backgrounds(...)    — ЛИЧНЫЙ фон (только для этого пользователя в этом чате).
 *
 * ChatBg JSON: {"type":"solid|gradient|image","c1":"#..","c2":"#..","angle":160,"url":"<s3>"}.
 * NULL/отсутствие = нет фона на этом уровне.
 */
function up(db) {
  try {
    db.exec('ALTER TABLE chats ADD COLUMN chat_bg TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_backgrounds (
      user_id    TEXT NOT NULL,
      chat_id    TEXT NOT NULL,
      bg         TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      PRIMARY KEY (user_id, chat_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_backgrounds_user ON chat_backgrounds(user_id);
  `);
}
module.exports = { up };
