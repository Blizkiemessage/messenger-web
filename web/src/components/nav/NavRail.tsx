/**
 * NavRail — компактная боковая панель навигации (десктоп/планшет, > 700px).
 *
 * Десктопный аналог мобильного нижнего меню (MobileNav): Чаты · Звонки ·
 * Ассистент (яркая градиентная кнопка) · Тех. поддержка · Профиль (внизу).
 * Поиск отдельной кнопкой не выносим — он живёт в шапке списка чатов.
 * Профиль открывает всплывающее меню (NavProfilePopover). На мобильном
 * (≤700px) панель скрыта — там работает прежняя мобильная оболочка.
 */
import { type User } from '../../types';
import { type Theme } from '../../utils/theme';
import { type DesktopTab } from '../../store/useAppStore';
import { Avatar } from '../ui/Avatar';
import { NavProfilePopover } from './NavProfilePopover';

interface Props {
  me: User;
  theme: Theme;
  activeTab: DesktopTab;
  profileOpen: boolean;
  onTab: (t: DesktopTab) => void;
  onToggleProfile: () => void;
  onCloseProfile: () => void;
  onOpenAssistant: () => void;
  onOpenSupport: () => void;
  onOpenSettings: () => void;
  onOpenInvite: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
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
function SupportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
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

export function NavRail({
  me, theme, activeTab, profileOpen,
  onTab, onToggleProfile, onCloseProfile,
  onOpenAssistant, onOpenSupport, onOpenSettings, onOpenInvite, onToggleTheme, onLogout,
}: Props) {
  return (
    <nav className="navRail" aria-label="Главная навигация">
      {/* Ассистент — яркая градиентная кнопка-звёзды вверху (без подписи) */}
      <button className="navTopAssistant" onClick={onOpenAssistant} title="Помощник" aria-label="Открыть помощника">
        <span className="navTopAssistantGlow" aria-hidden />
        <span className="navTopAssistantIcon"><AssistantSpark /></span>
      </button>

      {/* Навигация */}
      <div className="navItems">
        <button
          className={`navItem${activeTab === 'chats' ? ' active' : ''}`}
          onClick={() => onTab('chats')}
          title="Чаты"
        >
          <span className="navItemIcon"><ChatsIcon /></span>
          <span className="navItemLabel">Чаты</span>
        </button>

        <button
          className={`navItem${activeTab === 'calls' ? ' active' : ''}`}
          onClick={() => onTab('calls')}
          title="Звонки"
        >
          <span className="navItemIcon"><CallsIcon /></span>
          <span className="navItemLabel">Звонки</span>
        </button>

        <button className="navItem" onClick={onOpenSupport} title="Тех. поддержка">
          <span className="navItemIcon"><SupportIcon /></span>
          <span className="navItemLabel">Поддержка</span>
        </button>
      </div>

      {/* Профиль внизу */}
      <div className="navProfileWrap">
        <button
          className={`navProfileBtn${profileOpen ? ' active' : ''}`}
          onClick={onToggleProfile}
          title="Профиль"
        >
          <Avatar user={me} size={38} radius={12} presenceStatus={me.presence_status ?? null} />
        </button>

        {profileOpen && (
          <NavProfilePopover
            me={me}
            theme={theme}
            onClose={onCloseProfile}
            onOpenSettings={onOpenSettings}
            onOpenInvite={onOpenInvite}
            onToggleTheme={onToggleTheme}
            onLogout={onLogout}
          />
        )}
      </div>
    </nav>
  );
}
