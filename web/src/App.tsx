/**
 * App.tsx — proper Zustand v5 selectors, no getState() during render.
 * ✅ Updated: closeGroup, transferAdmin wired to GroupInfoModal
 * ✅ Updated: admin leaving a group → closes group instead of removing chat
 * ✅ Optimized: Grouped selectors, lazy loading modals
 */
import { useEffect, lazy, Suspense } from 'react';
import './app.css';

import { useSessionStore } from './store/useSessionStore';
import { useChatsStore, selectActiveChat } from './store/useChatsStore';
import { useAppStore } from './store/useAppStore';
import { useSocket } from './hooks/useSocket';
import { useMessages } from './hooks/useMessages';

import { AuthScreen } from './components/auth/AuthScreen';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChatArea } from './components/chat/ChatArea';

// Lazy load modals for better initial bundle size
const UserProfileModal = lazy(() => import('./components/modals/UserProfileModal'));
const GroupInfoModal = lazy(() => import('./components/modals/GroupInfoModal'));
const ProfileSettingsModal = lazy(() => import('./components/modals/ProfileSettingsModal'));
const CreateGroupModal = lazy(() => import('./components/modals/CreateGroupModal'));
const DeleteConfirmModal = lazy(() => import('./components/modals/ConfirmModals').then(m => ({ default: m.DeleteConfirmModal })));
const ChatActionConfirmModal = lazy(() => import('./components/modals/ConfirmModals').then(m => ({ default: m.ChatActionConfirmModal })));
const ChatContextMenu = lazy(() => import('./components/modals/ConfirmModals').then(m => ({ default: m.ChatContextMenu })));

import { deleteAccount as apiDeleteAccount } from './api/auth';
import {
  createDirectChat,
  leaveGroup as apiLeaveGroup,
  deleteDirectChat as apiDeleteDirectChat,
  removeGroupMember as apiRemoveGroupMember,
  updateGroupChat as apiUpdateGroupChat,
  closeGroup as apiCloseGroup,
  transferAdminRights as apiTransferAdminRights,
  updateGroupAvatar as apiUpdateGroupAvatar,
} from './api/chats';

export default function App() {
  // Session
  const token = useSessionStore(s => s.token);
  const me = useSessionStore(s => s.me);
  const setSession = useSessionStore(s => s.setSession);
  const clearSession = useSessionStore(s => s.clearSession);
  const updateMe = useSessionStore(s => s.updateMe);

  // App store — grouped selectors for modals (reduce re-renders)
  const { theme, toggleTheme } = useAppStore(s => ({ theme: s.theme, toggleTheme: s.toggleTheme }));
  const { showProfileSettings, setShowProfileSettings } = useAppStore(s => ({ 
    showProfileSettings: s.showProfileSettings, 
    setShowProfileSettings: s.setShowProfileSettings 
  }));
  const { showCreateGroup, setShowCreateGroup } = useAppStore(s => ({ 
    showCreateGroup: s.showCreateGroup, 
    setShowCreateGroup: s.setShowCreateGroup 
  }));
  const { showGroupInfo, setShowGroupInfo } = useAppStore(s => ({ 
    showGroupInfo: s.showGroupInfo, 
    setShowGroupInfo: s.setShowGroupInfo 
  }));
  const { showDeleteConfirm, setShowDeleteConfirm } = useAppStore(s => ({ 
    showDeleteConfirm: s.showDeleteConfirm, 
    setShowDeleteConfirm: s.setShowDeleteConfirm 
  }));
  const { viewUserId, setViewUserId } = useAppStore(s => ({ 
    viewUserId: s.viewUserId, 
    setViewUserId: s.setViewUserId 
  }));
  const { chatCtxMenu, setChatCtxMenu } = useAppStore(s => ({ 
    chatCtxMenu: s.chatCtxMenu, 
    setChatCtxMenu: s.setChatCtxMenu 
  }));
  const { chatActionConfirm, setChatActionConfirm } = useAppStore(s => ({ 
    chatActionConfirm: s.chatActionConfirm, 
    setChatActionConfirm: s.setChatActionConfirm 
  }));
  const { chatActionBusy, setChatActionBusy } = useAppStore(s => ({ 
    chatActionBusy: s.chatActionBusy, 
    setChatActionBusy: s.setChatActionBusy 
  }));
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
        <Suspense fallback={null}>
          <CreateGroupModal onClose={() => setShowCreateGroup(false)} />
        </Suspense>
      )}

      {showDeleteConfirm && (
        <Suspense fallback={null}>
          <DeleteConfirmModal
            count={selectedIds.size}
            onConfirm={deleteSelected}
            onCancel={() => setShowDeleteConfirm(false)}
            busy={deleteBusy}
          />
        </Suspense>
      )}

      {showProfileSettings && (
        <Suspense fallback={null}>
          <ProfileSettingsModal
            me={me}
            token={token}
            onClose={() => setShowProfileSettings(false)}
            onUpdate={updateMe}
            onDeleteAccount={onDeleteAccount}
          />
        </Suspense>
      )}

      {viewUserId && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {showGroupInfo && activeChat && (
        <Suspense fallback={null}>
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
            onCloseGroup={async () => {
              await apiCloseGroup(activeChat.id);
            }}
            onUpdateAvatar={async (url) => {
              const updated = await apiUpdateGroupAvatar(activeChat.id, url);
              useChatsStore.getState().upsertChat(updated);
            }}
            onTransferAdmin={async (userId) => {
              const updated = await apiTransferAdminRights(activeChat.id, userId);
              useChatsStore.getState().upsertChat(updated);
            }}
          />
        </Suspense>
      )}

      {chatCtxMenu && (
        <Suspense fallback={null}>
          <ChatContextMenu
            x={chatCtxMenu.x} y={chatCtxMenu.y} chat={chatCtxMenu.chat}
            onClose={() => setChatCtxMenu(null)}
            onDelete={() => setChatActionConfirm(chatCtxMenu.chat)}
            onLeave={() => setChatActionConfirm(chatCtxMenu.chat)}
          />
        </Suspense>
      )}

      {chatActionConfirm && (
        <Suspense fallback={null}>
          <ChatActionConfirmModal
            chat={chatActionConfirm}
            meId={me.id}
            onConfirm={onConfirmChatAction}
            onCancel={() => setChatActionConfirm(null)}
            busy={chatActionBusy}
          />
        </Suspense>
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
