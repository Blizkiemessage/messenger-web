/**
 * App.tsx — proper Zustand v5 selectors, no getState() during render.
 */
import { useEffect } from 'react';
import './app.css';

import { useSessionStore } from './store/useSessionStore';
import { useChatsStore, selectActiveChat } from './store/useChatsStore';
import { useAppStore } from './store/useAppStore';
import { useSocket } from './hooks/useSocket';
import { useMessages } from './hooks/useMessages';

import { AuthScreen } from './components/auth/AuthScreen';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChatArea } from './components/chat/ChatArea';
import { UserProfileModal } from './components/modals/UserProfileModal';
import { GroupInfoModal } from './components/modals/GroupInfoModal';
import { ProfileSettingsModal } from './components/modals/ProfileSettingsModal';
import { CreateGroupModal } from './components/modals/CreateGroupModal';
import {
  DeleteConfirmModal,
  ChatActionConfirmModal,
  ChatContextMenu,
} from './components/modals/ConfirmModals';

import { deleteAccount as apiDeleteAccount } from './api/auth';
import { createDirectChat, leaveGroup as apiLeaveGroup, deleteDirectChat as apiDeleteDirectChat, removeGroupMember as apiRemoveGroupMember, updateGroupChat as apiUpdateGroupChat } from './api/chats';

export default function App() {
  // Session
  const token = useSessionStore(s => s.token);
  const me = useSessionStore(s => s.me);
  const setSession = useSessionStore(s => s.setSession);
  const clearSession = useSessionStore(s => s.clearSession);
  const updateMe = useSessionStore(s => s.updateMe);

  // App store — individual selectors
  const theme = useAppStore(s => s.theme);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const showProfileSettings = useAppStore(s => s.showProfileSettings);
  const setShowProfileSettings = useAppStore(s => s.setShowProfileSettings);
  const showCreateGroup = useAppStore(s => s.showCreateGroup);
  const setShowCreateGroup = useAppStore(s => s.setShowCreateGroup);
  const showGroupInfo = useAppStore(s => s.showGroupInfo);
  const setShowGroupInfo = useAppStore(s => s.setShowGroupInfo);
  const showDeleteConfirm = useAppStore(s => s.showDeleteConfirm);
  const setShowDeleteConfirm = useAppStore(s => s.setShowDeleteConfirm);
  const viewUserId = useAppStore(s => s.viewUserId);
  const setViewUserId = useAppStore(s => s.setViewUserId);
  const chatCtxMenu = useAppStore(s => s.chatCtxMenu);
  const setChatCtxMenu = useAppStore(s => s.setChatCtxMenu);
  const chatActionConfirm = useAppStore(s => s.chatActionConfirm);
  const setChatActionConfirm = useAppStore(s => s.setChatActionConfirm);
  const chatActionBusy = useAppStore(s => s.chatActionBusy);
  const setChatActionBusy = useAppStore(s => s.setChatActionBusy);
  const deleteBusy = useAppStore(s => s.deleteBusy);

  // Chats store
  const activeChat = useChatsStore(selectActiveChat);
  const selectedIds = useChatsStore(s => s.selectedIds);
  const hasSelection = selectedIds.size > 0;

  // Hooks
  useSocket();
  const { deleteSelected } = useMessages();

  // Load chats on login
  useEffect(() => {
    if (token) useChatsStore.getState().loadChats();
  }, [token]); // eslint-disable-line

  // Auth gate
  if (!token || !me) {
    return (
      <AuthScreen
        theme={theme}
        onThemeToggle={toggleTheme}
        onAuthenticated={(t, u) => setSession(t, u)}
      />
    );
  }

  async function onDeleteAccount() {
    await apiDeleteAccount();
    clearSession();
  }

  async function onConfirmChatAction() {
    if (!chatActionConfirm) return;
    setChatActionBusy(true);
    try {
      if (chatActionConfirm.type === 'group') await apiLeaveGroup(chatActionConfirm.id);
      else await apiDeleteDirectChat(chatActionConfirm.id);
      useChatsStore.getState().removeChat(chatActionConfirm.id);
      setChatActionConfirm(null);
    } catch { /* ignore */ }
    finally { setChatActionBusy(false); }
  }

  return (
    <>
      {showCreateGroup && (
        <CreateGroupModal onClose={() => setShowCreateGroup(false)} />
      )}

      {showDeleteConfirm && (
        <DeleteConfirmModal
          count={selectedIds.size}
          onConfirm={deleteSelected}
          onCancel={() => setShowDeleteConfirm(false)}
          busy={deleteBusy}
        />
      )}

      {showProfileSettings && (
        <ProfileSettingsModal
          me={me}
          token={token}
          onClose={() => setShowProfileSettings(false)}
          onUpdate={updateMe}
          onDeleteAccount={onDeleteAccount}
        />
      )}

      {viewUserId && (
        <UserProfileModal
          userId={viewUserId}
          onClose={() => setViewUserId(null)}
          onStartChat={viewUserId !== me.id ? async (u) => {
            const chat = await createDirectChat(u.id);
            useChatsStore.getState().upsertChat(chat);
            useChatsStore.getState().setActiveChatId(chat.id);
            setViewUserId(null);
          } : undefined}
        />
      )}

      {showGroupInfo && activeChat && (
        <GroupInfoModal
          chat={activeChat}
          onClose={() => setShowGroupInfo(false)}
          onViewUser={id => { setShowGroupInfo(false); setViewUserId(id); }}
          meId={me.id}
          onUpdateChat={async (name, description) => {
            const updated = await apiUpdateGroupChat(activeChat.id, { name, description });
            useChatsStore.getState().upsertChat(updated);
          }}
          onRemoveMember={async (userId) => {
            await apiRemoveGroupMember(activeChat.id, userId);
          }}
        />
      )}

      {chatCtxMenu && (
        <ChatContextMenu
          x={chatCtxMenu.x} y={chatCtxMenu.y} chat={chatCtxMenu.chat}
          onClose={() => setChatCtxMenu(null)}
          onDelete={() => setChatActionConfirm(chatCtxMenu.chat)}
          onLeave={() => setChatActionConfirm(chatCtxMenu.chat)}
        />
      )}

      {chatActionConfirm && (
        <ChatActionConfirmModal
          chat={chatActionConfirm}
          onConfirm={onConfirmChatAction}
          onCancel={() => setChatActionConfirm(null)}
          busy={chatActionBusy}
        />
      )}

      <div className={`layout${hasSelection ? ' selecting' : ''}`}>
        <Sidebar />
        <main className="chatArea">
          <ChatArea />
        </main>
      </div>
    </>
  );
}
