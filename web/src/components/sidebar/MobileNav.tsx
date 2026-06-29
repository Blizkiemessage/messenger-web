/**
 * MobileNav — нижнее меню для телефонов (см. референс).
 *
 * Пять зон: Чаты · Звонки · [Ассистент — центральный «орб»] · Поиск · Профиль.
 * Чаты/Звонки/Поиск — вкладки (переключают контент карточки), Ассистент и
 * Профиль открывают модалки. Рендерится только на мобильном (десктоп его не
 * использует — там сайдбар со своим нижним блоком).
 */
import { type User } from '../../types';
import { type MobileTab } from '../../store/useAppStore';
import { Avatar } from '../ui/Avatar';

interface Props {
  me: User;
  activeTab: MobileTab;
  onTab: (t: MobileTab) => void;
  onAssistant: () => void;
  onProfile: () => void;
  /** true, когда открыт экран профиля (для подсветки кнопки профиля). */
  profileActive: boolean;
}

function ChatsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
function CallsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function AssistantSpark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.2l1.7 5.1 5.1 1.7-5.1 1.7L12 16.8l-1.7-5.1L5.2 10l5.1-1.7z" />
      <path d="M18.5 14.5l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z" />
      <path d="M5 5l.4 1.2L6.6 6.6 5.4 7 5 8.2 4.6 7 3.4 6.6 4.6 6.2z" />
    </svg>
  );
}

export function MobileNav({ me, activeTab, onTab, onAssistant, onProfile, profileActive }: Props) {
  return (
    <nav className="mNav" aria-label="Главное меню">
      <button
        className={`mNavBtn${activeTab === 'chats' && !profileActive ? ' active' : ''}`}
        onClick={() => onTab('chats')}
      >
        <span className="mNavIcon"><ChatsIcon /></span>
        <span className="mNavLabel">Чаты</span>
      </button>

      <button
        className={`mNavBtn${activeTab === 'calls' && !profileActive ? ' active' : ''}`}
        onClick={() => onTab('calls')}
      >
        <span className="mNavIcon"><CallsIcon /></span>
        <span className="mNavLabel">Звонки</span>
      </button>

      {/* Центральная «фишка» — ассистент */}
      <button className="mNavOrb" onClick={onAssistant} aria-label="Открыть помощника" title="Помощник">
        <span className="mNavOrbAura" aria-hidden />
        <span className="mNavOrbIcon"><AssistantSpark /></span>
      </button>

      <button
        className={`mNavBtn${activeTab === 'search' && !profileActive ? ' active' : ''}`}
        onClick={() => onTab('search')}
      >
        <span className="mNavIcon"><SearchIcon /></span>
        <span className="mNavLabel">Поиск</span>
      </button>

      <button
        className={`mNavBtn mNavBtnProfile${profileActive ? ' active' : ''}`}
        onClick={onProfile}
      >
        <span className="mNavIcon mNavAvatar">
          <Avatar user={me} size={24} radius={8} presenceStatus={me.presence_status ?? null} />
        </span>
        <span className="mNavLabel">Профиль</span>
      </button>
    </nav>
  );
}
