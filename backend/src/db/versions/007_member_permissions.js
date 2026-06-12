/**
 * 007_member_permissions.js — гранулярные права модераторов группы.
 *
 * chat_members.permissions — JSON вида {"edit_info":true,"delete_messages":true,"manage_members":false}
 * Значим только для role='moderator'. NULL = дефолтные права модератора
 * (см. services/chatPermissions.js: DEFAULT_MOD_PERMS — сохраняет прежнее
 * поведение, когда модератор всегда мог удалять сообщения и участников).
 * Для admin права всегда полные, для member — пустые (вычисляется в рантайме).
 */
function up(db) {
  try {
    db.exec('ALTER TABLE chat_members ADD COLUMN permissions TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
}
module.exports = { up };
