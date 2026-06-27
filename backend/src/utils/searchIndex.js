/**
 * searchIndex.js — «слепой индекс» (blind index) для поиска по зашифрованным
 * сообщениям БЕЗ хранения открытого текста.
 *
 * Идея: для каждого слова сообщения считаем необратимый keyed-HMAC от его
 * ПРЕФИКСОВ и храним эти отпечатки в таблице message_search_tokens. По шифру
 * искать нельзя, но по отпечаткам — можно: хешируем слово запроса тем же ключом
 * и находим сообщения с таким отпечатком (затем кандидаты дешифруются в памяти и
 * проверяются по подстроке — финальная сверка сохраняет прежнюю семантику).
 *
 * Ключ индекса ВЫВОДИТСЯ из MESSAGE_ENCRYPTION_KEY через HKDF (отдельный от
 * ключа шифрования сообщений — отпечатки нельзя использовать для расшифровки, а
 * утечка таблицы индекса не раскрывает текст). Доп. env не требуется.
 *
 * Семантика: поиск идёт по НАЧАЛУ слов (префикс) — как набор «по мере ввода».
 * Подстрока В СЕРЕДИНЕ слова («ивет» → «привет») индексом не покрывается
 * (осознанный компромисс searchable-encryption); префикс/целое слово — да.
 */
'use strict';

const crypto = require('crypto');

const MIN_PREFIX = 2;   // слова/запросы короче 2 символов в индексе не участвуют
const MAX_PREFIX = 12;  // префиксы длиннее 12 не индексируем (финальная сверка добьёт)
const MAX_WORD   = 40;  // абсурдно длинные «слова» игнорируем

let _key = null;
function key() {
  if (_key) return _key;
  const hex = process.env.MESSAGE_ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    throw new Error('MESSAGE_ENCRYPTION_KEY must be set (64 hex) for the search index');
  }
  const ikm = Buffer.from(hex.slice(0, 64), 'hex');
  // Отдельный ключ индекса (HKDF-производный) — НЕ равен ключу сообщений.
  _key = Buffer.from(
    crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), Buffer.from('blizkie-blind-index-v1'), 32),
  );
  return _key;
}

/** Отпечаток одного префикса: первые 8 байт HMAC-SHA256 в hex (16 символов). */
function hashPrefix(prefix) {
  return crypto.createHmac('sha256', key()).update(prefix, 'utf8').digest('hex').slice(0, 16);
}

/** Разбить текст на слова (нижний регистр, по не-буквам/цифрам, Unicode). */
function words(text) {
  return (text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= MIN_PREFIX && w.length <= MAX_WORD);
}

/** Уникальные отпечатки префиксов для ИНДЕКСАЦИИ текста сообщения. */
function indexTokens(text) {
  const set = new Set();
  for (const w of words(text)) {
    const max = Math.min(w.length, MAX_PREFIX);
    for (let len = MIN_PREFIX; len <= max; len++) set.add(hashPrefix(w.slice(0, len)));
  }
  return [...set];
}

/**
 * Отпечатки слов ЗАПРОСА (по одному на слово — префикс до MAX_PREFIX).
 * null, если в запросе нет пригодного слова (короче 2 символов) → поиск пуст.
 */
function queryTokens(query) {
  const ws = words(query);
  if (ws.length === 0) return null;
  const set = new Set();
  for (const w of ws) set.add(hashPrefix(w.slice(0, MAX_PREFIX)));
  return [...set];
}

module.exports = { indexTokens, queryTokens, MIN_PREFIX, MAX_PREFIX };
