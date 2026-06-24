/**
 * routes/assistant.js — ассистент-помощник (Этап C).
 *   GET  /assistant/status — доступен ли LLM-слой (фронт не дёргает /ask впустую)
 *   POST /assistant/ask    — { question, kb:[{id,question,answer,actions}] }
 *                            → { reply, covered, relatedIds }
 *
 * LLM генерирует ответ СТРОГО по присланной базе знаний (FAQ живёт на фронте —
 * единый источник). Кнопки-навигации фронт берёт сам по relatedIds → deep-links
 * всегда валидны.
 */
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { assistantLimiter } = require('../middleware/rateLimits');
const { answerQuestion, isEnabled } = require('../services/assistantService');

const router = express.Router();

router.get('/status', authMiddleware, (_req, res) => {
  res.json({ aiEnabled: isEnabled() });
});

router.post('/ask', authMiddleware, assistantLimiter, async (req, res, next) => {
  try {
    const { question, kb } = req.body || {};
    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Missing question' });
    }
    if (!Array.isArray(kb) || kb.length === 0) {
      return res.status(400).json({ error: 'Missing kb' });
    }
    const result = await answerQuestion(question, kb);
    res.json(result);
  } catch (err) {
    if (err.status === 503) {
      return res.status(503).json({ error: err.message, reply: '', covered: false, relatedIds: [] });
    }
    next(err);
  }
});

module.exports = router;
