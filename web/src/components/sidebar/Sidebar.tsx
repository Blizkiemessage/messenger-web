/**
 * Sidebar — proper Zustand v5 selectors (no bare useStore() calls).
 */
import { useShallow } from 'zustand/shallow';
import { useSessionStore } from '../../store/useSessionStore';
import { useChatsStore } from '../../store/useChatsStore';
import { useAppStore } from '../../store/useAppStore';
import { UserSearch } from './UserSearch';
import { FolderTabs } from './FolderTabs';
import { ChatList } from './ChatList';
import { SidebarBottom } from './SidebarBottom';

export function Sidebar() {
  // Session
  const me = useSessionStore(s => s.me)!;
  const clearSession = useSessionStore(s => s.clearSession);

  // Chats store — individual selectors to avoid re-render on unrelated changes
  const chatFilter = useChatsStore(s => s.chatFilter);
  const activeChatId = useChatsStore(s => s.activeChatId);
  const loadingChats = useChatsStore(s => s.loadingChats);
  const dataError = useChatsStore(s => s.dataError);
  const setChatFilter = useChatsStore(s => s.setChatFilter);
  const setActiveChatId = useChatsStore(s => s.setActiveChatId);
  const filteredChats = useChatsStore(useShallow(s => {
    if (s.chatFilter === 'groups') return s.chats.filter(c => c.type === 'group');
    if (s.chatFilter === 'direct') return s.chats.filter(c => c.type === 'direct');
    return s.chats;
  }));

  // App store — individual selectors
  const theme = useAppStore(s => s.theme);
  const showProfile = useAppStore(s => s.showProfile);
  const toggleProfile = useAppStore(s => s.toggleProfile);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const setShowProfileSettings = useAppStore(s => s.setShowProfileSettings);
  const setShowCreateGroup = useAppStore(s => s.setShowCreateGroup);
  const setChatCtxMenu = useAppStore(s => s.setChatCtxMenu);

  return (
    <aside className="sidebar">
      <UserSearch />
      <FolderTabs
        filter={chatFilter}
        onFilterChange={setChatFilter}
        onNewGroup={() => setShowCreateGroup(true)}
      />
      <ChatList
        chats={filteredChats}
        meId={me.id}
        activeChatId={activeChatId}
        filter={chatFilter}
        loading={loadingChats}
        error={dataError}
        onSelect={setActiveChatId}
        onContextMenu={(e, chat) => setChatCtxMenu({ x: e.clientX, y: e.clientY, chat })}
      />
      <SidebarBottom
        me={me}
        theme={theme}
        showProfile={showProfile}
        onToggleProfile={toggleProfile}
        onOpenSettings={() => {
          setShowProfileSettings(true);
          useAppStore.getState().setShowProfile(false);
        }}
        onLogout={clearSession}
        onThemeToggle={toggleTheme}
      />
    </aside>
  );
}
