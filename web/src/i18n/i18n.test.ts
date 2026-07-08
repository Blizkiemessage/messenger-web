import { describe, it, expect, beforeEach } from 'vitest';
import i18n, { getStoredLocale, setLocale } from './index';

describe('i18n locale persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to ru when nothing is stored', () => {
    expect(getStoredLocale()).toBe('ru');
  });

  it('setLocale changes i18next language and persists the choice', () => {
    setLocale('en');
    expect(i18n.language).toBe('en');
    expect(window.localStorage.getItem('blz.language')).toBe('en');
    expect(getStoredLocale()).toBe('en');

    setLocale('ru');
    expect(i18n.language).toBe('ru');
    expect(getStoredLocale()).toBe('ru');
  });

  it('ignores a garbage value in localStorage and falls back to ru', () => {
    window.localStorage.setItem('blz.language', 'fr');
    expect(getStoredLocale()).toBe('ru');
  });

  it('has matching keys in every namespace across ru and en', async () => {
    const ru = (await import('./locales/ru')).default;
    const en = (await import('./locales/en')).default;
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
    for (const ns of Object.keys(ru) as Array<keyof typeof ru>) {
      expect(Object.keys(en[ns]).sort()).toEqual(Object.keys(ru[ns]).sort());
    }
  });
});
