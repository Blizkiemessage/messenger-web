import { describe, it, expect } from 'vitest';
import { isAuthError } from './errors';

/**
 * Регресс QA-прогона 2026-09-03: сырой серверный текст «Forbidden» из загрузки
 * сообщений попадал в `dataError` — тот же слот, который рисует СПИСОК ЧАТОВ, —
 * и висел там до ручной перезагрузки. Загрузчики отличают транзиентные ошибки
 * авторизации именно этим предикатом.
 */
describe('isAuthError', () => {
  it('распознаёт 401 и 403 — ошибки, которые нельзя показывать пользователю сырыми', () => {
    expect(isAuthError(Object.assign(new Error('Unauthorized'), { status: 401 }))).toBe(true);
    expect(isAuthError(Object.assign(new Error('Forbidden'), { status: 403 }))).toBe(true);
  });

  it('не глотает настоящие ошибки, о которых пользователю надо сказать', () => {
    expect(isAuthError(Object.assign(new Error('Not found'), { status: 404 }))).toBe(false);
    expect(isAuthError(Object.assign(new Error('Server error'), { status: 500 }))).toBe(false);
    expect(isAuthError(Object.assign(new Error('Too large'), { status: 413 }))).toBe(false);
  });

  it('устойчив к ошибке без статуса (сетевой сбой, таймаут) и к null/undefined', () => {
    expect(isAuthError(new Error('Network Error'))).toBe(false);
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });
});
