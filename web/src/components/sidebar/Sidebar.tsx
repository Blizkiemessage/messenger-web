/**
 * Sidebar — proper Zustand v5 selectors (no bare useStore() calls).
 */
import { useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useSessionStore } from '../../store/useSessionStore';
import { useChatsStore } from '../../store/useChatsStore';
import { useAppStore } from '../../store/useAppStore';
import { UserSearch } from './UserSearch';
import { FolderTabs } from './FolderTabs';
import { ChatList } from './ChatList';
import { SidebarBottom } from './SidebarBottom';
import { SupportModal } from '../modals/SupportModal';
import { updateMe } from '../../api/users';

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
    const byLastMsg = (a: typeof s.chats[0], b: typeof s.chats[0]) =>
      (b.last_message?.created_at ?? b.created_at) - (a.last_message?.created_at ?? a.created_at);
    if (s.chatFilter === 'groups') return [...s.chats.filter(c => c.type === 'group')].sort(byLastMsg);
    if (s.chatFilter === 'direct') return [...s.chats.filter(c => c.type === 'direct')].sort(byLastMsg);
    return [...s.chats].sort(byLastMsg);
  }));

  // App store — individual selectors
  const theme = useAppStore(s => s.theme);
  const showProfile = useAppStore(s => s.showProfile);
  const toggleProfile = useAppStore(s => s.toggleProfile);
  const toggleThemeAction = useAppStore(s => s.toggleTheme);
  const sessionUpdateMe = useSessionStore(s => s.updateMe);
  const toggleTheme = () => {
    toggleThemeAction();
    const next = useAppStore.getState().theme;
    updateMe({ theme: next }).then(u => sessionUpdateMe(u)).catch(() => {});
  };
  const setShowProfileSettings = useAppStore(s => s.setShowProfileSettings);
  const setShowCreateGroup = useAppStore(s => s.setShowCreateGroup);
  const setChatCtxMenu = useAppStore(s => s.setChatCtxMenu);

  const [showSupport, setShowSupport] = useState(false);

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
        onOpenSupport={() => {
          setShowSupport(true);
          useAppStore.getState().setShowProfile(false);
        }}
        onLogout={clearSession}
        onThemeToggle={toggleTheme}
      />
      {showSupport && <SupportModal me={me} onClose={() => setShowSupport(false)} />}
    </aside>
  );
}
