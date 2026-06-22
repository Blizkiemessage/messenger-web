/**
 * ChatSettingsModal — хаб «Настройки чата».
 *
 * Единое место для всех настроек конкретного чата. Секции:
 *   - Оформление  → ChatBackgroundSettings (фон чата)
 *   - Вопрос дня  → DailyPromptSection
 *
 * Заменяет прежний отдельный пункт меню «Фон чата». Доступен для ЛС и групп
 * (не для «Избранного»). Открывается из меню шапки чата.
 */
import { useState } from 'react';
import { type Chat } from '../../types';
import { ChatBackgroundSettings } from './ChatBackgroundModal';
import { DailyPromptSection } from './chatSettings/DailyPromptSection';

type Section = 'appearance' | 'daily';

interface Props {
  chat: Chat;
  meId: string;
  initialSection?: Section;
  onClose: () => void;
  onOpenArchive?: () => void;
}

const TABS: { id: Section; label: string; icon: React.ReactNode }[] = [
  {
    id: 'appearance', label: 'Оформление',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
      </svg>
    ),
  },
  {
    id: 'daily', label: 'Вопрос дня',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
  },
];

export function ChatSettingsModal({ chat, meId, initialSection = 'appearance', onClose, onOpenArchive }: Props) {
  const [section, setSection] = useState<Section>(initialSection);

  return (
    <div className="modalOverlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalCard csCard">
        <div className="csHeader">
          <div className="csTitle">Настройки чата</div>
          <button className="upCloseBtn" onClick={onClose}>✕</button>
        </div>

        <div className="csTabs">
          {TABS.map(t => (
            <button key={t.id} type="button"
              className={`csTab${section === t.id ? ' active' : ''}`}
              onClick={() => setSection(t.id)}>
              {t.icon}<span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="csBody">
          {section === 'appearance' && (
            <ChatBackgroundSettings chat={chat} meId={meId} onClose={onClose} />
          )}
          {section === 'daily' && (
            <DailyPromptSection chat={chat} meId={meId} onOpenArchive={onOpenArchive} />
          )}
        </div>
      </div>
    </div>
  );
}
