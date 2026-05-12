'use strict';

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id          TEXT    PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        public_key  BLOB    NOT NULL,
        counter     INTEGER NOT NULL DEFAULT 0,
        device_name TEXT,
        created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user
        ON webauthn_credentials(user_id);

      CREATE TABLE IF NOT EXISTS webauthn_challenges (
        challenge  TEXT    PRIMARY KEY,
        user_id    INTEGER,
        type       TEXT    NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  },
};
