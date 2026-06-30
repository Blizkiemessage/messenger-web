/**
 * ChatInfoPanel — правая панель информации о чате (десктоп/планшет).
 *
 * Заменяет на широких экранах модалки «инфо о собеседнике / о группе»,
 * «Настройки чата» (фон) и «Галерея»: всё это теперь живёт докнутой колонкой
 * справа от переписки. Состоит из:
 *   - шапки (большой аватар, имя/название, статус) + быстрых действий;
 *   - раскрывающейся секции «Настроить чат» (фон — ChatBackgroundSettings);
 *   - раскрывающейся секции «Медиа, файлы и ссылки» (ChatMediaBrowser);
 *   - блока быстрых ссылок (Заметки / AI-сводка / Вопрос дня).
 *
 * Функционал не меняется — переиспользуются те же компоненты, что и в модалках.
 * На мобильном (≤700px) панель не рендерится: там остаются прежние модалки.
 */
import { useEffect, useRef, useState } from 'react';
import { type Chat } from '../../types';
import { type InfoPanelSection } from '../../store/useAppStore';
import { chatTitle, chatSubtitle, avatarLetter, formatLastSeen } from '../../utils/format';
import { Avatar, resolveUrl, PRESENCE_LABELS, PRESENCE_EMOJI } from '../ui/Avatar';
import { useChatsStore } from '../../store/useChatsStore';
import { muteChat as apiMuteChat } from '../../api/chats';
import { ChatBackgroundSettings } from '../modals/ChatBackgroundModal';
import { ChatMediaBrowser } from '../modals/ChatMediaModal';

interface Props {
  chat: Chat;
  meId: string;
  onClose: () => void;
  onViewUser: (id: string) => void;
  onOpenGroupInfo: () => void;
  onToggleSearch: () => void;
  onOpenNotes: () => void;
  onOpenSummary: () => void;
  onOpenDaily: () => void;
  section: InfoPanelSection;
  onSectionConsumed: () => void;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`cipSectionChevron${open ? ' open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function ChatInfoPanel({
  chat, meId, onClose, onViewUser, onOpenGroupInfo, onToggleSearch,
  onOpenNotes, onOpenSummary, onOpenDaily, section, onSectionConsumed,
}: Props) {
  const isGroup = chat.type === 'group';
  const onlineUsers = useChatsStore(s => s.onlineUsers);
  const partner = !isGroup ? chat.members.find(m => m.id !== meId) ?? null : null;
  const isPartnerOnline = partner ? onlineUsers.has(partner.id) : false;
  const partnerPresence = partner?.presence_status ?? null;

  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(true);
  const [muteBusy, setMuteBusy] = useState(false);

  const customizeRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);

  // Раскрыть нужную секцию по запросу из шапки чата (галерея/настройки/профиль)
  useEffect(() => {
    if (!section) return;
    if (section === 'customize') {
      setCustomizeOpen(true);
      setTimeout(() => customizeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } else if (section === 'media') {
      setMediaOpen(true);
      setTimeout(() => mediaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } else if (section === 'profile') {
      if (isGroup) onOpenGroupInfo(); else if (partner) onViewUser(partner.id);
    }
    onSectionConsumed();
  }, [section]); // eslint-disable-line

  // Аватар для шапки (группа → chat.avatar_url; ЛС → собеседник)
  const avatarUser = isGroup
    ? { id: chat.id, display_name: chat.name, avatar_url: chat.avatar_url ?? null }
    : partner;

  const subtitle = isGroup
    ? chatSubtitle(chat, meId)
    : partnerPresence
      ? `${PRESENCE_EMOJI[partnerPresence]} ${PRESENCE_LABELS[partnerPresence]}`
      : formatLastSeen(partner?.last_seen_at, isPartnerOnline);

  async function handleMute() {
    if (muteBusy) return;
    setMuteBusy(true);
    try {
      const result = await apiMuteChat(chat.id);
      useChatsStore.getState().updateChatPatch(chat.id, result);
    } catch { /* ignore */ }
    finally { setMuteBusy(false); }
  }

  return (
    <aside className="chatInfoPanel" aria-label="Информация о чате">
      {/* Кнопка свернуть панель */}
      <button className="cipCollapse" onClick={onClose} title="Скрыть панель" aria-label="Скрыть панель">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      <div className="cipScroll">
        {/* ── Шапка: аватар, имя, статус ──────────────────────────────── */}
        <div className="cipHero">
          <button
            className="cipAvatar"
            onClick={() => { if (isGroup) onOpenGroupInfo(); else if (partner) onViewUser(partner.id); }}
            title={isGroup ? 'Информация о группе' : 'Профиль собеседника'}
          >
            {resolveUrl(avatarUser?.avatar_url) ? (
              <Avatar user={avatarUser} size={92} radius={28} presenceStatus={partnerPresence} />
            ) : (
              <span className={`cipAvatarLetter${isGroup ? ' group' : ''}`}>
                {avatarLetter(chatTitle(chat, meId))}
              </span>
            )}
          </button>
          <div className="cipName">{chatTitle(chat, meId)}</div>
          <div className={`cipStatus${!isGroup && isPartnerOnline ? ' online' : ''}`}>{subtitle}</div>
        </div>

        {/* ── Быстрые действия ────────────────────────────────────────── */}
        <div className="cipActions">
          <button
            className="cipAction"
            onClick={() => { if (isGroup) onOpenGroupInfo(); else if (partner) onViewUser(partner.id); }}
          >
            <span className="cipActionIcon">
              {isGroup ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
              )}
            </span>
            <span className="cipActionLabel">{isGroup ? 'Участники' : 'Профиль'}</span>
          </button>

          <button className={`cipAction${chat.is_muted ? ' active' : ''}`} onClick={handleMute} disabled={muteBusy}>
            <span className="cipActionIcon">
              {chat.is_muted ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
                  <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
                  <path d="M18 8a6 6 0 0 0-9.33-5" /><line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              )}
            </span>
            <span className="cipActionLabel">{chat.is_muted ? 'Звук' : 'Без звука'}</span>
          </button>

          <button className="cipAction" onClick={onToggleSearch}>
            <span className="cipActionIcon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <span className="cipActionLabel">Поиск</span>
          </button>
        </div>

        {/* ── Настроить чат (фон) ─────────────────────────────────────── */}
        <div className="cipSection" ref={customizeRef}>
          <button className="cipSectionHead" onClick={() => setCustomizeOpen(v => !v)}>
            <span className="cipSectionTitle">Настроить чат</span>
            <Chevron open={customizeOpen} />
          </button>
          {customizeOpen && (
            <div className="cipSectionBody cipCustomizeBody">
              <ChatBackgroundSettings chat={chat} meId={meId} onClose={() => { /* панель остаётся открытой */ }} />
            </div>
          )}
        </div>

        {/* ── Медиа, файлы и ссылки ───────────────────────────────────── */}
        <div className="cipSection" ref={mediaRef}>
          <button className="cipSectionHead" onClick={() => setMediaOpen(v => !v)}>
            <span className="cipSectionTitle">Медиа, файлы и ссылки</span>
            <Chevron open={mediaOpen} />
          </button>
          {mediaOpen && (
            <div className="cipSectionBody cipMediaBody">
              <ChatMediaBrowser chatId={chat.id} />
            </div>
          )}
        </div>

        {/* ── Быстрые ссылки ──────────────────────────────────────────── */}
        <div className="cipLinks">
          <button className="cipLinkRow" onClick={onOpenNotes}>
            <span className="cipLinkIcon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </span>
            <span className="cipLinkLabel">Заметки чата</span>
            <svg className="cipLinkChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>

          <button className="cipLinkRow" onClick={onOpenSummary}>
            <span className="cipLinkIcon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
              </svg>
            </span>
            <span className="cipLinkLabel">AI-сводка</span>
            <svg className="cipLinkChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>

          <button className="cipLinkRow" onClick={onOpenDaily}>
            <span className="cipLinkIcon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </span>
            <span className="cipLinkLabel">Вопрос дня</span>
            <svg className="cipLinkChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
