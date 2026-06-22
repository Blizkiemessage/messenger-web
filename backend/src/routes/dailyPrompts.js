/**
 * routes/dailyPrompts.js — фича «Вопрос дня» (монтируется под /chats).
 *
 * Конфиг и управление:
 *   GET    /chats/:chatId/daily-prompt                       — конфиг + банки + свои вопросы + статус (стрик/сегодня) + canManage
 *   PUT    /chats/:chatId/daily-prompt                       — обновить конфиг (право edit_info; в ЛС оба)
 *   POST   /chats/:chatId/daily-prompt/questions             — добавить свой вопрос
 *   DELETE /chats/:chatId/daily-prompt/questions/:questionId — удалить свой вопрос
 *   POST   /chats/:chatId/daily-prompt/ask-now              — задать вопрос сейчас (ручной запуск)
 *
 * Архив и ответы (любой участник):
 *   GET    /chats/:chatId/daily-prompt/instances                       — архив (пагинация)
 *   GET    /chats/:chatId/daily-prompt/instances/:instanceId          — тред: вопрос + ответы
 *   POST   /chats/:chatId/daily-prompt/instances/:instanceId/answers  — ответить (текст/гс/кружок/медиа)
 *   DELETE /chats/:chatId/daily-prompt/answers/:answerId              — удалить свой ответ
 */

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const { getDb }   = require('../config/database');
const { signUrl } = require('../utils/s3Sign');
const { getMemberPermissions } = require('../services/chatPermissions');
const { parsePagination } = require('../utils/pagination');
const dp = require('../services/dailyPromptService');
const { listBanks } = require('../services/dailyPromptBank');

const router = express.Router();
router.use(authMiddleware);

const writeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  message: { error: 'Too many requests' },
  standardHeaders: true, legacyHeaders: false,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Может ли пользователь управлять фичей в этом чате (для UI-флага). */
function canManage(chatId, userId) {
  const db = getDb();
  const chat = db.prepare('SELECT type FROM chats WHERE id = ?').get(chatId);
  if (!chat) return false;
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) return false;
  if (chat.type === 'direct') return true;
  const perms = getMemberPermissions(db, chatId, userId);
  return !!(perms && perms.edit_info);
}

/** Подписать attachment_url у массива ответов (для безопасной отдачи на клиент). */
async function signAnswers(answers) {
  await Promise.all(answers.map(async (a) => {
    if (a.attachment_url) { try { a.attachment_url = await signUrl(a.attachment_url); } catch { /* keep raw */ } }
  }));
  return answers;
}

/** Разослать событие всем участникам чата. */
function broadcast(req, members, event, payload) {
  const io = req.app.get('io');
  if (!io) return;
  for (const m of members) io.to(`user:${m.user_id}`).emit(event, payload);
}

// ── Конфиг ─────────────────────────────────────────────────────────────────────

router.get('/:chatId/daily-prompt', (req, res, next) => {
  try {
    const { chatId } = req.params;
    const config = dp.getConfig(chatId);
    const status = dp.getStatus(chatId, req.userId); // также проверяет членство
    res.json({
      config,
      banks: listBanks(),
      questions: dp.listCustomQuestions(chatId, req.userId),
      streak: status.streak,
      today: status.today,
      canManage: canManage(chatId, req.userId),
    });
  } catch (err) { next(err); }
});

router.put('/:chatId/daily-prompt', writeLimiter, (req, res, next) => {
  try {
    const config = dp.updateConfig(req.params.chatId, req.userId, req.body || {});
    res.json({ config });
  } catch (err) { next(err); }
});

// ── Свои вопросы ────────────────────────────────────────────────────────────────

router.post('/:chatId/daily-prompt/questions', writeLimiter, (req, res, next) => {
  try {
    const q = dp.addCustomQuestion(req.params.chatId, req.userId, req.body?.text);
    res.status(201).json(q);
  } catch (err) { next(err); }
});

router.delete('/:chatId/daily-prompt/questions/:questionId', (req, res, next) => {
  try {
    res.json(dp.deleteCustomQuestion(req.params.chatId, req.userId, req.params.questionId));
  } catch (err) { next(err); }
});

// ── Ручной запуск ────────────────────────────────────────────────────────────────

router.post('/:chatId/daily-prompt/ask-now', writeLimiter, async (req, res, next) => {
  try {
    const { message, members, push } = dp.askNow(req.params.chatId, req.userId);
    broadcast(req, members, 'new-message', message);
    if (push?.enabled) {
      try {
        const { fireAndForgetPush } = require('../services/pushService');
        fireAndForgetPush(req.params.chatId, message.sender_id, {
          text: push.text, attachment_type: 'daily_prompt', attachment_meta: message.attachment_meta,
        }, req.app.get('io'));
      } catch { /* ignore */ }
    }
    res.status(201).json({ message });
  } catch (err) { next(err); }
});

// ── Архив ──────────────────────────────────────────────────────────────────────

router.get('/:chatId/daily-prompt/instances', (req, res, next) => {
  try {
    const { limit, before } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
    res.json(dp.listInstances(req.params.chatId, req.userId, { limit, before }));
  } catch (err) { next(err); }
});

router.get('/:chatId/daily-prompt/instances/:instanceId', async (req, res, next) => {
  try {
    const thread = dp.getInstanceThread(req.params.chatId, req.userId, req.params.instanceId);
    await signAnswers(thread.answers);
    res.json(thread);
  } catch (err) { next(err); }
});

// ── Ответы ──────────────────────────────────────────────────────────────────────

router.post('/:chatId/daily-prompt/instances/:instanceId/answers', writeLimiter, async (req, res, next) => {
  try {
    const { text, attachment_url, attachment_type, attachment_name, attachment_meta,
            attachment_duration, attachment_size, voice_waveform } = req.body || {};

    const safeWaveform = (() => {
      if (attachment_type !== 'audio' || typeof voice_waveform !== 'string') return null;
      try {
        const arr = JSON.parse(voice_waveform);
        return (Array.isArray(arr) && arr.length > 0 && arr.length <= 50) ? voice_waveform : null;
      } catch { return null; }
    })();

    const attachment = (attachment_url && attachment_type) ? {
      attachment_url, attachment_type, attachment_name,
      attachment_meta: typeof attachment_meta === 'string' ? attachment_meta : null,
      attachment_size: typeof attachment_size === 'number' && attachment_size > 0 ? attachment_size : null,
      attachment_duration: typeof attachment_duration === 'number' && attachment_duration > 0 ? attachment_duration : null,
      voice_waveform: safeWaveform,
    } : {};

    const result = dp.addAnswer(req.params.chatId, req.userId, req.params.instanceId, { text, attachment });

    // Подписать вложение перед отдачей/broadcast'ом
    if (result.answer.attachment_url) {
      try { result.answer.attachment_url = await signUrl(result.answer.attachment_url); } catch { /* keep raw */ }
    }

    broadcast(req, result.members, 'daily-prompt-answer', {
      chat_id: req.params.chatId,
      instance_id: result.instance_id,
      answer: result.answer,
      answer_count: result.answer_count,
      streak: result.streak,
    });

    res.status(201).json({ answer: result.answer, answer_count: result.answer_count, streak: result.streak });
  } catch (err) { next(err); }
});

router.delete('/:chatId/daily-prompt/answers/:answerId', (req, res, next) => {
  try {
    const result = dp.deleteAnswer(req.params.chatId, req.userId, req.params.answerId);
    const db = getDb();
    const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(req.params.chatId);
    broadcast(req, members, 'daily-prompt-answer-deleted', {
      chat_id: req.params.chatId,
      instance_id: result.instance_id,
      answer_id: result.id,
      answer_count: result.answer_count,
    });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
