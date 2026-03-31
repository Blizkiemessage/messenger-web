const express = require('express');
const router = express.Router();
const { authMiddleware: requireAuth } = require('../middleware/auth');
const { createPoll, votePoll, retractVote, getPollVoters } = require('../services/pollService');
const { getDb } = require('../config/database');

function getIo(req) { return req.app.get('io'); }

// POST /polls — create a poll (must be a group chat member)
router.post('/', requireAuth, (req, res) => {
  try {
    const { chat_id, question, options, allow_multiple, is_anonymous, is_quiz, correct_option_id } = req.body;
    if (!chat_id) return res.status(400).json({ error: 'chat_id required' });

    const result = createPoll(chat_id, req.user.id, { question, options, allow_multiple, is_anonymous, is_quiz, correct_option_id });

    // Emit new message to all chat members
    getIo(req).to(`chat:${chat_id}`).emit('new-message', result.message);

    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /polls/:pollId/vote
router.post('/:pollId/vote', requireAuth, (req, res) => {
  try {
    const { option_ids } = req.body;
    if (!Array.isArray(option_ids) || option_ids.length === 0)
      return res.status(400).json({ error: 'option_ids required' });

    const poll = votePoll(req.params.pollId, req.user.id, option_ids);

    // Get message_id so we can emit poll-updated with correct message reference
    const db = getDb();
    const pollRow = db.prepare('SELECT message_id FROM polls WHERE id = ?').get(req.params.pollId);
    if (pollRow) {
      getIo(req).to(`chat:${poll.id.split('-')[0]}`); // fallback — use chatId below
    }

    // Emit poll-updated to chat room
    const chatPollRow = db.prepare('SELECT message_id, chat_id FROM polls WHERE id = ?').get(req.params.pollId);
    if (chatPollRow) {
      getIo(req).to(`chat:${chatPollRow.chat_id}`).emit('poll-updated', {
        messageId: chatPollRow.message_id,
        poll,
      });
    }

    res.json({ poll });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /polls/:pollId/vote — retract vote
router.delete('/:pollId/vote', requireAuth, (req, res) => {
  try {
    const poll = retractVote(req.params.pollId, req.user.id);

    const db = getDb();
    const chatPollRow = db.prepare('SELECT message_id, chat_id FROM polls WHERE id = ?').get(req.params.pollId);
    if (chatPollRow) {
      getIo(req).to(`chat:${chatPollRow.chat_id}`).emit('poll-updated', {
        messageId: chatPollRow.message_id,
        poll,
      });
    }

    res.json({ poll });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /polls/:pollId/voters/:optId — public polls only
router.get('/:pollId/voters/:optId', requireAuth, (req, res) => {
  try {
    const voters = getPollVoters(req.params.pollId, req.params.optId, req.user.id);
    res.json({ voters });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
