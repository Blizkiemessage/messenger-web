/**
 * One-time script: wipes all users, sessions, OTPs, chats and messages.
 * Run once: node reset-users.js
 */
require('dotenv').config();
const { getDb } = require('./src/config/database');
const { runMigrations } = require('./src/db/migrations');

runMigrations();
const db = getDb();

db.exec(`
  DELETE FROM messages;
  DELETE FROM chat_members;
  DELETE FROM chats;
  DELETE FROM sessions;
  DELETE FROM otps;
  DELETE FROM users;
`);

console.log('All users and chat data cleared.');
process.exit(0);
