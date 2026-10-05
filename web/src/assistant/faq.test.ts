import { describe, it, expect, beforeEach } from 'vitest';
import i18n from '../i18n';
import { detectQueryLang, searchFaqScored, getAssistantKb, FAQ_SCORE_STRONG } from './faq';

/**
 * Регресс 2026-10-05 (живой отчёт пользователя): при АНГЛИЙСКОМ интерфейсе
 * вопросы по-русски («Как сменить тему?», «как сменить пароль?») получали
 * «I couldn't find an exact answer», а LLM — «в базе нет информации»: база
 * знаний собиралась на языке интерфейса, а не вопроса. Плюс в базе не было
 * тем про смену языка и про отправку сообщения.
 */

const topId = (q: string) => searchFaqScored(q)[0]?.intent.id;

describe('assistant FAQ — язык вопроса, а не интерфейса', () => {
  beforeEach(async () => { await i18n.changeLanguage('en'); });

  it('detectQueryLang: кириллица → ru, иначе en', () => {
    expect(detectQueryLang('Как сменить тему?')).toBe('ru');
    expect(detectQueryLang('how do I change the theme')).toBe('en');
    expect(detectQueryLang('2fa')).toBe('en');
  });

  it('русские вопросы находят верные темы при английском интерфейсе', () => {
    expect(topId('Как сменить тему?')).toBe('appearance');
    expect(topId('как сменить пароль?')).toBe('security');
    expect(topId('как выбрать другой язык?')).toBe('language');
    expect(topId('Как написать сообщение')).toBe('send-message');
  });

  it('уверенный (а не «возможно, вы имели в виду») ответ на эти вопросы', () => {
    for (const q of ['Как сменить тему?', 'как сменить пароль?', 'как выбрать другой язык?']) {
      expect(searchFaqScored(q)[0].score).toBeGreaterThanOrEqual(FAQ_SCORE_STRONG);
    }
  });

  it('английские вопросы по-прежнему работают', () => {
    expect(topId('how do I change the language')).toBe('language');
    expect(topId('change password')).toBe('security');
  });

  it('база для LLM собирается на запрошенном языке, независимо от интерфейса', () => {
    const ru = getAssistantKb('ru');
    const en = getAssistantKb('en');
    expect(ru.find(i => i.id === 'language')?.question).toMatch(/язык/i);
    expect(en.find(i => i.id === 'language')?.question).toMatch(/language/i);
    expect(ru.map(i => i.id)).toEqual(en.map(i => i.id));
  });
});
