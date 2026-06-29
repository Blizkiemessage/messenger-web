/**
 * MobileProfileMenu — стеклянная карточка-меню профиля (телефоны).
 *
 * Открывается по тапу «Профиль» в нижнем меню. Содержит шапку пользователя
 * и пункты: Настройки, Тех. поддержка, Тема оформления (слайдер солнце/луна),
 * Язык (заглушка), Выйти. Сам экран настроек/поддержки — отдельные модалки,
 * открываются из этого меню.
 */
import { Portal } from '../ui/Portal';
import { Avatar } from '../ui/Avatar';
import { type User } from '../../types';
import { type Theme } from '../../utils/theme';

interface Props {
  me: User;
  theme: Theme;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenSupport: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
}

export function MobileProfileMenu({
  me, theme, onClose, onOpenSettings, onOpenSupport, onToggleTheme, onLogout,
}: Props) {
  const isDark = theme === 'dark';

  return (
    <Portal>
      <div className="mpOverlay" onClick={onClose}>
        <div className="mpSheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Профиль">
          {/* Хваталка-полоска */}
          <div className="mpGrab" />

          {/* Шапка пользователя */}
          <div className="mpHead">
            <Avatar user={me} size={54} radius={16} presenceStatus={me.presence_status ?? null} />
            <div className="mpHeadInfo">
              <div className="mpHeadName">{me.display_name || me.username || 'Пользователь'}</div>
              <div className="mpHeadSub">{me.email ? me.email : `@${me.username || ''}`}</div>
            </div>
          </div>

          <div className="mpDivider" />

          {/* Пункты */}
          <button className="mpItem" onClick={() => { onClose(); onOpenSettings(); }}>
            <span className="mpItemIcon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="8" x2="20" y2="8" /><line x1="4" y1="16" x2="20" y2="16" />
                <circle cx="9" cy="8" r="2.4" fill="var(--card)" /><circle cx="15" cy="16" r="2.4" fill="var(--card)" />
              </svg>
            </span>
            <span className="mpItemLabel">Настройки</span>
            <svg className="mpItemChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>

          <button className="mpItem" onClick={() => { onClose(); onOpenSupport(); }}>
            <span className="mpItemIcon">
              {/* Наушники — как в самом окне поддержки */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
                <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
              </svg>
            </span>
            <span className="mpItemLabel">Тех. поддержка</span>
            <svg className="mpItemChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>

          {/* Тема оформления — слайдер солнце/луна */}
          <button className="mpItem" onClick={onToggleTheme}>
            <span className="mpItemIcon">
              {isDark ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4.2" />
                  <line x1="12" y1="2.5" x2="12" y2="4.5" /><line x1="12" y1="19.5" x2="12" y2="21.5" />
                  <line x1="4.6" y1="4.6" x2="6" y2="6" /><line x1="18" y1="18" x2="19.4" y2="19.4" />
                  <line x1="2.5" y1="12" x2="4.5" y2="12" /><line x1="19.5" y1="12" x2="21.5" y2="12" />
                  <line x1="4.6" y1="19.4" x2="6" y2="18" /><line x1="18" y1="6" x2="19.4" y2="4.6" />
                </svg>
              )}
            </span>
            <span className="mpItemLabel">Тема оформления</span>
            <span className={`mpThemeSwitch${isDark ? ' dark' : ''}`} aria-hidden>
              <span className="mpThemeKnob">
                {isDark ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="3" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="21" />
                    <line x1="5" y1="5" x2="6.4" y2="6.4" /><line x1="17.6" y1="17.6" x2="19" y2="19" />
                    <line x1="3" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="21" y2="12" />
                    <line x1="5" y1="19" x2="6.4" y2="17.6" /><line x1="17.6" y1="6.4" x2="19" y2="5" />
                  </svg>
                )}
              </span>
            </span>
          </button>

          {/* Язык — заглушка */}
          <button className="mpItem mpItemDisabled" disabled>
            <span className="mpItemIcon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 5h7M8 3v2M6 5c0 4-2.5 6-4 7M5.5 9c0 2 2 3.5 4.5 4.5" />
                <path d="M13 20l4-9 4 9M14.5 17h5" />
              </svg>
            </span>
            <span className="mpItemLabel">Язык</span>
            <span className="mpSoon">Скоро</span>
          </button>

          <div className="mpDivider" />

          {/* Выйти — иконка смотрит к краю (зеркальная) */}
          <button className="mpItem mpItemSignout" onClick={onLogout}>
            <span className="mpItemIcon mpSignoutIcon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </span>
            <span className="mpItemLabel">Выйти</span>
          </button>
        </div>
      </div>
    </Portal>
  );
}
