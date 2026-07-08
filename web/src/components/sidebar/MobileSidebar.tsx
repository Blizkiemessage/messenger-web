/**
 * MobileSidebar — мобильная оболочка списка (телефоны ≤700px).
 *
 * Композиция по референсу: цветная шапка (акцент) + закруглённая карточка с
 * контентом + нижнее меню (MobileNav). Контент карточки зависит от активной
 * вкладки нижнего меню: «Чаты» (папки + список), «Звонки» (CallHistoryList),
 * «Поиск» (UserSearch). «Ассистент» и «Профиль» — модалки (открываются из
 * нижнего меню, вкладку не переключают).
 *
 * Десктоп этот компонент не использует — там обычный сайдбар (см. Sidebar.tsx).
 * Бизнес-логику (фильтрация чатов, папки) НЕ дублирует — получает готовые
 * данные пропсами из Sidebar.
 */
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type User, type Chat, type ChatFolder } from '../../types';
import { type Theme } from '../../utils/theme';
import { type Locale } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { FolderTabs } from './FolderTabs';
import { ChatList } from './ChatList';
import { UserSearch } from './UserSearch';
import { MobileNav } from './MobileNav';
import { MobileProfileMenu } from './MobileProfileMenu';
import { CallHistoryList } from '../call/CallHistoryList';

interface Props {
  me: User;
  filteredChats: Chat[];
  activeChatId: string | null;
  chatFilter: string;
  loadingChats: boolean;
  dataError: string | null;
  folders: ChatFolder[];
  onFilterChange: (f: string) => void;
  onSelectChat: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, chat: Chat) => void;
  onNewGroup: () => void;
  onSavedMessages: () => void;
  onCreateFolder: () => void;
  onEditFolder: (folder: ChatFolder) => void;
  onOpenAssistant: () => void;
  onOpenSettings: () => void;
  onOpenSupport: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  language: Locale;
  onSetLanguage: (l: Locale) => void;
  onLogout: () => void;
  settingsActive: boolean;
}

export function MobileSidebar({
  me, filteredChats, activeChatId, chatFilter, loadingChats, dataError, folders,
  onFilterChange, onSelectChat, onContextMenu, onNewGroup, onSavedMessages,
  onCreateFolder, onEditFolder, onOpenAssistant, onOpenSettings, onOpenSupport,
  theme, onToggleTheme, language, onSetLanguage, onLogout, settingsActive,
}: Props) {
  const { t } = useTranslation('nav');
  const TITLES: Record<string, string> = {
    chats: t('common.chats'),
    calls: t('common.calls'),
    search: t('common.search'),
  };
  const mobileTab = useAppStore(s => s.mobileTab);
  const setMobileTab = useAppStore(s => s.setMobileTab);

  const [showCompose, setShowCompose] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const composeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showCompose) return;
    function onOutside(e: MouseEvent) {
      if (composeRef.current && !composeRef.current.contains(e.target as Node)) {
        setShowCompose(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showCompose]);

  return (
    <aside className="sidebar mobileShell">
      {/* ── Цветная шапка (акцент) ─────────────────────────────────────── */}
      <header className="mTopBar">
        {/* Выход из аккаунта (дверь + стрелка) → экран входа */}
        <button
          className="mTopAction mTopLogout"
          onClick={onLogout}
          aria-label={t('common.logoutAria')}
          title={t('common.logout')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>

        <h1 className="mTopTitle">{TITLES[mobileTab] ?? t('common.chats')}</h1>

        {/* Создать (карандаш) → меню: Новая группа / Сохранённые */}
        <div className="mComposeWrap" ref={composeRef}>
          <button
            className={`mTopAction${showCompose ? ' active' : ''}`}
            onClick={() => setShowCompose(v => !v)}
            aria-label={t('common.create')}
            title={t('common.create')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>

          {showCompose && (
            <div className="mComposeMenu">
              <button
                className="mComposeItem"
                onClick={() => { setShowCompose(false); onNewGroup(); }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                {t('common.newGroup')}
              </button>
              <button
                className="mComposeItem"
                onClick={() => { setShowCompose(false); onSavedMessages(); }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                {t('common.saved')}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Закруглённая карточка с контентом ──────────────────────────── */}
      <div className="mCard">
        {mobileTab === 'chats' && (
          <>
            <FolderTabs
              activeFilter={chatFilter}
              folders={folders}
              onFilterChange={onFilterChange}
              onNewGroup={onNewGroup}
              onSavedMessages={onSavedMessages}
              onCreateFolder={onCreateFolder}
              onEditFolder={onEditFolder}
            />
            <ChatList
              chats={filteredChats}
              meId={me.id}
              activeChatId={activeChatId}
              filter={chatFilter}
              loading={loadingChats}
              error={dataError}
              onSelect={onSelectChat}
              onContextMenu={onContextMenu}
            />
          </>
        )}

        {mobileTab === 'search' && <UserSearch />}

        {mobileTab === 'calls' && <CallHistoryList />}
      </div>

      {/* ── Нижнее меню ────────────────────────────────────────────────── */}
      <MobileNav
        me={me}
        activeTab={mobileTab}
        onTab={setMobileTab}
        onAssistant={onOpenAssistant}
        onProfile={() => setShowProfileMenu(true)}
        profileActive={showProfileMenu || settingsActive}
      />

      {/* Стеклянное меню профиля (по тапу «Профиль») */}
      {showProfileMenu && (
        <MobileProfileMenu
          me={me}
          theme={theme}
          language={language}
          onClose={() => setShowProfileMenu(false)}
          onOpenSettings={onOpenSettings}
          onOpenSupport={onOpenSupport}
          onToggleTheme={onToggleTheme}
          onSetLanguage={onSetLanguage}
          onLogout={onLogout}
        />
      )}
    </aside>
  );
}
