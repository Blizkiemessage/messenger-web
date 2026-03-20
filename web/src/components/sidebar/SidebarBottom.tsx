import { type User } from '../../types';
import { type Theme } from '../../utils/theme';
import { Avatar } from '../ui/Avatar';
import { ThemeIcon } from '../ui/icons/ThemeIcon';

interface Props {
  me: User;
  theme: Theme;
  showProfile: boolean;
  onToggleProfile: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onThemeToggle: () => void;
}

export function SidebarBottom({
  me, theme, showProfile, onToggleProfile, onOpenSettings, onLogout, onThemeToggle,
}: Props) {
  return (
    <div className="sidebarBottom">
      {showProfile && (
        <div className="profilePanel">
          <div className="ppSection">
            <div className="ppTopRow">
              <Avatar user={me} size={52} radius={16} />
              <div className="ppInfo">
                <div className="ppName">{me.display_name || me.username}</div>
                <div className="ppSub">@{me.username}</div>
              </div>
            </div>
            <button className="ppSettingsBtn" onClick={onOpenSettings}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Настройки профиля
            </button>
          </div>
          <hr className="ppDivider" />
          <button className="ppLogout" onClick={onLogout}>Выйти из аккаунта</button>
        </div>
      )}
      <div className="sidebarBottomRow">
        <button className="meBtn" onClick={onToggleProfile}>
          <Avatar user={me} size={36} radius={11} />
          <div className="meInfo">
            <div className="meName">{me.display_name || me.username || 'Пользователь'}</div>
            <div className="meSub">@{me.username || ''}</div>
          </div>
        </button>
        <button className="themeToggle" onClick={onThemeToggle} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
          <ThemeIcon theme={theme} />
        </button>
      </div>
    </div>
  );
}
