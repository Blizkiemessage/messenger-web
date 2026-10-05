'use strict';

/**
 * llmClient.js — one OpenAI-compatible chat-completions call shared by all AI
 * features (chat summary, help assistant, data assistant).
 *
 * Two problems it absorbs, both seen in production:
 *
 * 1. Providers retire or restrict models. In 2026-09 Groq moved
 *    `llama-3.3-70b-versatile` to enterprise-only, and every AI feature failed
 *    with `404 model_not_found` until the env var was changed by hand. Now a
 *    `model_not_found` answer is retried once on a known-good fallback model
 *    (`AI_FALLBACK_MODEL`, or `openai/gpt-oss-120b` on Groq) and logged as a
 *    warning, so the admin error log still shows that the config is stale.
 *
 * 2. Reasoning models (gpt-oss, qwen3, deepseek-r1…) spend completion tokens on
 *    hidden reasoning. With the old `max_tokens` budgets (250–900) the visible
 *    answer could come back empty or cut off. For these models we ask for low
 *    reasoning effort, drop the reasoning from the response, and add headroom
 *    to the token budget.
 *
 * Errors keep the historical format `AI provider error <status>: <body>` —
 * the admin panel's error log is how operators diagnose AI outages.
 */

const logger = require('./logger');

const GROQ_FALLBACK_MODEL = 'openai/gpt-oss-120b';
const REASONING_MODEL_RE  = /gpt-oss|qwen3|deepseek-r1|(^|\/)o[134](-|$)/i;
const REASONING_HEADROOM  = 1024; // extra completion tokens for hidden reasoning
const warnedModels = new Set();

function isReasoningModel(model) {
  return REASONING_MODEL_RE.test(String(model || ''));
}

/** Fallback model for this provider, or null when none is known. */
function fallbackModelFor(baseUrl) {
  if (process.env.AI_FALLBACK_MODEL) return process.env.AI_FALLBACK_MODEL;
  return /api\.groq\.com/i.test(String(baseUrl || '')) ? GROQ_FALLBACK_MODEL : null;
}

/** Request body for one model, adapted to whether it is a reasoning model. */
function buildBody({ model, messages, maxTokens, temperature, json }) {
  const body = { model, messages, temperature };
  if (json) body.response_format = { type: 'json_object' };
  if (isReasoningModel(model)) {
    body.max_completion_tokens = maxTokens + REASONING_HEADROOM;
    body.reasoning_effort = 'low';
    body.include_reasoning = false;
  } else {
    body.max_tokens = maxTokens;
  }
  return body;
}

class AIProviderError extends Error {
  constructor(status, bodyText) {
    super(`AI provider error ${status}: ${String(bodyText).slice(0, 300)}`);
    this.providerStatus = status;
    this.providerBody = String(bodyText);
  }
}

function isModelNotFound(err) {
  return err instanceof AIProviderError &&
    err.providerStatus === 404 &&
    /model_not_found|does not exist|do not have access/i.test(err.providerBody);
}

async function requestOnce({ baseUrl, apiKey, timeoutMs, ...rest }) {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(buildBody(rest)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new AIProviderError(resp.status, errText);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * @param {object} p
 * @param {string} p.baseUrl  OpenAI-compatible base URL (no trailing slash)
 * @param {string} p.apiKey
 * @param {string} p.model
 * @param {Array<{role:string,content:string}>} p.messages
 * @param {number} p.maxTokens   budget for the visible answer
 * @param {number} p.temperature
 * @param {boolean} [p.json]     request a JSON object response
 * @param {number} [p.timeoutMs]
 * @returns {Promise<string>} the answer text ('' if the provider returned none)
 */
async function chatCompletion({ timeoutMs = 15000, ...p }) {
  try {
    return await requestOnce({ ...p, timeoutMs });
  } catch (err) {
    const fallback = fallbackModelFor(p.baseUrl);
    if (!isModelNotFound(err) || !fallback || fallback === p.model) throw err;
    if (!warnedModels.has(p.model)) { // once per process, not on every question
      warnedModels.add(p.model);
      logger.warn('[AI]', `Model "${p.model}" is unavailable at the provider; using fallback "${fallback}". Update the *_MODEL env vars.`, {
        model: p.model, fallback,
      });
    }
    return requestOnce({ ...p, model: fallback, timeoutMs });
  }
}

module.exports = { chatCompletion, buildBody, isReasoningModel, fallbackModelFor, AIProviderError, GROQ_FALLBACK_MODEL };
