'use strict';

/**
 * Tests for the backend RU/EN i18n helper (backend/src/i18n) and the places
 * that consume it: email template builders (config/email.js) and the push
 * notification body builder (services/pushService.js). Covers only content
 * that has a known recipient whose users.language can be looked up — NOT the
 * ~140 untranslated API error strings (separate, larger, unplanned work).
 */

process.env.MESSAGE_ENCRYPTION_KEY = '0'.repeat(64);
process.env.JWT_SECRET = 'i18n-test-jwt-secret';
process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { t, resolveLang } = require('../src/i18n');
const { buildOtpEmail, buildPasswordResetEmail, buildModerationWarningEmail } = require('../src/config/email');
const { buildBody } = require('../src/services/pushService');

describe('backend i18n — t() / resolveLang()', () => {
  test('resolveLang normalizes to ru/en, defaulting unknown values to ru', () => {
    assert.equal(resolveLang('en'), 'en');
    assert.equal(resolveLang('ru'), 'ru');
    assert.equal(resolveLang(undefined), 'ru');
    assert.equal(resolveLang(null), 'ru');
    assert.equal(resolveLang('fr'), 'ru');
  });

  test('t() returns the right language and interpolates params', () => {
    assert.equal(t('ru', 'otp.subject'), 'Ваш код подтверждения');
    assert.equal(t('en', 'otp.subject'), 'Your confirmation code');
    assert.match(t('ru', 'otp.text', { otp: '123456' }), /123456/);
    assert.match(t('en', 'otp.text', { otp: '123456' }), /123456/);
  });

  test('t() falls back to the ru dict for a language with a missing key, and to the key itself if truly absent', () => {
    assert.equal(t('en', 'push.callerIsCalling', { callerName: 'Alex' }), 'Alex is calling…');
    assert.equal(t('ru', 'nonexistent.key'), 'nonexistent.key');
  });
});

describe('config/email.js — pure template builders (RU/EN)', () => {
  test('buildOtpEmail: subject/text/html differ by language, OTP value embedded in both', () => {
    const ru = buildOtpEmail('654321', 'ru');
    const en = buildOtpEmail('654321', 'en');
    assert.equal(ru.subject, 'Ваш код подтверждения');
    assert.equal(en.subject, 'Your confirmation code');
    assert.match(ru.text, /654321/);
    assert.match(en.text, /654321/);
    assert.match(ru.html, /654321/);
    assert.match(en.html, /654321/);
    assert.notEqual(ru.html, en.html);
  });

  test('buildPasswordResetEmail: reset URL is embedded, subject/button text localized', () => {
    const url = 'https://example.com/reset?tok=abc';
    const ru = buildPasswordResetEmail(url, 'ru');
    const en = buildPasswordResetEmail(url, 'en');
    assert.equal(ru.subject, 'Сброс пароля');
    assert.equal(en.subject, 'Password reset');
    assert.ok(ru.html.includes(url) && en.html.includes(url));
    assert.ok(ru.html.includes('Сбросить пароль'));
    assert.ok(en.html.includes('Reset password'));
  });

  test('buildModerationWarningEmail: username/message embedded, HTML-escaped, subject localized', () => {
    const ru = buildModerationWarningEmail('alice', 'Please stop <b>spamming</b>', 'ru');
    const en = buildModerationWarningEmail('alice', 'Please stop <b>spamming</b>', 'en');
    assert.equal(ru.subject, 'Предупреждение от администрации');
    assert.equal(en.subject, 'Warning from the administration');
    assert.ok(ru.text.includes('@alice') && en.text.includes('@alice'));
    // Message HTML must be escaped (no raw <b> tag) to prevent HTML injection via admin-typed message.
    assert.ok(!ru.html.includes('<b>spamming</b>'));
    assert.match(ru.html, /&lt;b&gt;spamming&lt;\/b&gt;/);
  });

  test('builders default to ru when no lang is given', () => {
    assert.equal(buildOtpEmail('000000').subject, 'Ваш код подтверждения');
  });
});

describe('services/pushService.js — buildBody() localization', () => {
  const dummyDb = { prepare: () => ({ get: () => undefined }) };

  test('plain text passes through unchanged regardless of language (user content, not translated)', () => {
    const msg = { text: 'hello there', attachment_type: null, attachment_meta: null };
    assert.equal(buildBody(dummyDb, msg, 'ru'), 'hello there');
    assert.equal(buildBody(dummyDb, msg, 'en'), 'hello there');
  });

  test('image attachment without text falls back to a localized icon label', () => {
    const msg = { text: null, attachment_type: 'image', attachment_meta: null };
    assert.equal(buildBody(dummyDb, msg, 'ru'), '📷 Фото');
    assert.equal(buildBody(dummyDb, msg, 'en'), '📷 Photo');
  });

  test('daily_prompt card with no custom push_text gets a localized default', () => {
    const msg = { text: null, attachment_type: 'daily_prompt', attachment_meta: null };
    assert.equal(buildBody(dummyDb, msg, 'ru'), '🌙 Вопрос дня');
    assert.equal(buildBody(dummyDb, msg, 'en'), '🌙 Daily prompt');
  });

  test('unknown attachment type falls back to a generic localized "attachment" label', () => {
    const msg = { text: null, attachment_type: 'something_new', attachment_meta: null };
    assert.equal(buildBody(dummyDb, msg, 'ru'), '📎 Вложение');
    assert.equal(buildBody(dummyDb, msg, 'en'), '📎 Attachment');
  });

  test('sticker attachment resolves emoji_hint from the DB and localizes the "Sticker" label', () => {
    const dbWithHint = {
      prepare: () => ({ get: () => ({ emoji_hint: '🎉' }) }),
    };
    const msg = { text: null, attachment_type: 'sticker', attachment_meta: JSON.stringify({ itemId: 'x' }) };
    assert.equal(buildBody(dbWithHint, msg, 'ru'), '🎉 Стикер');
    assert.equal(buildBody(dbWithHint, msg, 'en'), '🎉 Sticker');
  });

  test('sticker attachment with no resolvable emoji_hint falls back to a localized generic sticker label', () => {
    const msg = { text: null, attachment_type: 'sticker', attachment_meta: '{}' };
    assert.equal(buildBody(dummyDb, msg, 'ru'), '🎭 Стикер');
    assert.equal(buildBody(dummyDb, msg, 'en'), '🎭 Sticker');
  });
});
