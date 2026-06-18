/**
 * 009_chat_bg_updated_at.js — отметка времени смены ОБЩЕГО фона чата.
 *
 * chats.chat_bg_updated_at (ms) проставляется каждый раз, когда кто-то меняет
 * общий фон «для всех». Нужна, чтобы клиент мог отличить «общий фон поменяли
 * ПОСЛЕ того, как я выбрал свой личный» — тогда участнику с личным фоном
 * показывается ненавязчивая плашка «Фон чата обновлён · Применить», вместо того
 * чтобы молча проигнорировать общий фон (личный приоритетнее) или затереть
 * чужой осознанный выбор.
 *
 * Личный фон уже несёт свой updated_at (chat_backgrounds.updated_at), он
 * отдаётся клиенту как my_chat_bg_updated_at — вторая половина сравнения.
 */
function up(db) {
  try {
    db.exec('ALTER TABLE chats ADD COLUMN chat_bg_updated_at INTEGER');
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
}
module.exports = { up };
