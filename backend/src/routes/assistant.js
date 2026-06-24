/**
 * routes/assistant.js — ассистент-помощник (Этап C, v2).
 *   GET  /assistant/status — доступен ли LLM-слой (для фронта, чтобы не дёргать /ask впустую)
 *   POST /assistant/ask    — { question, intents:[{id,question}] } → { intentId|null }
 *
 * LLM только МАРШРУТИЗИРУЕТ к существующему интенту из присланного каталога.
 * База знаний живёт на фронте (assistant/faq.ts) — единый источник; сюда
 * приходит компактный каталог (id+вопрос). Свободные ответы не генерируются.
 */
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { assistantLimiter } = require('../middleware/rateLimits');
const { routeQuestion, isEnabled } = require('../services/assistantService');

const router = express.Router();

router.get('/status', authMiddleware, (_req, res) => {
  res.json({ aiEnabled: isEnabled() });
});

router.post('/ask', authMiddleware, assistantLimiter, async (req, res, next) => {
  try {
    const { question, intents } = req.body || {};
    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Missing question' });
    }
    if (!Array.isArray(intents) || intents.length === 0) {
      return res.status(400).json({ error: 'Missing intents' });
    }
    const result = await routeQuestion(question, intents);
    res.json(result);
  } catch (err) {
    if (err.status === 503) {
      return res.status(503).json({ error: err.message, intentId: null });
    }
    next(err);
  }
});

module.exports = router;
