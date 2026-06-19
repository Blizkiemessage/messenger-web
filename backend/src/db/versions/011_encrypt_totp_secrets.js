/**
 * 011_encrypt_totp_secrets.js — шифрование TOTP-секретов at-rest (аудит #3).
 *
 * До этого users.totp_secret / totp_pending_secret хранились открытым base32:
 * доступ к .db/бэкапу = возможность генерировать валидные 2FA-коды любого юзера.
 * Теперь секреты шифруются (AES-256-GCM, тот же ключ, что и сообщения) ещё до
 * записи — см. utils/totp.encryptSecret. Эта миграция дошифровывает уже
 * существующие открытые секреты у тех, кто включил 2FA до изменения.
 *
 * Идемпотентна: значения с маркером enc:v1: пропускаются. На свежей БД
 * (2FA ни у кого) — no-op.
 */
const { encryptSecret, isEncryptedSecret } = require('../../utils/totp');

function up(db) {
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT id, totp_secret, totp_pending_secret FROM users
       WHERE totp_secret IS NOT NULL OR totp_pending_secret IS NOT NULL`
    ).all();
  } catch { rows = []; } // колонок ещё нет — нечего шифровать

  const upd = db.prepare(
    'UPDATE users SET totp_secret = ?, totp_pending_secret = ? WHERE id = ?'
  );

  const migrate = db.transaction(() => {
    for (const r of rows) {
      const secret = (r.totp_secret && !isEncryptedSecret(r.totp_secret))
        ? encryptSecret(r.totp_secret) : r.totp_secret;
      const pending = (r.totp_pending_secret && !isEncryptedSecret(r.totp_pending_secret))
        ? encryptSecret(r.totp_pending_secret) : r.totp_pending_secret;
      if (secret !== r.totp_secret || pending !== r.totp_pending_secret) {
        upd.run(secret, pending, r.id);
      }
    }
  });
  migrate();
}

module.exports = { up };
