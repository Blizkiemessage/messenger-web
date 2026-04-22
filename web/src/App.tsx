/**
 * App.tsx — proper Zustand v5 selectors, no getState() during render.
 * ✅ Updated: closeGroup, transferAdmin wired to GroupInfoModal
 * ✅ Updated: admin leaving a group → closes group instead of removing chat
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
import { getMe } from './api/users';
import {
  createDirectChat,
  leaveGroup as apiLeaveGroup,
  deleteDirectChat as apiDeleteDirectChat,
  removeGroupMember as apiRemoveGroupMember,
  updateGroupChat as apiUpdateGroupChat,
  closeGroup as apiCloseGroup,
  transferAdminRights as apiTransferAdminRights,
  updateGroupAvatar as apiUpdateGroupAvatar,
  pinChat as apiPinChat,
  muteChat as apiMuteChat,
} from './api/chats';

export default function App() {
  // Session
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
  const deleteForEveryone = useAppStore(s => s.deleteForEveryone);
  const setDeleteForEveryone = useAppStore(s => s.setDeleteForEveryone);

  // Chats store
  const activeChat = useChatsStore(selectActiveChat);
  const selectedIds = useChatsStore(s => s.selectedIds);
  const hasSelection = selectedIds.size > 0;

  // Hooks
  useSocket();
  const { deleteSelected } = useMessages();

  // Load chats on login
  useEffect(() => {
    if (me) useChatsStore.getState().loadChats();
  }, [me]); // eslint-disable-line

  // Refresh user profile on mount — syncs settings changed on other devices
  // Also validates that the session cookie is still valid; clears local state on 401
  useEffect(() => {
    if (!useSessionStore.getState().me) return;
    getMe()
      .then(user => setSession(user, useSessionStore.getState().sessionId))
      .catch((err) => { if (err?.status === 401) clearSession(); });
  }, []); // eslint-disable-line

  // Auth gate
  if (!me) {
    return (
      <AuthScreen
        theme={theme}
        onThemeToggle={toggleTheme}
        onAuthenticated={(u, sid) => setSession(u, sid)}
      />
    );
  }

  async function onDeleteAccount() {
    await apiDeleteAccount();
    clearSession();
  }

  /**
   * ✅ Handle leave/delete chat action from sidebar context menu.
   * If the current user is the admin of a group → group gets closed (not removed).
   * The backend returns { closed: true } in that case, so we do NOT removeChat.
   * The socket 'chat-updated' event will update the chat state automatically.
   */
  async function onConfirmChatAction() {
    if (!chatActionConfirm) return;
    setChatActionBusy(true);
    try {
      if (chatActionConfirm.type === 'group') {
        const result = await apiLeaveGroup(chatActionConfirm.id);
        // If the group was closed (admin left), don't remove from list —
        // the socket event 'chat-updated' will update is_closed on the chat.
        if (!result.closed) {
          useChatsStore.getState().removeChat(chatActionConfirm.id);
        }
      } else {
        await apiDeleteDirectChat(chatActionConfirm.id);
        useChatsStore.getState().removeChat(chatActionConfirm.id);
      }
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
          forEveryone={deleteForEveryone}
          onToggle={setDeleteForEveryone}
          onConfirm={deleteSelected}
          onCancel={() => setShowDeleteConfirm(false)}
          busy={deleteBusy}
        />
      )}

      {showProfileSettings && (
        <ProfileSettingsModal
          me={me}
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
          onJumpToMessage={(msgId) => {
            setViewUserId(null);
            setTimeout(() => {
              const el = document.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 200);
          }}
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
          // ✅ Close group — group stays in list but is_closed=true
          onCloseGroup={async () => {
            await apiCloseGroup(activeChat.id);
            // Socket 'chat-updated' will update the store automatically
          }}
          // ✅ Update group avatar — sends system message to group
          onUpdateAvatar={async (url) => {
            const updated = await apiUpdateGroupAvatar(activeChat.id, url);
            useChatsStore.getState().upsertChat(updated);
          }}
          // ✅ Transfer admin — new admin takes over, system message is sent
          onTransferAdmin={async (userId) => {
            const updated = await apiTransferAdminRights(activeChat.id, userId);
            useChatsStore.getState().upsertChat(updated);
          }}
          onJumpToMessage={(msgId) => {
            setShowGroupInfo(false);
            setTimeout(() => {
              const el = document.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 200);
          }}
        />
      )}

      {chatCtxMenu && (
        <ChatContextMenu
          x={chatCtxMenu.x} y={chatCtxMenu.y} chat={chatCtxMenu.chat}
          onClose={() => setChatCtxMenu(null)}
          onDelete={() => setChatActionConfirm(chatCtxMenu.chat)}
          onLeave={() => setChatActionConfirm(chatCtxMenu.chat)}
          onPin={async () => {
            const chat = chatCtxMenu.chat;
            const store = useChatsStore.getState();
            // Enforce 5-chat limit on the frontend before calling API
            if (!chat.is_pinned && store.chats.filter(c => c.is_pinned).length >= 5) return;
            try {
              const result = await apiPinChat(chat.id);
              store.updateChatPatch(chat.id, result);
            } catch { /* silently ignore */ }
          }}
          onMute={async () => {
            const chat = chatCtxMenu.chat;
            try {
              const result = await apiMuteChat(chat.id);
              useChatsStore.getState().updateChatPatch(chat.id, result);
            } catch { /* silently ignore */ }
          }}
        />
      )}

      {chatActionConfirm && (
        <ChatActionConfirmModal
          chat={chatActionConfirm}
          meId={me.id}
          onConfirm={onConfirmChatAction}
          onCancel={() => setChatActionConfirm(null)}
          busy={chatActionBusy}
        />
      )}

      <div className={`layout${hasSelection ? ' selecting' : ''}${activeChat ? ' chatOpen' : ''}`}>
        <Sidebar />
        <main className="chatArea">
          <ChatArea />
        </main>
      </div>
    </>
  );
}
