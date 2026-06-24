/**
 * SidebarBottom — redesigned modern profile popup.
 * ✅ F3: StatusPicker integrated in profile panel.
 */
import { type User } from '../../types';
import { type Theme } from '../../utils/theme';
import { Avatar } from '../ui/Avatar';
import { ThemeIcon } from '../ui/icons/ThemeIcon';
import { StatusPicker } from '../ui/StatusPicker';

interface Props {
  me: User;
  theme: Theme;
  showProfile: boolean;
  onToggleProfile: () => void;
  onOpenSettings: () => void;
  onOpenInvite: () => void;
  onOpenAssistant: () => void;
  onOpenSupport: () => void;
  onLogout: () => void;
  onThemeToggle: () => void;
}

export function SidebarBottom({
  me, theme, showProfile, onToggleProfile, onOpenSettings, onOpenInvite, onOpenAssistant, onOpenSupport, onLogout, onThemeToggle,
}: Props) {
  return (
    <div className="sidebarBottom">
      {/* Profile popup — floats above the bottom bar */}
      {showProfile && (
        <div className="profilePanel">
          {/* User card */}
          <div className="ppCard">
            <div className="ppCardAvatar">
              <Avatar user={me} size={48} radius={15} presenceStatus={me.presence_status ?? null} />
            </div>
            <div className="ppCardInfo">
              <div className="ppCardName">{me.display_name || me.username}</div>
              <div className="ppCardSub">@{me.username}</div>
            </div>
          </div>

          {/* F3: Status picker */}
          <div className="ppStatusRow">
            <StatusPicker
              currentStatus={me.presence_status ?? null}
              currentNote={me.presence_note ?? null}
              currentExpiresAt={me.presence_expires_at ?? null}
            />
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

            <button className="ppAction ppActionInvite" onClick={onOpenInvite}>
              <span className="ppActionIcon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                </svg>
              </span>
              <span className="ppActionLabel">Пригласить друзей</span>
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

            <button className="ppAction" onClick={onOpenAssistant}>
              <span className="ppActionIcon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </span>
              <span className="ppActionLabel">Помощник</span>
              <svg className="ppActionChevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
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
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Avatar user={me} size={36} radius={11} presenceStatus={me.presence_status ?? null} />
          </div>
          <div className="meInfo">
            <div className="meName">{me.display_name || me.username || 'Пользователь'}</div>
            <div className="meSub">
              {me.presence_status
                ? <span style={{ color: me.presence_status === 'free' ? '#22c55e' : me.presence_status === 'busy' ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>
                    {me.presence_status === 'free' ? '🟢 Свободен' : me.presence_status === 'busy' ? '🟡 Занят' : '🔴 Не беспокоить'}
                  </span>
                : `@${me.username || ''}`
              }
            </div>
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
