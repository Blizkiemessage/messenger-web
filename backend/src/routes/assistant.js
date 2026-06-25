/**
 * routes/assistant.js — ассистенты Blizkie.
 *
 * Этап C — помощник по приложению («как сделать X»):
 *   GET  /assistant/status — доступен ли LLM-слой (фронт не дёргает /ask впустую)
 *   POST /assistant/ask    — { question, kb:[{id,question,answer,actions}] }
 *                            → { reply, covered, relatedIds }
 *
 * Этап D — ассистент по данным чатов («второй мозг», строго opt-in + платно):
 *   GET  /assistant/data/status   — доступность + текущие настройки приватности
 *   PUT  /assistant/data/settings — { optin, readMessages, scopeAll, allowChats }
 *   POST /assistant/data/ask      — { question } → { reply, covered, sources, mode }
 *
 * LLM генерирует ответ СТРОГО по данным (FAQ — на фронте; переписка — в БД,
 * дешифруется в памяти). Источники-пруфы обязательны → ноль галлюцинаций.
 */
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { assistantLimiter, dataAssistantLimiter } = require('../middleware/rateLimits');
const { answerQuestion, isEnabled } = require('../services/assistantService');
const dataAssistant = require('../services/dataAssistantService');

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

// ── Этап D: ассистент по данным ──────────────────────────────────────────────

router.get('/data/status', authMiddleware, (req, res, next) => {
  try {
    res.json(dataAssistant.getStatus(req.userId));
  } catch (err) { next(err); }
});

router.put('/data/settings', authMiddleware, (req, res, next) => {
  try {
    const { optin, readMessages, scopeAll, allowChats } = req.body || {};
    const patch = {};
    if (optin        !== undefined) patch.optin = !!optin;
    if (readMessages !== undefined) patch.readMessages = !!readMessages;
    if (scopeAll     !== undefined) patch.scopeAll = !!scopeAll;
    if (allowChats   !== undefined) {
      if (!Array.isArray(allowChats)) return res.status(400).json({ error: 'allowChats must be an array' });
      patch.allowChats = allowChats;
    }
    res.json(dataAssistant.updateSettings(req.userId, patch));
  } catch (err) { next(err); }
});

router.post('/data/ask', authMiddleware, dataAssistantLimiter, async (req, res, next) => {
  try {
    const { question } = req.body || {};
    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Missing question' });
    }
    const result = await dataAssistant.answerDataQuestion(req.userId, question);
    res.json(result);
  } catch (err) {
    if (err.status === 503) {
      return res.status(503).json({ error: err.message, reply: '', covered: false, sources: [], mode: 'none' });
    }
    if (err.status === 403) {
      return res.status(403).json({ error: err.message, code: err.code || 'forbidden', reply: '', covered: false, sources: [], mode: 'none' });
    }
    next(err);
  }
});

module.exports = router;
