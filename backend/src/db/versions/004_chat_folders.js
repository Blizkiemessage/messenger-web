function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_folders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT    NOT NULL,
      name       TEXT    NOT NULL,
      emoji      TEXT    NOT NULL DEFAULT '📁',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_folders_user ON chat_folders(user_id);

    CREATE TABLE IF NOT EXISTS folder_chats (
      folder_id INTEGER NOT NULL REFERENCES chat_folders(id) ON DELETE CASCADE,
      chat_id   TEXT    NOT NULL,
      added_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      PRIMARY KEY (folder_id, chat_id)
    );
    CREATE INDEX IF NOT EXISTS idx_folder_chats_folder ON folder_chats(folder_id);
  `);
}
module.exports = { up };
