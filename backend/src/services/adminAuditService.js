const { getDb } = require('../config/database');

/**
 * Write one record to admin_audit_log.
 * Never throws — a logging failure must not abort the admin action.
 *
 * @param {object} opts
 * @param {string}      opts.adminUserId
 * @param {string}      opts.action        e.g. 'delete_user', 'delete_chat'
 * @param {string|null} opts.targetType    e.g. 'user', 'chat', 'sticker_pack'
 * @param {string|null} opts.targetId      PK of the affected row
 * @param {object|null} opts.targetMeta    any extra context (serialized to JSON)
 * @param {string|null} opts.ipAddress
 * @param {string|null} opts.userAgent
 */
function logAdminAction({ adminUserId, action, targetType = null, targetId = null, targetMeta = null, ipAddress = null, userAgent = null }) {
  try {
    getDb()
      .prepare(`
        INSERT INTO admin_audit_log
          (admin_user_id, action, target_type, target_id, target_meta, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run([
        adminUserId,
        action,
        targetType,
        targetId,
        targetMeta != null ? JSON.stringify(targetMeta) : null,
        ipAddress,
        userAgent,
        Date.now(),
      ]);
  } catch (e) {
    console.error('[Audit] Failed to log admin action:', e.message);
  }
}

module.exports = { logAdminAction };
