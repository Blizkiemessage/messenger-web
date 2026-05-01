'use strict';

/**
 * migrations.js — backward-compatible shim.
 *
 * All callers (src/index.js, scripts/create-admin.js, tests) do:
 *   const { runMigrations } = require('./db/migrations')
 *
 * This file forwards that call to the versioned migration engine in migrate.js.
 * Do NOT add schema changes here — create a new file in src/db/versions/ instead.
 */

const { runMigrations, getAppliedMigrations } = require('./migrate');

module.exports = { runMigrations, getAppliedMigrations };
