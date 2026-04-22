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
import { getSavedChat } from '../../api/chats';
import { authLogout } from '../../api/auth';

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
    let chats = [...s.chats];
    if (s.chatFilter === 'groups') chats = chats.filter(c => c.type === 'group');
    else if (s.chatFilter === 'direct') chats = chats.filter(c => c.type === 'direct');

    return chats.sort((a, b) => {
      const ap = a.is_pinned ? 1 : 0;
      const bp = b.is_pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;                              // pinned first
      if (a.is_pinned && b.is_pinned)                            // among pinned: by pin_order asc
        return (a.pin_order ?? 999) - (b.pin_order ?? 999);
      // non-pinned: by last message time desc
      return (b.last_message?.created_at ?? b.created_at) - (a.last_message?.created_at ?? a.created_at);
    });
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

  const handleSavedMessages = async () => {
    const existing = useChatsStore.getState().chats.find(c => c.type === 'saved');
    if (existing) { setActiveChatId(existing.id); return; }
    try {
      const chat = await getSavedChat();
      useChatsStore.getState().upsertChat(chat);
      setActiveChatId(chat.id);
    } catch { /* ignore — network issues */ }
  };

  return (
    <aside className="sidebar">
      <UserSearch />
      <FolderTabs
        filter={chatFilter}
        onFilterChange={setChatFilter}
        onNewGroup={() => setShowCreateGroup(true)}
        onSavedMessages={handleSavedMessages}
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
        onLogout={async () => {
          try { await authLogout(); } catch { /* cookie might already be gone */ }
          clearSession();
        }}
        onThemeToggle={toggleTheme}
      />
      {showSupport && <SupportModal me={me} onClose={() => setShowSupport(false)} />}
    </aside>
  );
}
