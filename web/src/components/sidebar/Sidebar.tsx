import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { useSessionStore } from '../../store/useSessionStore';
import { useChatsStore } from '../../store/useChatsStore';
import { useAppStore } from '../../store/useAppStore';
import { useFolderStore } from '../../store/useFolderStore';
import { type ChatFolder } from '../../types';
import { useIsMobile } from '../../hooks/useIsMobile';
import { UserSearch } from './UserSearch';
import { FolderTabs } from './FolderTabs';
import { FolderModal } from './FolderModal';
import { ChatList } from './ChatList';
import { SidebarBottom } from './SidebarBottom';
import { MobileSidebar } from './MobileSidebar';
import { AssistantOrb } from '../ui/AssistantOrb';
import { updateMe } from '../../api/users';
import { getSavedChat } from '../../api/chats';
import { authLogout } from '../../api/auth';

export function Sidebar() {
  const me = useSessionStore(s => s.me)!;
  const clearSession = useSessionStore(s => s.clearSession);

  const chatFilter = useChatsStore(s => s.chatFilter);
  const activeChatId = useChatsStore(s => s.activeChatId);
  const loadingChats = useChatsStore(s => s.loadingChats);
  const dataError = useChatsStore(s => s.dataError);
  const setChatFilter = useChatsStore(s => s.setChatFilter);
  const setActiveChatId = useChatsStore(s => s.setActiveChatId);

  const folders = useFolderStore(s => s.folders);
  const loaded = useFolderStore(s => s.loaded);
  const loadFolders = useFolderStore(s => s.loadFolders);
  const createFolderAction = useFolderStore(s => s.createFolder);
  const updateFolderAction = useFolderStore(s => s.updateFolder);
  const deleteFolderAction = useFolderStore(s => s.deleteFolder);

  const filteredChats = useChatsStore(useShallow(s => {
    let chats = [...s.chats];

    if (chatFilter === 'groups') {
      chats = chats.filter(c => c.type === 'group');
    } else if (chatFilter === 'direct') {
      chats = chats.filter(c => c.type === 'direct');
    } else if (chatFilter.startsWith('folder:')) {
      const folderId = parseInt(chatFilter.slice(7), 10);
      const folder = useFolderStore.getState().folders.find(f => f.id === folderId);
      const folderChatIds = new Set(folder?.chat_ids ?? []);
      chats = chats.filter(c => folderChatIds.has(c.id));
    }

    return chats.sort((a, b) => {
      const ap = a.is_pinned ? 1 : 0;
      const bp = b.is_pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (a.is_pinned && b.is_pinned)
        return (a.pin_order ?? 999) - (b.pin_order ?? 999);
      return (b.last_message?.created_at ?? b.created_at) - (a.last_message?.created_at ?? a.created_at);
    });
  }));

  const isMobile = useIsMobile();
  const showProfileSettings = useAppStore(s => s.showProfileSettings);
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
  const setShowInvite = useAppStore(s => s.setShowInvite);
  const setShowAssistant = useAppStore(s => s.setShowAssistant);
  const setShowSupport = useAppStore(s => s.setShowSupport);
  const setChatCtxMenu = useAppStore(s => s.setChatCtxMenu);

  const [folderModal, setFolderModal] = useState<{ folder?: ChatFolder } | null>(null);

  useEffect(() => {
    if (!loaded) loadFolders();
  }, [loaded, loadFolders]);

  const handleSavedMessages = async () => {
    const existing = useChatsStore.getState().chats.find(c => c.type === 'saved');
    if (existing) { setActiveChatId(existing.id); return; }
    try {
      const chat = await getSavedChat();
      useChatsStore.getState().upsertChat(chat);
      setActiveChatId(chat.id);
    } catch { /* ignore */ }
  };

  const handleCreateFolder = async (name: string, emoji: string) => {
    await createFolderAction(name, emoji);
  };

  const handleUpdateFolder = async (name: string, emoji: string) => {
    const folder = folderModal?.folder;
    if (!folder) return;
    await updateFolderAction(folder.id, { name, emoji });
    // If this folder is currently active and was renamed, stay on it
  };

  const handleDeleteFolder = async () => {
    const folder = folderModal?.folder;
    if (!folder) return;
    await deleteFolderAction(folder.id);
    // If user was viewing this folder, switch to "all"
    if (chatFilter === `folder:${folder.id}`) setChatFilter('all');
  };

  const folderModalEl = folderModal !== null && (
    <FolderModal
      folder={folderModal.folder ?? null}
      onSave={folderModal.folder ? handleUpdateFolder : handleCreateFolder}
      onDelete={folderModal.folder ? handleDeleteFolder : undefined}
      onClose={() => setFolderModal(null)}
    />
  );

  // ── Мобильная оболочка (телефоны): шапка + карточка + нижнее меню ──────
  if (isMobile) {
    return (
      <>
        <MobileSidebar
          me={me}
          filteredChats={filteredChats}
          activeChatId={activeChatId}
          chatFilter={chatFilter}
          loadingChats={loadingChats}
          dataError={dataError}
          folders={folders}
          onFilterChange={setChatFilter}
          onSelectChat={setActiveChatId}
          onContextMenu={(e, chat) => setChatCtxMenu({ x: e.clientX, y: e.clientY, chat })}
          onNewGroup={() => setShowCreateGroup(true)}
          onSavedMessages={handleSavedMessages}
          onCreateFolder={() => setFolderModal({})}
          onEditFolder={folder => setFolderModal({ folder })}
          onOpenAssistant={() => setShowAssistant(true)}
          onOpenSettings={() => setShowProfileSettings(true)}
          onOpenSupport={() => setShowSupport(true)}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={async () => {
            try { await authLogout(); } catch { /* cookie might already be gone */ }
            clearSession();
          }}
          settingsActive={showProfileSettings}
        />
        {folderModalEl}
      </>
    );
  }

  // ── Десктоп: классический сайдбар ─────────────────────────────────────
  return (
    <aside className="sidebar">
      <UserSearch />
      <FolderTabs
        activeFilter={chatFilter}
        folders={folders}
        onFilterChange={setChatFilter}
        onNewGroup={() => setShowCreateGroup(true)}
        onSavedMessages={handleSavedMessages}
        onCreateFolder={() => setFolderModal({})}
        onEditFolder={folder => setFolderModal({ folder })}
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
        onOpenInvite={() => {
          setShowInvite(true);
          useAppStore.getState().setShowProfile(false);
        }}
        onOpenAssistant={() => {
          setShowAssistant(true);
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
      {/* Светящийся орб-вход в ассистента — всегда на виду (desktop + список чатов). */}
      <AssistantOrb onClick={() => setShowAssistant(true)} variant="asstOrbSidebar" />
      {folderModalEl}
    </aside>
  );
}
