/**
 * MobileSidebar — мобильная оболочка списка (телефоны ≤700px).
 *
 * Композиция по референсу: цветная шапка (акцент) + закруглённая карточка с
 * контентом + нижнее меню (MobileNav). Контент карточки зависит от активной
 * вкладки нижнего меню: «Чаты» (папки + список), «Звонки» (заглушка),
 * «Поиск» (UserSearch). «Ассистент» и «Профиль» — модалки (открываются из
 * нижнего меню, вкладку не переключают).
 *
 * Десктоп этот компонент не использует — там обычный сайдбар (см. Sidebar.tsx).
 * Бизнес-логику (фильтрация чатов, папки) НЕ дублирует — получает готовые
 * данные пропсами из Sidebar.
 */
import { type User, type Chat, type ChatFolder } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { FolderTabs } from './FolderTabs';
import { ChatList } from './ChatList';
import { UserSearch } from './UserSearch';
import { MobileNav } from './MobileNav';

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
  onOpenProfile: () => void;
  profileActive: boolean;
}

const TITLES: Record<string, string> = {
  chats: 'Чаты',
  calls: 'Звонки',
  search: 'Поиск',
};

export function MobileSidebar({
  me, filteredChats, activeChatId, chatFilter, loadingChats, dataError, folders,
  onFilterChange, onSelectChat, onContextMenu, onNewGroup, onSavedMessages,
  onCreateFolder, onEditFolder, onOpenAssistant, onOpenProfile, profileActive,
}: Props) {
  const mobileTab = useAppStore(s => s.mobileTab);
  const setMobileTab = useAppStore(s => s.setMobileTab);

  return (
    <aside className="sidebar mobileShell">
      {/* ── Цветная шапка (акцент) ─────────────────────────────────────── */}
      <header className="mTopBar">
        <div className="mTopSpacer" />
        <h1 className="mTopTitle">{TITLES[mobileTab] ?? 'Чаты'}</h1>
        <button
          className="mTopAction"
          onClick={onNewGroup}
          aria-label="Новая группа"
          title="Новая группа"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
          </svg>
        </button>
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

        {mobileTab === 'calls' && (
          <div className="mCallsEmpty">
            <div className="mCallsEmptyIcon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </div>
            <div className="mCallsEmptyTitle">История звонков</div>
            <div className="mCallsEmptySub">Здесь скоро появятся ваши звонки</div>
          </div>
        )}
      </div>

      {/* ── Нижнее меню ────────────────────────────────────────────────── */}
      <MobileNav
        me={me}
        activeTab={mobileTab}
        onTab={setMobileTab}
        onAssistant={onOpenAssistant}
        onProfile={onOpenProfile}
        profileActive={profileActive}
      />
    </aside>
  );
}
