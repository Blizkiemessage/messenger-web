'use strict';

/**
 * 020_terms_acceptance.js — records when a user accepted the Terms of
 * Service / Privacy Policy (§1 of docs/STORE_LAUNCH_TZ.md — store submission
 * requires a consent checkbox at registration, not just a link in a footer).
 * Nullable: legacy accounts created before this migration have no record and
 * are not retroactively required to re-accept.
 */
function up(db) {
  try {
    db.exec('ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER');
  } catch { /* column already exists — idempotent */ }
}

module.exports = { up };
