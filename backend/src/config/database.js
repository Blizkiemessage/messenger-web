const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

// Prepared statements cache for performance
const statements = {};

function initStatements(db) {
  statements.getChatMembers = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?');
  statements.checkMembership = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?');
  statements.getUserById = db.prepare('SELECT id FROM users WHERE id = ?');
}

function getChatMemberIds(chatId) {
  if (!statements.getChatMembers) {
    initStatements(getDb());
  }
  return statements.getChatMembers.pluck().all(chatId);
}

function checkMembership(chatId, userId) {
  if (!statements.checkMembership) {
    initStatements(getDb());
  }
  return statements.checkMembership.get([chatId, userId]);
}

// In production (Railway) set DB_PATH env var to the volume mount path, e.g. /data/blizkie.db
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data', 'blizkie.db');
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const LOCK_PATH = DB_PATH + '.lock';

// node-sqlite3-wasm uses a .lock directory — clean up stale lock from a previous crash
if (fs.existsSync(LOCK_PATH)) {
  fs.rmSync(LOCK_PATH, { recursive: true, force: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA journal_mode = WAL;'); // Better concurrency
    db.exec('PRAGMA synchronous = NORMAL;'); // Speed up writes
    initStatements(db);
  }
  return db;
}

module.exports = { getDb, statements, getChatMemberIds, checkMembership };
