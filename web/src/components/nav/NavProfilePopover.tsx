/**
 * NavProfilePopover — десктопное меню профиля (всплывает над аватаром в NavRail).
 *
 * Десктопный аналог мобильного MobileProfileMenu: шапка пользователя + пункты
 * Настройки / Пригласить / Тема (слайдер) / Язык (RU/EN переключатель). Кнопка
 * «Выйти» вынесена в правый верхний угол шапки (как на референсе) — не нужно
 * листать. Тех. поддержка вынесена в саму панель навигации, поэтому здесь её нет.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../ui/Avatar';
import { StatusPicker } from '../ui/StatusPicker';
import { type User } from '../../types';
import { type Theme } from '../../utils/theme';
import { type Locale } from '../../i18n';

interface Props {
  me: User;
  theme: Theme;
  language: Locale;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenInvite: () => void;
  onToggleTheme: () => void;
  onSetLanguage: (l: Locale) => void;
  onLogout: () => void;
}

export function NavProfilePopover({
  me, theme, language, onClose, onOpenSettings, onOpenInvite, onToggleTheme, onSetLanguage, onLogout,
}: Props) {
  const { t } = useTranslation(['settings', 'nav']);
  const isDark = theme === 'dark';
  const ref = useRef<HTMLDivElement>(null);

  // Закрытие по клику вне карточки и по Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="npPopover" ref={ref} role="dialog" aria-label={t('nav:common.profile')}>
      {/* Шапка пользователя + выход в углу */}
      <div className="npHead">
        <Avatar user={me} size={46} radius={14} presenceStatus={me.presence_status ?? null} />
        <div className="npHeadInfo">
          <div className="npHeadName">{me.display_name || me.username || t('nav:common.defaultUser')}</div>
          <div className="npHeadSub">{me.email ? me.email : `@${me.username || ''}`}</div>
        </div>
        <button className="npLogout" onClick={onLogout} aria-label={t('nav:common.logoutAria')} title={t('nav:common.logout')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>

      <div className="npDivider" />

      {/* Выставить статус (свободен / занят / не беспокоить) */}
      <div className="npStatus">
        <StatusPicker
          currentStatus={me.presence_status ?? null}
          currentNote={me.presence_note ?? null}
          currentExpiresAt={me.presence_expires_at ?? null}
        />
      </div>

      {/* Настройки */}
      <button className="npItem" onClick={() => { onClose(); onOpenSettings(); }}>
        <span className="npItemIcon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </span>
        <span className="npItemLabel">{t('nav:common.settings')}</span>
        <svg className="npItemChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
      </button>

      {/* Пригласить друзей */}
      <button className="npItem" onClick={() => { onClose(); onOpenInvite(); }}>
        <span className="npItemIcon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
          </svg>
        </span>
        <span className="npItemLabel">{t('nav:common.inviteFriends')}</span>
        <svg className="npItemChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
      </button>

      {/* Тема оформления — слайдер солнце/луна */}
      <button className="npItem" onClick={onToggleTheme}>
        <span className="npItemIcon">
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
        <span className="npItemLabel">{t('nav:common.appearance')}</span>
        <span className={`npThemeSwitch${isDark ? ' dark' : ''}`} aria-hidden>
          <span className="npThemeKnob">
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

      {/* Язык — карточки-флаги */}
      <div className="npLangBlock">
        <div className="npItem npItemStatic">
          <span className="npItemIcon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h7M8 3v2M6 5c0 4-2.5 6-4 7M5.5 9c0 2 2 3.5 4.5 4.5" />
              <path d="M13 20l4-9 4 9M14.5 17h5" />
            </svg>
          </span>
          <span className="npItemLabel">{t('language')}</span>
        </div>
        <div className="npLangOptions">
          <button
            className={`npLangCard${language === 'ru' ? ' active' : ''}`}
            onClick={() => onSetLanguage('ru')}
          >
            <span className="npLangFlag" aria-hidden>🇷🇺</span>
            {t('languageRussian')}
          </button>
          <button
            className={`npLangCard${language === 'en' ? ' active' : ''}`}
            onClick={() => onSetLanguage('en')}
          >
            <span className="npLangFlag" aria-hidden>🇬🇧</span>
            {t('languageEnglish')}
          </button>
        </div>
      </div>
    </div>
  );
}
