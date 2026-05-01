'use strict';

/**
 * migrate.js — versioned migration engine for SQLite (better-sqlite3).
 *
 * ── How it works ────────────────────────────────────────────────────────────
 *   1. Creates `schema_migrations` table on first run.
 *   2. Reads every *.js file in src/db/versions/, sorted lexicographically
 *      (001_initial.js < 002_something.js < …).
 *   3. Parses the leading number as the migration version.
 *   4. Skips versions already recorded in schema_migrations.
 *   5. Runs the exported `up(db)` function inside a single SQLite transaction.
 *   6. Records the version in schema_migrations on success.
 *   7. On failure, rolls back the transaction and re-throws — server won't start.
 *
 * ── Migration file contract ──────────────────────────────────────────────────
 *   Each file in src/db/versions/ must:
 *     - Be named  NNN_description.js  (NNN = zero-padded integer, e.g. 003)
 *     - Export:   module.exports = { up(db) { … } }
 *     - The up() function receives the better-sqlite3 Database instance.
 *     - Use `db.exec()` / `db.prepare()` — NOT async, SQLite is synchronous.
 *
 * ── Idempotency & backward compatibility ────────────────────────────────────
 *   The very first migration (001_initial.js) uses `CREATE TABLE IF NOT EXISTS`
 *   and `ALTER TABLE … IF NOT EXISTS` (via try/catch) for every statement so
 *   it is safe to run against an existing production database — all statements
 *   that already applied will no-op or be silently skipped.
 *
 *   Existing databases that were created before this engine was introduced will
 *   have schema_migrations created on first boot and version 001 will be applied
 *   (all IF NOT EXISTS → no-ops). From that point every new version file is
 *   applied exactly once.
 */

const path = require('path');
const fs   = require('fs');

const VERSIONS_DIR = path.join(__dirname, 'versions');

/**
 * Apply all pending migrations to `db` in version order.
 * Called once at server startup (before any routes are registered).
 *
 * @param {import('better-sqlite3').Database} db
 */
function runMigrations(db) {
  // ── Bootstrap tracking table ─────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  // Build a set of already-applied version numbers for O(1) lookup
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );

  // Read and sort version files (lexicographic order = numeric order when
  // files are zero-padded: 001_, 002_, …, 099_, 100_)
  let files;
  try {
    files = fs.readdirSync(VERSIONS_DIR)
      .filter(f => /^\d+_.+\.js$/.test(f))
      .sort();
  } catch (e) {
    throw new Error(`[migrate] cannot read versions directory: ${e.message}`);
  }

  if (files.length === 0) {
    console.log('[migrate] no version files found — nothing to apply');
    return;
  }

  let newlyApplied = 0;

  for (const file of files) {
    const version = parseInt(file.split('_')[0], 10);

    if (isNaN(version)) {
      console.warn(`[migrate] skipping file with non-numeric prefix: ${file}`);
      continue;
    }

    if (applied.has(version)) continue; // already done

    console.log(`[migrate] applying ${file}…`);

    // Load the migration module
    let migration;
    try {
      migration = require(path.join(VERSIONS_DIR, file));
    } catch (e) {
      throw new Error(`[migrate] failed to load ${file}: ${e.message}`);
    }

    if (typeof migration.up !== 'function') {
      throw new Error(`[migrate] ${file} does not export an up(db) function`);
    }

    // Run inside a transaction — atomically apply schema + record version.
    // If up() throws, the transaction is rolled back and we re-throw so the
    // server fails to start rather than booting with a broken schema.
    const applyMigration = db.transaction(() => {
      migration.up(db);
      db.prepare(
        'INSERT INTO schema_migrations (version, name) VALUES (?, ?)'
      ).run(version, file);
    });

    applyMigration(); // throws on failure → rolls back automatically
    console.log(`[migrate] ✓ v${version} — ${file}`);
    newlyApplied++;
  }

  if (newlyApplied === 0) {
    console.log('[migrate] schema is up to date');
  } else {
    console.log(`[migrate] ${newlyApplied} migration(s) applied successfully`);
  }
}

/**
 * Returns the list of all applied migrations with their timestamps.
 * Used by admin panel / health checks.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ version: number, name: string, applied_at: number }[]}
 */
function getAppliedMigrations(db) {
  try {
    return db.prepare(
      'SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC'
    ).all();
  } catch {
    return []; // table doesn't exist yet (before first runMigrations call)
  }
}

module.exports = { runMigrations, getAppliedMigrations };
