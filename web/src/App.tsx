/**
 * App.tsx — proper Zustand v5 selectors, no getState() during render.
 * ✅ Updated: closeGroup, transferAdmin wired to GroupInfoModal
 * ✅ Updated: admin leaving a group → closes group instead of removing chat
 */
import { useEffect, useState, useRef, lazy, Suspense, type CSSProperties } from 'react';
import { resolveChatBgCss } from './utils/appBackground';
import './app.css';

import { useSessionStore } from './store/useSessionStore';
import { useChatsStore, selectActiveChat } from './store/useChatsStore';
import { useAppStore } from './store/useAppStore';
import { useFolderStore } from './store/useFolderStore';
import { useDeepLinkStore } from './store/useDeepLinkStore';
import { isChatScoped } from './deeplinks';
import { acceptInvite, resolveInvite, type InviteInviter } from './api/invites';
import { useSocket } from './hooks/useSocket';
import { useMessages } from './hooks/useMessages';

import { AuthScreen } from './components/auth/AuthScreen';
import { Sidebar } from './components/sidebar/Sidebar';
import { NavRail } from './components/nav/NavRail';
import { ChatArea } from './components/chat/ChatArea';
import { useIsMobile } from './hooks/useIsMobile';
import { CallOverlay } from './components/call/CallOverlay';
import { ErrorBoundary } from './components/ErrorBoundary';
import { IncomingCallModal } from './components/call/IncomingCallModal';
import {
  DeleteConfirmModal,
  ChatActionConfirmModal,
  ChatContextMenu,
} from './components/modals/ConfirmModals';

// Heavy modals — loaded on demand, not part of the initial bundle
const UserProfileModal     = lazy(() => import('./components/modals/UserProfileModal').then(m => ({ default: m.UserProfileModal })));
const GroupInfoModal       = lazy(() => import('./components/modals/GroupInfoModal').then(m => ({ default: m.GroupInfoModal })));
const ProfileSettingsModal = lazy(() => import('./components/modals/ProfileSettingsModal').then(m => ({ default: m.ProfileSettingsModal })));
const CreateGroupModal     = lazy(() => import('./components/modals/CreateGroupModal').then(m => ({ default: m.CreateGroupModal })));
const InviteModal          = lazy(() => import('./components/modals/InviteModal').then(m => ({ default: m.InviteModal })));
const AssistantModal       = lazy(() => import('./components/modals/AssistantModal').then(m => ({ default: m.AssistantModal })));
const SupportModal         = lazy(() => import('./components/modals/SupportModal').then(m => ({ default: m.SupportModal })));

import { deleteAccount as apiDeleteAccount, authLogout } from './api/auth';
import { getMe, updateMe as apiUpdateMe } from './api/users';
import {
  createDirectChat,
  getSavedChat,
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
import { addChatToFolder as apiAddChatToFolder, removeChatFromFolder as apiRemoveChatFromFolder } from './api/folders';

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
  const showInvite = useAppStore(s => s.showInvite);
  const setShowInvite = useAppStore(s => s.setShowInvite);
  const showAssistant = useAppStore(s => s.showAssistant);
  const setShowAssistant = useAppStore(s => s.setShowAssistant);
  const showSupport = useAppStore(s => s.showSupport);
  const setShowSupport = useAppStore(s => s.setShowSupport);
  // NavRail (десктоп): вкладка навигации + всплывающее меню профиля
  const desktopTab = useAppStore(s => s.desktopTab);
  const setDesktopTab = useAppStore(s => s.setDesktopTab);
  const showProfile = useAppStore(s => s.showProfile);
  const toggleProfile = useAppStore(s => s.toggleProfile);
  const setShowProfile = useAppStore(s => s.setShowProfile);
  const isMobile = useIsMobile();
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

  // Folders store
  const folders = useFolderStore(s => s.folders);

  // Chats store
  const activeChat = useChatsStore(selectActiveChat);
  const selectedIds = useChatsStore(s => s.selectedIds);
  const messages = useChatsStore(s => s.messages);
  const hasSelection = selectedIds.size > 0;

  // True only when every selected message was sent by the current user
  const allOwnMessages = !!me && selectedIds.size > 0 &&
    [...selectedIds].every(id => messages.find(m => m.id === id)?.sender_id === me.id);

  // Hooks
  useSocket();
  const { deleteSelected } = useMessages();

  // Load chats on login
  useEffect(() => {
    if (me) useChatsStore.getState().loadChats();
  }, [me]); // eslint-disable-line

  // Предвыбранный интент ассистента (из deep-link `assistant?topic=`)
  const [assistantTopic, setAssistantTopic] = useState<string | undefined>(undefined);

  // ── Deep-links: глобальные действия (чат-привязанные исполняет ChatArea) ──
  const pendingDeepLink = useDeepLinkStore(s => s.pending);
  useEffect(() => {
    if (!pendingDeepLink || isChatScoped(pendingDeepLink)) return;
    const a = pendingDeepLink;
    const app = useAppStore.getState();
    switch (a.type) {
      case 'open-chat':        useChatsStore.getState().setActiveChatId(a.chatId); break;
      case 'open-message': {
        // Прыжок к сообщению-источнику (как из глобального поиска).
        useChatsStore.getState().setActiveChatId(a.chatId);
        useChatsStore.getState().setScrollToMessageId(a.messageId);
        break;
      }
      case 'open-saved': {
        const existing = useChatsStore.getState().chats.find(c => c.type === 'saved');
        if (existing) { useChatsStore.getState().setActiveChatId(existing.id); }
        else {
          getSavedChat().then(chat => {
            useChatsStore.getState().upsertChat(chat);
            useChatsStore.getState().setActiveChatId(chat.id);
          }).catch(() => {});
        }
        break;
      }
      case 'profile-settings':
      case 'appearance':       app.setShowProfileSettings(true); break;
      case 'create-group':     app.setShowCreateGroup(true); break;
      case 'find-friends': {
        const el = document.getElementById('blzSearch') as HTMLInputElement | null;
        el?.focus(); el?.scrollIntoView({ block: 'nearest' });
        break;
      }
      case 'invite':           useAppStore.getState().setShowInvite(true); break;
      case 'assistant':        setAssistantTopic(a.topic); app.setShowAssistant(true); break;
      case 'support':          app.setShowSupport(true); break;
    }
    useDeepLinkStore.getState().consume();
  }, [pendingDeepLink]);

  // ── Invite-token: приём ссылки `?invite=<token>` ─────────────────────────────
  const [invitedBy, setInvitedBy] = useState<InviteInviter | null>(null);
  const inviteDoneRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('invite');
    const token = urlToken || sessionStorage.getItem('blz.invite');
    if (!token) return;

    // Токен из URL сохраняем и сразу чистим адрес (на случай перезагрузки/SW).
    if (urlToken) {
      sessionStorage.setItem('blz.invite', token);
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (!me) {
      // Гость — показываем баннер «X приглашает вас» на экране входа.
      resolveInvite(token).then(r => setInvitedBy(r.inviter)).catch(() => {});
      return;
    }

    if (inviteDoneRef.current) return;
    inviteDoneRef.current = true;
    acceptInvite(token)
      .then(res => {
        sessionStorage.removeItem('blz.invite');
        setInvitedBy(null);
        if (res?.chat) {
          useChatsStore.getState().upsertChat(res.chat);
          // Явно открываем ЛС с пригласившим (после восстановления последнего чата).
          useChatsStore.getState().setActiveChatId(res.chat.id);
        }
      })
      .catch(err => {
        // 404 — ссылка отозвана/невалидна: не повторяем. Иначе оставляем токен,
        // чтобы попробовать ещё раз при следующем заходе.
        inviteDoneRef.current = false;
        if (err?.status === 404) sessionStorage.removeItem('blz.invite');
      });
  }, [me]);

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
        invitedBy={invitedBy}
      />
    );
  }

  async function onDeleteAccount(password: string, code?: string) {
    await apiDeleteAccount(password, code);
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

  // NavRail: смена темы с синком на бэкенд + выход из аккаунта
  const handleRailThemeToggle = () => {
    toggleTheme();
    const next = useAppStore.getState().theme;
    apiUpdateMe({ theme: next }).then(u => updateMe(u)).catch(() => {});
  };
  const handleLogout = async () => {
    try { await authLogout(); } catch { /* cookie might already be gone */ }
    clearSession();
  };

  return (
    <>
      <Suspense fallback={null}>
        {showCreateGroup && (
          <CreateGroupModal onClose={() => setShowCreateGroup(false)} />
        )}

        {showInvite && (
          <InviteModal onClose={() => setShowInvite(false)} />
        )}

        {showAssistant && (
          <AssistantModal
            topic={assistantTopic}
            onClose={() => { setShowAssistant(false); setAssistantTopic(undefined); }}
          />
        )}

        {showSupport && (
          <SupportModal me={me} onClose={() => setShowSupport(false)} />
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
        )}
      </Suspense>

      {showDeleteConfirm && (
        <DeleteConfirmModal
          count={selectedIds.size}
          forEveryone={deleteForEveryone}
          onToggle={setDeleteForEveryone}
          canDeleteForEveryone={allOwnMessages}
          onConfirm={deleteSelected}
          onCancel={() => setShowDeleteConfirm(false)}
          busy={deleteBusy}
        />
      )}

      {chatCtxMenu && (
        <ChatContextMenu
          x={chatCtxMenu.x} y={chatCtxMenu.y} chat={chatCtxMenu.chat}
          folders={folders}
          onClose={() => setChatCtxMenu(null)}
          onDelete={() => setChatActionConfirm(chatCtxMenu.chat)}
          onLeave={() => setChatActionConfirm(chatCtxMenu.chat)}
          onPin={async () => {
            const chat = chatCtxMenu.chat;
            const store = useChatsStore.getState();
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
          onAddToFolder={async (folderId) => {
            try {
              const updated = await apiAddChatToFolder(folderId, chatCtxMenu.chat.id);
              useFolderStore.setState(s => ({ folders: s.folders.map(f => f.id === folderId ? updated : f) }));
            } catch { /* silently ignore */ }
          }}
          onRemoveFromFolder={async (folderId) => {
            try {
              const updated = await apiRemoveChatFromFolder(folderId, chatCtxMenu.chat.id);
              useFolderStore.setState(s => ({ folders: s.folders.map(f => f.id === folderId ? updated : f) }));
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

      {/* ── E3: WebRTC call UI — rendered above everything ──────────────── */}
      {/* Scoped boundary: a crash in the call UI shouldn't take down the whole app. */}
      <ErrorBoundary scope="calls" fallback={null}>
        <IncomingCallModal />
        <CallOverlay />
      </ErrorBoundary>

      <div className={`layout${hasSelection ? ' selecting' : ''}${activeChat ? ' chatOpen' : ''}${!isMobile ? ' hasRail' : ''}`}>
        {!isMobile && (
          <NavRail
            me={me}
            theme={theme}
            activeTab={desktopTab}
            profileOpen={showProfile}
            onTab={setDesktopTab}
            onToggleProfile={toggleProfile}
            onCloseProfile={() => setShowProfile(false)}
            onOpenAssistant={() => { setShowProfile(false); setShowAssistant(true); }}
            onOpenSupport={() => { setShowProfile(false); setShowSupport(true); }}
            onOpenSettings={() => { setShowProfile(false); setShowProfileSettings(true); }}
            onOpenInvite={() => { setShowProfile(false); setShowInvite(true); }}
            onToggleTheme={handleRailThemeToggle}
            onLogout={handleLogout}
          />
        )}
        <Sidebar />
        <main
          className="chatArea"
          style={activeChat ? ({ '--chat-bg': resolveChatBgCss(activeChat) || undefined } as CSSProperties) : undefined}
        >
          <ChatArea />
        </main>
      </div>
    </>
  );
}
