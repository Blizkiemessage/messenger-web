const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// In production (Railway/Amvera) set DB_PATH env var to the volume mount path, e.g. /data/blizkie.db
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data', 'blizkie.db');
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db;

/**
 * Wrap better-sqlite3 statements so they accept array params the same way
 * node-sqlite3-wasm did: stmt.run([a, b]) == stmt.run(a, b).
 * This avoids touching 200+ call sites across the codebase.
 */
function patchPrepare(db) {
  const _prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = _prepare(sql);
    for (const method of ['run', 'get', 'all']) {
      const orig = stmt[method].bind(stmt);
      stmt[method] = (...args) =>
        args.length === 1 && Array.isArray(args[0])
          ? orig(...args[0])
          : orig(...args);
    }
    return stmt;
  };
  return db;
}

function getDb() {
  if (!db) {
    try {
      db = patchPrepare(new Database(DB_PATH));
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous  = NORMAL;
        PRAGMA cache_size   = -65536;
        PRAGMA temp_store   = MEMORY;
        PRAGMA mmap_size    = 134217728;
        PRAGMA busy_timeout = 5000;
        PRAGMA foreign_keys = ON;
      `);
      // Force a WAL checkpoint on first open to recover from any unclean shutdown
      try { db.exec('PRAGMA wal_checkpoint(PASSIVE);'); } catch { /* non-fatal */ }
    } catch (err) {
      // "file is not a database" typically means a corrupt WAL/SHM from a SIGKILL.
      // Delete the sidecar files and retry once — SQLite will rebuild them from scratch.
      if (err.message && err.message.includes('not a database')) {
        console.warn('[DB] Corrupt WAL/SHM detected — removing sidecar files and retrying:', err.message);
        for (const ext of ['-wal', '-shm']) {
          try { require('fs').unlinkSync(DB_PATH + ext); } catch { /* may not exist */ }
        }
        db = patchPrepare(new Database(DB_PATH));
        db.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous  = NORMAL;
          PRAGMA cache_size   = -65536;
          PRAGMA temp_store   = MEMORY;
          PRAGMA mmap_size    = 134217728;
          PRAGMA busy_timeout = 5000;
          PRAGMA foreign_keys = ON;
        `);
        console.warn('[DB] Recovered after removing corrupt sidecar files.');
      } else {
        throw err;
      }
    }
  }
  return db;
}

module.exports = { getDb };
