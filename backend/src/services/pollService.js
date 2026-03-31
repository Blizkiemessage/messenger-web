const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');

/**
 * Aggregate votes for a poll and return a structured payload for the frontend.
 * For anonymous polls, voters arrays are null.
 */
function buildPollPayload(pollRow, viewerId) {
  const db = getDb();
  const options = JSON.parse(pollRow.options); // [{id, text}]
  const votes = db.prepare('SELECT user_id, option_id FROM poll_votes WHERE poll_id = ?').all(pollRow.id);

  const countMap = {}; // optionId → count
  const voterMap = {}; // optionId → [userId, ...]
  for (const opt of options) { countMap[opt.id] = 0; voterMap[opt.id] = []; }
  for (const v of votes) {
    if (countMap[v.option_id] !== undefined) {
      countMap[v.option_id]++;
      voterMap[v.option_id].push(v.user_id);
    }
  }

  const totalVotes = votes.length;
  const myVotes = votes.filter(v => v.user_id === viewerId).map(v => v.option_id);
  const hasVoted = myVotes.length > 0;

  const mappedOptions = options.map(opt => {
    const count = countMap[opt.id] || 0;
    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    let voters = null;
    if (!pollRow.is_anonymous && hasVoted) {
      // Resolve user IDs → usernames for public polls (only shown after voting)
      const userIds = voterMap[opt.id];
      if (userIds.length > 0) {
        const placeholders = userIds.map(() => '?').join(',');
        const users = db.prepare(`SELECT id, username, display_name FROM users WHERE id IN (${placeholders})`).all(userIds);
        voters = users.map(u => u.username || u.display_name || u.id);
      } else {
        voters = [];
      }
    }
    return { id: opt.id, text: opt.text, vote_count: count, percentage: pct, voters };
  });

  return {
    id: pollRow.id,
    question: pollRow.question,
    options: mappedOptions,
    allow_multiple: pollRow.allow_multiple === 1,
    is_anonymous: pollRow.is_anonymous === 1,
    is_quiz: pollRow.is_quiz === 1,
    correct_option_id: pollRow.correct_option_id || null,
    closed_at: pollRow.closed_at || null,
    total_votes: totalVotes,
    my_votes: myVotes,
  };
}

function createPoll(chatId, creatorId, { question, options, allow_multiple, is_anonymous, is_quiz, correct_option_id }) {
  const db = getDb();

  // Validate membership
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, creatorId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  // Validate options count
  if (!Array.isArray(options) || options.length < 2 || options.length > 10)
    throw Object.assign(new Error('Options must be between 2 and 10'), { status: 400 });
  if (!question || !question.trim())
    throw Object.assign(new Error('Question is required'), { status: 400 });

  // Normalize options (ensure each has an id)
  const normalizedOptions = options.map(o => ({ id: o.id || uuidv4(), text: o.text.trim() }));
  if (normalizedOptions.some(o => !o.text))
    throw Object.assign(new Error('All options must have text'), { status: 400 });

  const pollId = uuidv4();
  const now = Date.now();

  // Create a message for the poll
  const { saveMessage } = require('./messageService');
  const msg = saveMessage(chatId, creatorId, '', {}, false, null, pollId);

  db.prepare(
    `INSERT INTO polls (id, message_id, chat_id, creator_id, question, options,
       allow_multiple, is_anonymous, is_quiz, correct_option_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run([
    pollId, msg.id, chatId, creatorId,
    question.trim(),
    JSON.stringify(normalizedOptions),
    allow_multiple ? 1 : 0,
    is_anonymous !== false ? 1 : 0,
    is_quiz ? 1 : 0,
    (is_quiz && correct_option_id) ? correct_option_id : null,
    now,
  ]);

  const pollRow = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  const poll = buildPollPayload(pollRow, creatorId);

  return { poll, message: { ...msg, poll } };
}

function votePoll(pollId, userId, optionIds) {
  const db = getDb();
  const pollRow = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!pollRow) throw Object.assign(new Error('Poll not found'), { status: 404 });
  if (pollRow.closed_at) throw Object.assign(new Error('Poll is closed'), { status: 400 });

  // Validate membership
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([pollRow.chat_id, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const validOptions = JSON.parse(pollRow.options).map(o => o.id);
  if (!optionIds.every(id => validOptions.includes(id)))
    throw Object.assign(new Error('Invalid option'), { status: 400 });
  if (!pollRow.allow_multiple && optionIds.length !== 1)
    throw Object.assign(new Error('Only one option allowed'), { status: 400 });

  const now = Date.now();
  if (!pollRow.allow_multiple) {
    // Single choice: replace existing vote
    db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run([pollId, userId]);
    db.prepare('INSERT INTO poll_votes (poll_id, user_id, option_id, created_at) VALUES (?, ?, ?, ?)').run([pollId, userId, optionIds[0], now]);
  } else {
    // Multiple choice: toggle each option
    for (const optId of optionIds) {
      const existing = db.prepare('SELECT 1 FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_id = ?').get([pollId, userId, optId]);
      if (existing) {
        db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_id = ?').run([pollId, userId, optId]);
      } else {
        db.prepare('INSERT INTO poll_votes (poll_id, user_id, option_id, created_at) VALUES (?, ?, ?, ?)').run([pollId, userId, optId, now]);
      }
    }
  }

  return buildPollPayload(db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId), userId);
}

function retractVote(pollId, userId) {
  const db = getDb();
  const pollRow = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!pollRow) throw Object.assign(new Error('Poll not found'), { status: 404 });

  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([pollRow.chat_id, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run([pollId, userId]);
  return buildPollPayload(pollRow, userId);
}

function getPollVoters(pollId, optionId, requesterId) {
  const db = getDb();
  const pollRow = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!pollRow) throw Object.assign(new Error('Poll not found'), { status: 404 });
  if (pollRow.is_anonymous) throw Object.assign(new Error('Anonymous poll'), { status: 403 });

  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([pollRow.chat_id, requesterId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const votes = db.prepare('SELECT user_id FROM poll_votes WHERE poll_id = ? AND option_id = ?').all([pollId, optionId]);
  if (votes.length === 0) return [];

  const ids = votes.map(v => v.user_id);
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT id, username, display_name, avatar_url FROM users WHERE id IN (${placeholders})`).all(ids);
}

module.exports = { buildPollPayload, createPoll, votePoll, retractVote, getPollVoters };
