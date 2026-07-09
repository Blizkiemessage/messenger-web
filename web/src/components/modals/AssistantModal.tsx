/**
 * AssistantModal — ассистент-помощник по приложению (Этап C, v1).
 *
 * Диалоговая модалка: пользователь спрашивает «как сделать X» (поиск или
 * быстрые чипы/категории) и получает короткую инструкцию с кликабельными
 * кнопками-действиями (deep-links), открывающими нужный раздел. Если ответа
 * нет — предлагает написать в поддержку.
 *
 * v1 — детерминированный FAQ (`assistant/faq.ts`), без ИИ и без backend.
 * Каркас диалога переиспользуем для будущего ассистента по данным (Этап D).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeepLinkStore } from '../../store/useDeepLinkStore';
import { useAppStore } from '../../store/useAppStore';
import { renderMarkdown } from '../../utils/markdown';
import { getAssistantStatus, askAssistant } from '../../api/assistant';
import { AssistantDataMode } from './assistant/AssistantDataMode';
import {
  getFaq, getTopIntents, getCategoryMeta, getAssistantKb,
  searchFaqScored, getIntentById, FAQ_SCORE_STRONG,
  type FaqIntent, type FaqAction, type FaqCategory, type ScoredIntent,
} from '../../assistant/faq';

interface Props {
  /** Опц. предвыбранный интент (из deep-link `assistant?topic=`). */
  topic?: string;
  /** Начальный режим: помощь по приложению или ассистент по данным. */
  initialMode?: AssistantMode;
  onClose: () => void;
}

type AssistantMode = 'help' | 'data';

type ThreadItem =
  | { role: 'user'; text: string }
  | { role: 'assistant'; intent: FaqIntent }
  | { role: 'thinking' }
  | { role: 'assistant-generated'; reply: string; actions: FaqAction[]; showSupport: boolean }
  | { role: 'assistant-suggest'; query: string; suggestions: FaqIntent[] }
  | { role: 'assistant-empty'; query: string };

export function AssistantModal({ topic, initialMode = 'help', onClose }: Props) {
  const { t, i18n } = useTranslation('modals');
  const open = useDeepLinkStore(s => s.open);
  const setShowSupport = useAppStore(s => s.setShowSupport);

  // Пересчитываются на каждый рендер — подхватывают смену языка (i18n.language
  // меняет весь FAQ-каталог: getFaq/getTopIntents/getCategoryMeta/getAssistantKb
  // читают i18n.language напрямую, см. assistant/faq.ts).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const FAQ = useMemo(() => getFaq(), [i18n.language]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const TOP_INTENTS = useMemo(() => getTopIntents(), [i18n.language]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const CATEGORY_META = useMemo(() => getCategoryMeta(), [i18n.language]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ASSISTANT_KB = useMemo(() => getAssistantKb(), [i18n.language]);

  const [mode, setMode] = useState<AssistantMode>(topic ? 'help' : initialMode);
  const [query, setQuery] = useState('');
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [activeCat, setActiveCat] = useState<FaqCategory | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Узнаём один раз, доступен ли LLM-слой (чтобы не дёргать /ask впустую)
  useEffect(() => {
    let alive = true;
    getAssistantStatus().then(s => { if (alive) setAiEnabled(s.aiEnabled); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Автоскролл вниз при новом сообщении
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [thread]);

  // Предвыбор интента из deep-link topic
  useEffect(() => {
    if (topic) {
      const intent = FAQ.find(i => i.id === topic);
      if (intent) answerIntent(intent);
    }
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  function answerIntent(intent: FaqIntent) {
    setThread(t => [...t, { role: 'user', text: intent.question }, { role: 'assistant', intent }]);
  }

  /** Построить ответ при отсутствии уверенного совпадения: подсказки или фолбэк. */
  function buildNoMatch(q: string, scored: ScoredIntent[]): ThreadItem {
    const suggestions = scored.slice(0, 3).map(s => s.intent);
    return suggestions.length
      ? { role: 'assistant-suggest', query: q, suggestions }
      : { role: 'assistant-empty', query: q };
  }

  /** Заменить последний элемент треда (плейсхолдер «печатает…») на результат. */
  function replaceLast(item: ThreadItem) {
    setThread(t => (t.length ? [...t.slice(0, -1), item] : [item]));
  }

  /** Собрать кнопки-навигации из релевантных тем (deep-links резолвит фронт). */
  function actionsFromIds(ids: string[]): FaqAction[] {
    const seen = new Set<string>();
    const out: FaqAction[] = [];
    for (const id of ids) {
      const intent = getIntentById(id);
      for (const a of intent?.actions ?? []) {
        if (seen.has(a.label)) continue;
        seen.add(a.label);
        out.push(a);
      }
    }
    return out.slice(0, 3);
  }

  async function runSearch(raw: string) {
    const q = raw.trim();
    if (!q || busy) return;
    setQuery('');

    // LLM-генератор (если включён): формулирует ответ под конкретный вопрос по
    // базе знаний + даёт кнопки-навигации. Это основной путь — он не подсовывает
    // дефолтные ответы не по теме.
    if (aiEnabled) {
      setThread(t => [...t, { role: 'user', text: q }, { role: 'thinking' }]);
      setBusy(true);
      try {
        const { reply, covered, relatedIds } = await askAssistant(q, ASSISTANT_KB);
        if (reply) {
          replaceLast({
            role: 'assistant-generated',
            reply,
            actions: covered ? actionsFromIds(relatedIds) : [],
            showSupport: !covered,
          });
        } else {
          replaceLast(buildNoMatch(q, searchFaqScored(q)));
        }
      } catch {
        // Сбой LLM → мягкая деградация на локальный поиск.
        replaceLast(buildNoMatch(q, searchFaqScored(q)));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Без LLM — локальный поиск: уверенное совпадение → ответ, иначе подсказки.
    const scored = searchFaqScored(q);
    if (scored[0] && scored[0].score >= FAQ_SCORE_STRONG) {
      setThread(t => [...t, { role: 'user', text: q }, { role: 'assistant', intent: scored[0].intent }]);
      return;
    }
    setThread(t => [...t, { role: 'user', text: q }, buildNoMatch(q, scored)]);
  }

  function runAction(item: { action: import('../../deeplinks').DeepLinkAction }) {
    open(item.action);
    onClose();
  }

  function openSupport() {
    setShowSupport(true);
    onClose();
  }

  const started = thread.length > 0;
  const catList = activeCat ? FAQ.filter(i => i.category === activeCat) : [];

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="asstCard">
        {/* ── Header ── */}
        <div className="asstHeader">
          <div className="asstHeaderTitle">
            <span className="asstAvatar" aria-hidden>{mode === 'data' ? '🧠' : '🪄'}</span>
            <div>
              <div className="asstName">{t('assistant.name')}</div>
              <div className="asstStatus">
                {mode === 'data' ? t('assistant.statusData') : t('assistant.statusHelp')}
              </div>
            </div>
          </div>
          <button className="asstClose" onClick={onClose} title={t('common:close')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Переключатель режимов ── */}
        <div className="asstTabs" role="tablist">
          <button
            className={`asstTab${mode === 'help' ? ' asstTabActive' : ''}`}
            role="tab"
            aria-selected={mode === 'help'}
            onClick={() => setMode('help')}
          >
            {t('assistant.tabHelp')}
          </button>
          <button
            className={`asstTab${mode === 'data' ? ' asstTabActive' : ''}`}
            role="tab"
            aria-selected={mode === 'data'}
            onClick={() => setMode('data')}
          >
            {t('assistant.tabData')}
          </button>
        </div>

        {mode === 'data' ? (
          <AssistantDataMode onClose={onClose} />
        ) : (
        <>
        {/* ── Thread ── */}
        <div className="asstThread" ref={scrollRef}>
          {/* Приветствие */}
          <div className="asstMsg asstMsgBot">
            <div className="asstBubble">{renderMarkdown(t('assistant.greeting'))}</div>
          </div>

          {/* Стартовый экран: категории + частые вопросы */}
          {!started && (
            <div className="asstStart">
              <div className="asstSectionLabel">{t('assistant.frequentQuestions')}</div>
              <div className="asstChips">
                {TOP_INTENTS.map(i => (
                  <button key={i.id} className="asstChip" onClick={() => answerIntent(i)}>
                    {i.question}
                  </button>
                ))}
              </div>

              <div className="asstSectionLabel">{t('assistant.topics')}</div>
              <div className="asstCats">
                {(Object.keys(CATEGORY_META) as FaqCategory[]).map(cat => (
                  <button
                    key={cat}
                    className={`asstCat${activeCat === cat ? ' asstCatActive' : ''}`}
                    onClick={() => setActiveCat(activeCat === cat ? null : cat)}
                  >
                    <span className="asstCatIcon" aria-hidden>{CATEGORY_META[cat].icon}</span>
                    {CATEGORY_META[cat].label}
                  </button>
                ))}
              </div>

              {activeCat && (
                <div className="asstCatList">
                  {catList.map(i => (
                    <button key={i.id} className="asstCatItem" onClick={() => answerIntent(i)}>
                      <span>{i.question}</span>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Диалог */}
          {thread.map((item, idx) => {
            if (item.role === 'user') {
              return (
                <div key={idx} className="asstMsg asstMsgUser">
                  <div className="asstBubble asstBubbleUser">{item.text}</div>
                </div>
              );
            }
            if (item.role === 'thinking') {
              return (
                <div key={idx} className="asstMsg asstMsgBot">
                  <div className="asstBubble asstThinking">
                    <span className="asstDot" /><span className="asstDot" /><span className="asstDot" />
                  </div>
                </div>
              );
            }
            if (item.role === 'assistant-generated') {
              return (
                <div key={idx} className="asstMsg asstMsgBot">
                  <div className="asstBubble">
                    <div className="asstAnswerBody">{renderMarkdown(item.reply)}</div>
                    {(item.actions.length > 0 || item.showSupport) && (
                      <div className="asstActions">
                        {item.actions.map((a, i) => (
                          <button
                            key={i}
                            className={`asstActionBtn${i === 0 ? ' asstActionPrimary' : ''}`}
                            onClick={() => runAction(a)}
                          >
                            {a.label}
                          </button>
                        ))}
                        {item.showSupport && (
                          <button className="asstActionBtn" onClick={openSupport}>
                            {t('assistant.contactSupport')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            if (item.role === 'assistant-suggest') {
              return (
                <div key={idx} className="asstMsg asstMsgBot">
                  <div className="asstBubble">
                    <p>{t('assistant.noMatchSuggest', { query: item.query })}</p>
                    <div className="asstChips asstSuggest">
                      {item.suggestions.map(s => (
                        <button key={s.id} className="asstChip" onClick={() => answerIntent(s)}>
                          {s.question}
                        </button>
                      ))}
                    </div>
                    <div className="asstActions">
                      <button className="asstActionBtn" onClick={openSupport}>
                        {t('assistant.noneOfThese')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            if (item.role === 'assistant-empty') {
              return (
                <div key={idx} className="asstMsg asstMsgBot">
                  <div className="asstBubble">
                    <p>{t('assistant.noMatchEmpty', { query: item.query })}</p>
                    <div className="asstActions">
                      <button className="asstActionBtn asstActionPrimary" onClick={openSupport}>
                        {t('assistant.contactSupport')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            // assistant intent
            const { intent } = item;
            return (
              <div key={idx} className="asstMsg asstMsgBot">
                <div className="asstBubble">
                  <div className="asstAnswerTitle">{intent.question}</div>
                  <div className="asstAnswerBody">{renderMarkdown(intent.answer)}</div>
                  {!!intent.actions?.length && (
                    <div className="asstActions">
                      {intent.actions.map((a, i) => (
                        <button
                          key={i}
                          className={`asstActionBtn${i === 0 ? ' asstActionPrimary' : ''}`}
                          onClick={() => runAction(a)}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer: поиск + поддержка ── */}
        <div className="asstFooter">
          <form
            className="asstInputRow"
            onSubmit={e => { e.preventDefault(); runSearch(query); }}
          >
            <input
              ref={inputRef}
              className="asstInput"
              placeholder={t('assistant.inputPlaceholder')}
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            <button className="asstSend" type="submit" disabled={!query.trim() || busy} title={t('assistant.ask')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
          <button className="asstSupportLink" onClick={openSupport}>
            {t('assistant.supportLink')}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
