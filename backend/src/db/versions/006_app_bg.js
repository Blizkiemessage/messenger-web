/**
 * 006_app_bg.js — пользовательский фон приложения.
 *
 * users.app_bg — JSON-строка вида {"type":"gradient","c1":"#...","c2":"#...","angle":160}
 * (см. web/src/utils/appBackground.ts). NULL = дефолтный фон («аврора»).
 * Сюда же позже ляжет задел под per-chat фоны (отдельная таблица).
 */
function up(db) {
  // ALTER TABLE ... ADD COLUMN не поддерживает IF NOT EXISTS — идемпотентность через try/catch
  try {
    db.exec("ALTER TABLE users ADD COLUMN app_bg TEXT");
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
}
module.exports = { up };
