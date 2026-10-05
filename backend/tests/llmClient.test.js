'use strict';

/**
 * utils/llmClient — shared OpenAI-compatible call for all AI features.
 * Regression for the 2026-09 production outage: Groq made
 * `llama-3.3-70b-versatile` enterprise-only, every AI request failed with
 * `404 model_not_found`, and the assistants silently stopped answering.
 * global.fetch is stubbed — no network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const logger = require('../src/utils/logger');
const {
  chatCompletion, buildBody, isReasoningModel, fallbackModelFor, GROQ_FALLBACK_MODEL,
} = require('../src/utils/llmClient');

const GROQ = 'https://api.groq.com/openai/v1';
const realFetch = global.fetch;
const realWarn = logger.warn;

function okResponse(content) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}
function errResponse(status, body) {
  return { ok: false, status, statusText: 'err', text: async () => body };
}
const MODEL_NOT_FOUND = JSON.stringify({ error: {
  message: 'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.',
  type: 'invalid_request_error', code: 'model_not_found',
} });

/** Stub fetch with a queue of responses; records the parsed request bodies. */
function stubFetch(responses) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return responses.shift();
  };
  return calls;
}

const base = {
  baseUrl: GROQ, apiKey: 'test-key', model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: 'hi' }], maxTokens: 500, temperature: 0.2,
};

test.afterEach(() => {
  global.fetch = realFetch;
  logger.warn = realWarn;
  delete process.env.AI_FALLBACK_MODEL;
});

test('isReasoningModel recognises reasoning model ids only', () => {
  assert.equal(isReasoningModel('openai/gpt-oss-120b'), true);
  assert.equal(isReasoningModel('openai/gpt-oss-20b'), true);
  assert.equal(isReasoningModel('qwen/qwen3.8-27b'), true);
  assert.equal(isReasoningModel('llama-3.3-70b-versatile'), false);
  assert.equal(isReasoningModel('gemini-2.0-flash'), false);
});

test('buildBody: plain model keeps max_tokens and no reasoning params', () => {
  const b = buildBody({ ...base, json: true });
  assert.equal(b.max_tokens, 500);
  assert.equal(b.max_completion_tokens, undefined);
  assert.equal(b.reasoning_effort, undefined);
  assert.deepEqual(b.response_format, { type: 'json_object' });
});

test('buildBody: reasoning model gets low effort, hidden reasoning and token headroom', () => {
  const b = buildBody({ ...base, model: 'openai/gpt-oss-120b' });
  assert.equal(b.max_tokens, undefined);
  assert.ok(b.max_completion_tokens > 500, 'answer budget must leave room for reasoning');
  assert.equal(b.reasoning_effort, 'low');
  assert.equal(b.include_reasoning, false);
  assert.equal(b.response_format, undefined);
});

test('fallbackModelFor: Groq default, env override, none for unknown providers', () => {
  assert.equal(fallbackModelFor(GROQ), GROQ_FALLBACK_MODEL);
  assert.equal(fallbackModelFor('https://generativelanguage.googleapis.com/v1beta/openai'), null);
  process.env.AI_FALLBACK_MODEL = 'custom/model';
  assert.equal(fallbackModelFor('https://example.com/v1'), 'custom/model');
});

test('chatCompletion returns trimmed content on success', async () => {
  const calls = stubFetch([okResponse('  Hello  ')]);
  assert.equal(await chatCompletion(base), 'Hello');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${GROQ}/chat/completions`);
});

test('model_not_found → one retry on the fallback model, warning logged once', async () => {
  const warns = [];
  logger.warn = (tag, msg) => warns.push(msg);
  const calls = stubFetch([
    errResponse(404, MODEL_NOT_FOUND), okResponse('answer 1'),
    errResponse(404, MODEL_NOT_FOUND), okResponse('answer 2'),
  ]);

  assert.equal(await chatCompletion(base), 'answer 1');
  assert.equal(await chatCompletion(base), 'answer 2');

  assert.equal(calls.length, 4);
  assert.equal(calls[1].body.model, GROQ_FALLBACK_MODEL);
  assert.equal(calls[1].body.reasoning_effort, 'low', 'fallback request is shaped for a reasoning model');
  assert.equal(warns.length, 1, 'stale-model warning is logged once per process, not per request');
  assert.match(warns[0], /llama-3\.3-70b-versatile/);
});

test('other provider errors are not retried and keep the admin-log message format', async () => {
  const calls = stubFetch([errResponse(401, '{"error":{"message":"Invalid API Key"}}')]);
  await assert.rejects(chatCompletion(base), /^Error: AI provider error 401: .*Invalid API Key/);
  assert.equal(calls.length, 1);
});

test('no retry when the failing model already is the fallback', async () => {
  const calls = stubFetch([errResponse(404, MODEL_NOT_FOUND)]);
  await assert.rejects(chatCompletion({ ...base, model: GROQ_FALLBACK_MODEL }), /AI provider error 404/);
  assert.equal(calls.length, 1);
});

test('no retry for a provider without a known fallback', async () => {
  const calls = stubFetch([errResponse(404, MODEL_NOT_FOUND)]);
  await assert.rejects(chatCompletion({ ...base, baseUrl: 'https://example.com/v1' }), /AI provider error 404/);
  assert.equal(calls.length, 1);
});
