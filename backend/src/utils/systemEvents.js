/**
 * utils/systemEvents.js — структурный дискриминатор для системных сообщений
 * об изменениях в группе (кик/выход/закрытие/передача прав/роль/аватар).
 *
 * Сам текст сообщения (`text`) по-прежнему сохраняется по-русски (как и раньше —
 * для админ-панели/старых клиентов), но ПОВЕРХ него в attachment_type/attachment_meta
 * (обычные незашифрованные колонки, уже используются daily_prompt) кладём kind +
 * параметры (уже публично видимые всем участникам чата имена — не приватный контент).
 * Фронт при рендере игнорирует m.text и строит переведённую фразу через i18n
 * по kind/параметрам (см. web/src/components/chat/systemEvent.ts).
 */
function systemEventAttachment(kind, params = {}) {
  return {
    attachment_type: 'system_event',
    attachment_meta: JSON.stringify({ kind, ...params }),
  };
}

module.exports = { systemEventAttachment };
