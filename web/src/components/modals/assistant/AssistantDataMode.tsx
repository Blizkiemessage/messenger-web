/**
 * AssistantDataMode — Этап D: ассистент по данным чатов («второй мозг»).
 *
 * Приватный помощник, отвечающий на вопросы по СВОИМ чатам/близким
 * («когда встреча с маркетингом?», «когда ДР у мамы?») с ОБЯЗАТЕЛЬНОЙ
 * ссылкой-источником на сообщение/профиль (ноль галлюцинаций).
 *
 * Строгий opt-in + платный доступ. Экраны по состоянию:
 *   - не сконфигурировано на сервере → «недоступно»;
 *   - нет доступа (entitled=false) → пейволл;
 *   - есть доступ, нет opt-in → экран согласия + настройка областей доступа;
 *   - включён → диалог с источниками + редактор настроек по кнопке.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatsStore } from '../../../store/useChatsStore';
import { useSessionStore } from '../../../store/useSessionStore';
import { useDeepLinkStore } from '../../../store/useDeepLinkStore';
import { useAppStore } from '../../../store/useAppStore';
import { chatTitle } from '../../../utils/format';
import { renderMarkdown } from '../../../utils/markdown';
import { Toggle } from '../../ui/Toggle';
import {
  getDataStatus, updateDataSettings, askDataAssistant,
  type DataAssistantStatus, type DataAnswer, type DataSource,
} from '../../../api/dataAssistant';

interface Props { onClose: () => void; }

type Thread =
  | { role: 'user'; text: string }
  | { role: 'thinking' }
  | { role: 'answer'; answer: DataAnswer };

export function AssistantDataMode({ onClose }: Props) {
  const { t } = useTranslation('modals');
  const EXAMPLES = [
    t('assistantData.example1'),
    t('assistantData.example2'),
    t('assistantData.example3'),
    t('assistantData.example4'),
  ];
  const open = useDeepLinkStore(s => s.open);
  const setShowSupport = useAppStore(s => s.setShowSupport);
  const me = useSessionStore(s => s.me);
  const chats = useChatsStore(s => s.chats);

  const [status, setStatus] = useState<DataAssistantStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // Черновик настроек доступа (экран согласия / редактор областей).
  const [readMessages, setReadMessages] = useState(false);
  const [scopeAll, setScopeAll] = useState(false);
  const [allow, setAllow] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState('');
  const [thread, setThread] = useState<Thread[]>([]);
  const [busy, setBusy] = useState(false);

  // Чаты, доступные для allowlist (псевдо-чат «Избранное» исключаем).
  const realChats = useMemo(
    () => chats.filter(c => c.type !== 'saved'),
    [chats],
  );

  useEffect(() => {
    getDataStatus()
      .then(s => {
        setStatus(s);
        setReadMessages(s.readMessages);
        setScopeAll(s.scopeAll);
        setAllow(new Set(s.allowChats));
        setShowSettings(!s.optin);
      })
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  async function saveSettings(optin: boolean) {
    setSaving(true);
    try {
      const next = await updateDataSettings({
        optin, readMessages, scopeAll, allowChats: [...allow],
      });
      setStatus(next);
      if (optin) setShowSettings(false);
    } catch { /* мягко игнорируем — статус не меняется */ }
    finally { setSaving(false); }
  }

  async function disable() {
    setSaving(true);
    try {
      const next = await updateDataSettings({ optin: false });
      setStatus(next);
      setShowSettings(true);
      setThread([]);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  function toggleChat(id: string) {
    setAllow(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function ask(raw: string) {
    const q = raw.trim();
    if (!q || busy) return;
    setQuery('');
    setThread(t => [...t, { role: 'user', text: q }, { role: 'thinking' }]);
    setBusy(true);
    try {
      const answer = await askDataAssistant(q);
      setThread(t => [...t.slice(0, -1), { role: 'answer', answer }]);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        t('assistantData.askError');
      setThread(t => [...t.slice(0, -1), { role: 'answer', answer: { reply: msg, covered: false, sources: [], mode: 'none' } }]);
    } finally { setBusy(false); }
  }

  function openSource(s: DataSource) {
    if (s.kind === 'message' && s.chatId && s.messageId) {
      open({ type: 'open-message', chatId: s.chatId, messageId: s.messageId });
      onClose();
    } else if (s.chatId) {
      open({ type: 'open-chat', chatId: s.chatId });
      onClose();
    }
  }

  // ── Состояния доступа ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="asstDataState">
        <div className="asstBubble asstThinking">
          <span className="asstDot" /><span className="asstDot" /><span className="asstDot" />
        </div>
      </div>
    );
  }

  if (!status || !status.configured) {
    return (
      <div className="asstDataState">
        <div className="asstDataIcon" aria-hidden>🧠</div>
        <h3>{t('assistantData.unavailableTitle')}</h3>
        <p className="asstDataMuted">
          {t('assistantData.unavailableDesc')}
        </p>
      </div>
    );
  }

  if (!status.entitled) {
    return (
      <div className="asstDataState">
        <div className="asstDataIcon" aria-hidden>✨</div>
        <h3>{t('assistantData.paywallTitle')}</h3>
        <p className="asstDataMuted">
          {t('assistantData.paywallDesc')}
        </p>
        <div className="asstDataLockBadge">{t('assistantData.paywallBadge')}</div>
        <button className="asstActionBtn asstActionPrimary" onClick={() => { setShowSupport(true); onClose(); }}>
          {t('assistantData.learnMore')}
        </button>
      </div>
    );
  }

  // ── Редактор настроек / экран согласия ─────────────────────────────────────

  if (showSettings) {
    const firstTime = !status.optin;
    return (
      <div className="asstDataSettings">
        <div className="asstDataScroll">
          {firstTime && (
            <div className="asstDataConsentHead">
              <div className="asstDataIcon" aria-hidden>🧠</div>
              <h3>{t('assistantData.consentTitle')}</h3>
              <p className="asstDataMuted">
                {t('assistantData.consentDesc')}
              </p>
            </div>
          )}

          {/* Структурные данные — всегда доступны, объясняем */}
          <div className="asstDataRow asstDataRowStatic">
            <div>
              <div className="asstDataRowTitle">{t('assistantData.structuralDataTitle')}</div>
              <div className="asstDataRowSub">{t('assistantData.structuralDataSub')}</div>
            </div>
            <span className="asstDataAlways">{t('assistantData.alwaysOn')}</span>
          </div>

          {/* Чтение сообщений */}
          <div className="asstDataRow">
            <div>
              <div className="asstDataRowTitle">{t('assistantData.readMessagesTitle')}</div>
              <div className="asstDataRowSub">{t('assistantData.readMessagesSub')}</div>
            </div>
            <Toggle value={readMessages} onChange={setReadMessages} />
          </div>

          {/* Область чатов — показываем только если чтение включено */}
          {readMessages && (
            <div className="asstDataScope">
              <div className="asstDataRow">
                <div>
                  <div className="asstDataRowTitle">{t('assistantData.allChatsTitle')}</div>
                  <div className="asstDataRowSub">{t('assistantData.allChatsSub')}</div>
                </div>
                <Toggle value={scopeAll} onChange={setScopeAll} />
              </div>

              {!scopeAll && (
                <div className="asstDataChatList">
                  <div className="asstDataChatListHead">
                    <span>{t('assistantData.selectChats', { count: allow.size })}</span>
                    <button
                      className="asstDataLinkBtn"
                      onClick={() => setAllow(new Set(realChats.map(c => c.id)))}
                    >
                      {t('assistantData.selectAll')}
                    </button>
                  </div>
                  {realChats.length === 0 && (
                    <div className="asstDataRowSub">{t('assistantData.noChatsToAnalyze')}</div>
                  )}
                  {realChats.map(c => (
                    <label key={c.id} className="asstDataChatItem">
                      <input
                        type="checkbox"
                        checked={allow.has(c.id)}
                        onChange={() => toggleChat(c.id)}
                      />
                      <span>{chatTitle(c, me?.id ?? '')}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Прозрачность о приватности */}
          <div className="asstDataPrivacy">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>
              {t('assistantData.privacyNote')}
            </span>
          </div>
        </div>

        <div className="asstDataSettingsFooter">
          {firstTime ? (
            <button className="asstActionBtn asstActionPrimary asstDataWide" disabled={saving} onClick={() => saveSettings(true)}>
              {saving ? t('assistantData.enabling') : t('assistantData.enableAssistant')}
            </button>
          ) : (
            <>
              <button className="asstActionBtn asstDataDanger" disabled={saving} onClick={disable}>
                {t('assistantData.disable')}
              </button>
              <button className="asstActionBtn asstActionPrimary" disabled={saving} onClick={() => saveSettings(true)}>
                {saving ? t('assistantData.saving') : t('common:save')}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Основной диалог ────────────────────────────────────────────────────────

  const scopeText = status.scopeAll
    ? t('assistantData.scopeAllChats')
    : status.readMessages
      ? t('assistantData.chatsCount', { count: status.allowChats.length })
      : t('assistantData.scopeStructuralOnly');

  return (
    <div className="asstDataMain">
      <div className="asstDataScopeBar">
        <span className="asstDataScopeInfo">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          {t('assistantData.accessLabel', { scope: scopeText })}
        </span>
        <button className="asstDataLinkBtn" onClick={() => setShowSettings(true)}>{t('assistantData.configure')}</button>
      </div>

      <div className="asstDataThread">
        {thread.length === 0 && (
          <div className="asstDataEmpty">
            <div className="asstDataIcon" aria-hidden>🧠</div>
            <p>{t('assistantData.askAnythingPrompt')}</p>
            <div className="asstChips">
              {EXAMPLES.map(ex => (
                <button key={ex} className="asstChip" onClick={() => ask(ex)}>{ex}</button>
              ))}
            </div>
          </div>
        )}

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
          const { answer } = item;
          return (
            <div key={idx} className="asstMsg asstMsgBot">
              <div className="asstBubble">
                <div className="asstAnswerBody">{renderMarkdown(answer.reply)}</div>
                {answer.sources.length > 0 && (
                  <div className="asstDataSources">
                    <div className="asstDataSourcesLabel">{t('assistantData.sourcesLabel')}</div>
                    {answer.sources.map((s, i) => (
                      <button key={i} className="asstDataSource" onClick={() => openSource(s)}>
                        <span className="asstDataSourceLabel">
                          {s.kind === 'profile' ? '👤 ' : '💬 '}{s.label}
                        </span>
                        <span className="asstDataSourceSnippet">{s.snippet}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form
        className="asstInputRow"
        onSubmit={e => { e.preventDefault(); ask(query); }}
      >
        <input
          className="asstInput"
          placeholder={t('assistantData.inputPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className="asstSend" type="submit" disabled={!query.trim() || busy} title={t('assistant.ask')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}
