import { describe, it, expect, afterEach } from 'vitest';
import i18n from './index';

describe('nav.chatList.typingMultiple — Russian plural forms', () => {
  afterEach(() => { i18n.changeLanguage('ru'); });

  it('picks the correct Russian plural category by count', () => {
    i18n.changeLanguage('ru');
    expect(i18n.t('nav:chatList.typingMultiple', { count: 2 })).toBe('2 пользователя печатают');
    expect(i18n.t('nav:chatList.typingMultiple', { count: 5 })).toBe('5 пользователей печатают');
    expect(i18n.t('nav:chatList.typingMultiple', { count: 21 })).toBe('21 пользователь печатает');
  });

  it('falls back to English one/other categories when switched', () => {
    i18n.changeLanguage('en');
    expect(i18n.t('nav:chatList.typingMultiple', { count: 1 })).toBe('1 person is typing');
    expect(i18n.t('nav:chatList.typingMultiple', { count: 3 })).toBe('3 people are typing');
  });
});
