'use strict';

/**
 * migrations.js — backward-compatible shim.
 *
 * All callers (src/index.js, scripts/create-admin.js, tests) do:
 *   const { runMigrations } = require('./db/migrations')
 *   runMigrations()   ← no arguments (old API)
 *
 * This shim preserves that API: if called without a db argument it fetches
 * the singleton via getDb() and forwards it to the versioned engine.
 */

const { runMigrations: _run, getAppliedMigrations } = require('./migrate');
const { getDb } = require('../config/database');

function runMigrations(db) {
  return _run(db || getDb());
}

module.exports = { runMigrations, getAppliedMigrations };
