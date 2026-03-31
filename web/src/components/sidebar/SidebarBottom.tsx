/**
 * SidebarBottom — redesigned modern profile popup.
 */
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
  onOpenSupport: () => void;
  onLogout: () => void;
  onThemeToggle: () => void;
}

export function SidebarBottom({
  me, theme, showProfile, onToggleProfile, onOpenSettings, onOpenSupport, onLogout, onThemeToggle,
}: Props) {
  return (
    <div className="sidebarBottom">
      {/* Profile popup — floats above the bottom bar */}
      {showProfile && (
        <div className="profilePanel">
          {/* User card */}
          <div className="ppCard">
            <div className="ppCardAvatar">
              <Avatar user={me} size={48} radius={15} />
            </div>
            <div className="ppCardInfo">
              <div className="ppCardName">{me.display_name || me.username}</div>
              <div className="ppCardSub">@{me.username}</div>
            </div>
          </div>

          {/* Actions */}
          <div className="ppActions">
            <button className="ppAction" onClick={onOpenSettings}>
              <span className="ppActionIcon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </span>
              <span className="ppActionLabel">Настройки</span>
              <svg className="ppActionChevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>

            <button className="ppAction" onClick={onThemeToggle}>
              <span className="ppActionIcon">
                <ThemeIcon theme={theme} />
              </span>
              <span className="ppActionLabel">
                {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              </span>
            </button>

            <button className="ppAction" onClick={onOpenSupport}>
              <span className="ppActionIcon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
                  <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
                </svg>
              </span>
              <span className="ppActionLabel">Техническая поддержка</span>
            </button>
          </div>

          <div className="ppSeparator" />

          <button className="ppLogoutBtn" onClick={onLogout}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Выйти из аккаунта
          </button>
        </div>
      )}

      {/* Bottom bar */}
      <div className="sidebarBottomRow">
        <button className="meBtn" onClick={onToggleProfile}>
          <Avatar user={me} size={36} radius={11} />
          <div className="meInfo">
            <div className="meName">{me.display_name || me.username || 'Пользователь'}</div>
            <div className="meSub">@{me.username || ''}</div>
          </div>
          <svg
            className={`meChevron${showProfile ? ' meChevronUp' : ''}`}
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
