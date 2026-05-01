'use strict';

/**
 * 003_voice_waveform.js
 *
 * Adds voice_waveform column to messages.
 * Stores a JSON array of 50 integers (0–100) representing normalised
 * amplitude bars sampled during recording.  NULL for non-voice messages.
 */
function up(db) {
  db.exec(`ALTER TABLE messages ADD COLUMN voice_waveform TEXT`);
}

module.exports = { up };
