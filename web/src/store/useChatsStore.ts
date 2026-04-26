/**
 * useChatsStore
 *
 * Single source of truth for:
 *   - chats list (with last message, unread counts)
 *   - active chat ID
 *   - messages for the active chat
 *   - message selection (multi-select for delete)
 *   - chat filter tab (all / groups / direct)
 *   - loading/error states
 *
 * Async actions (loadChats) call the API directly so components and hooks
 * can trigger data loading without passing callbacks through the tree.
 */

import { create } from 'zustand';
import { type Chat, type Message } from '../types';
import { getChats } from '../api/chats';

export type ChatFilter = 'all' | 'groups' | 'direct';

interface ChatsState {
  chats: Chat[];
  activeChatId: string | null;
  messages: Message[];
  selectedIds: Set<string>;
  chatFilter: ChatFilter;
  loadingChats: boolean;
  loadingMessages: boolean;
  dataError: string | null;

  // ── Chat list actions ──────────────────────────────────────────────────────
  setChats: (chats: Chat[]) => void;
  /** Add a chat if it doesn't exist, or replace it if it does.
   *  Preserves per-user fields (is_pinned, pin_order, is_muted) when the
   *  incoming chat comes from a socket broadcast (which doesn't carry them). */
  upsertChat: (chat: Chat) => void;
  /** Shallow-merge a partial update into a single chat (pin/mute toggles). */
  updateChatPatch: (chatId: string, patch: Partial<Chat>) => void;
  removeChat: (chatId: string) => void;
  setActiveChatId: (id: string | null) => void;

  // ── Message actions ────────────────────────────────────────────────────────
  setMessages: (msgs: Message[]) => void;
  appendMessage: (msg: Message) => void;
  prependMessages: (msgs: Message[]) => void;
  removeBulkMessages: (chatId: string, ids: string[]) => void;
  hasMoreMessages: boolean;
  setHasMoreMessages: (v: boolean) => void;

  // ── Selection ──────────────────────────────────────────────────────────────
  toggleSelect: (msgId: string) => void;
  clearSelection: () => void;

  // ── Filter ─────────────────────────────────────────────────────────────────
  /**
   * Change the active tab filter.
   * If the currently active chat is not visible in the new filter,
   * we clear activeChatId so the UI shows an empty state instead of
   * a blank/frozen chat area.
   */
  setChatFilter: (f: ChatFilter) => void;

  // ── Loading helpers ────────────────────────────────────────────────────────
  setLoadingChats: (v: boolean) => void;
  setLoadingMessages: (v: boolean) => void;
  setDataError: (e: string | null) => void;

  // ── Online presence ────────────────────────────────────────────────────────
  onlineUsers: Set<string>;
  setUserOnline: (userId: string) => void;
  setUserOffline: (userId: string, lastSeenAt?: number) => void;

  // ── Poll updates ───────────────────────────────────────────────────────────
  addMessage: (msg: Message) => void;
  updateMessagePoll: (messageId: string, poll: import('../types').Poll) => void;

  // ── Typing indicators ──────────────────────────────────────────────────────
  typingUsers: Map<string, string[]>; // chatId → [userId, ...]
  setTyping: (chatId: string, userId: string, isTyping: boolean) => void;

  // ── F3: Presence status ────────────────────────────────────────────────────
  /** Update presence status fields on all chat members matching userId. */
  updateMemberPresence: (userId: string, status: 'free' | 'busy' | 'dnd' | null, note: string | null, expires_at: number | null) => void;

  // ── Socket-driven updates ──────────────────────────────────────────────────
  /** Incoming new-message event: update last_message + unread count. */
  handleNewMessage: (msg: Message) => void;
  /** messages-deleted event: soft-remove from list + fix last_message. */
  handleMessagesDeleted: (chatId: string, ids: string[]) => void;
  /** chat-read event from a partner: advance partner_last_read_at. */
  handleChatRead: (chatId: string, userId: string, readAt: number, meId: string) => void;
  /** Optimistically mark a chat as read for the current user. */
  markChatRead: (chatId: string) => void;
  /** Update blocked_by_them on direct chat members when a block event arrives. */
  updateMemberBlockStatus: (blockerId: string, blocked: boolean) => void;

  // ── Optimistic send ────────────────────────────────────────────────────────
  /** Replace the temporary optimistic message (by tmpId) with the real server message. */
  confirmMessage: (tmpId: string, real: Message) => void;
  /** Mark the temporary optimistic message as failed so the user can retry. */
  failMessage: (tmpId: string) => void;

  // ── Scroll target (global search navigation) ───────────────────────────────
  scrollToMessageId: string | null;
  setScrollToMessageId: (id: string | null) => void;

  // ── Async ──────────────────────────────────────────────────────────────────
  /** Fetch the full chats list from the API and update state. */
  loadChats: () => Promise<void>;
}

export const useChatsStore = create<ChatsState>((set) => ({
  chats: [],
  activeChatId: null,
  messages: [],
  selectedIds: new Set(),
  chatFilter: 'all',
  loadingChats: false,
  loadingMessages: false,
  dataError: null,
  hasMoreMessages: false,
  onlineUsers: new Set<string>(),
  typingUsers: new Map<string, string[]>(),
  scrollToMessageId: null,

  // ── Chat list ──────────────────────────────────────────────────────────────

  setChats: (chats) => set({ chats }),

  upsertChat: (chat) => set(state => {
    const existing = state.chats.find(c => c.id === chat.id);
    // Preserve per-user pin/mute state when a socket broadcast overwrites the chat
    // (broadcasts are sent to all members and don't carry individual user state)
    const merged: Chat = existing ? {
      is_pinned: existing.is_pinned,
      pin_order: existing.pin_order,
      is_muted:  existing.is_muted,
      ...chat,
    } : chat;
    return {
      chats: existing
        ? state.chats.map(c => c.id === merged.id ? merged : c)
        : [merged, ...state.chats],
    };
  }),

  updateChatPatch: (chatId, patch) => set(state => ({
    chats: state.chats.map(c => c.id === chatId ? { ...c, ...patch } : c),
  })),

  removeChat: (chatId) => set(state => ({
    chats: state.chats.filter(c => c.id !== chatId),
    activeChatId: state.activeChatId === chatId ? null : state.activeChatId,
    messages: state.activeChatId === chatId ? [] : state.messages,
  })),

  setActiveChatId: (id) => set({ activeChatId: id, selectedIds: new Set() }),

  // ── Messages ───────────────────────────────────────────────────────────────

  setMessages: (messages) => set({ messages, hasMoreMessages: messages.length >= 50 }),

  appendMessage: (msg) => set(state => {
    if (state.messages.some(m => m.id === msg.id)) return state;
    return { messages: [...state.messages, msg] };
  }),

  prependMessages: (msgs) => set(state => ({
    messages: [...msgs, ...state.messages],
  })),

  setHasMoreMessages: (hasMoreMessages) => set({ hasMoreMessages }),

  removeBulkMessages: (chatId, ids) => set(state => ({
    messages: state.messages.filter(m => !(m.chat_id === chatId && ids.includes(m.id))),
    chats: state.chats.map(c => {
      if (c.id !== chatId) return c;
      return c.last_message && ids.includes(c.last_message.id)
        ? { ...c, last_message: null }
        : c;
    }),
  })),

  // ── Selection ──────────────────────────────────────────────────────────────

  toggleSelect: (msgId) => set(state => {
    const next = new Set(state.selectedIds);
    next.has(msgId) ? next.delete(msgId) : next.add(msgId);
    return { selectedIds: next };
  }),

  clearSelection: () => set({ selectedIds: new Set() }),

  // ── Filter ─────────────────────────────────────────────────────────────────

  setChatFilter: (chatFilter) => set(state => {
    // If the active chat won't be visible in the new filter, deselect it
    // so the ChatArea shows EmptyState instead of a stale/blank view.
    let activeChatId = state.activeChatId;
    if (activeChatId) {
      const activeChat = state.chats.find(c => c.id === activeChatId);
      if (activeChat) {
        const visibleInFilter =
          chatFilter === 'all' ||
          (chatFilter === 'groups' && activeChat.type === 'group') ||
          (chatFilter === 'direct' && activeChat.type === 'direct');
        if (!visibleInFilter) activeChatId = null;
      }
    }
    return { chatFilter, activeChatId };
  }),

  // ── Scroll target ──────────────────────────────────────────────────────────

  setScrollToMessageId: (scrollToMessageId) => set({ scrollToMessageId }),

  // ── Loading ────────────────────────────────────────────────────────────────

  setLoadingChats: (loadingChats) => set({ loadingChats }),
  setLoadingMessages: (loadingMessages) => set({ loadingMessages }),
  setDataError: (dataError) => set({ dataError }),

  // ── Online presence ────────────────────────────────────────────────────────

  setUserOnline: (userId) => set(state => {
    const next = new Set(state.onlineUsers);
    next.add(userId);
    return {
      onlineUsers: next,
      // Update last_seen_at in chat members so ChatHeader re-renders
      chats: state.chats.map(c => ({
        ...c,
        members: c.members.map(m => m.id === userId ? { ...m, last_seen_at: Date.now() } : m),
      })),
    };
  }),

  setUserOffline: (userId, lastSeenAt) => set(state => {
    const next = new Set(state.onlineUsers);
    next.delete(userId);
    return {
      onlineUsers: next,
      chats: state.chats.map(c => ({
        ...c,
        members: c.members.map(m =>
          m.id === userId && lastSeenAt !== undefined
            ? { ...m, last_seen_at: lastSeenAt }
            : m
        ),
      })),
    };
  }),

  updateMemberBlockStatus: (blockerId, blocked) => set(state => ({
    chats: state.chats.map(c => {
      if (c.type !== 'direct') return c;
      if (!c.members.some(m => m.id === blockerId)) return c;
      return {
        ...c,
        members: c.members.map(m =>
          m.id === blockerId ? { ...m, blocked_by_them: blocked } : m
        ),
      };
    }),
  })),

  // F3: update presence status for a user across all chats they're a member of
  updateMemberPresence: (userId, status, note, expires_at) => set(state => ({
    chats: state.chats.map(c => ({
      ...c,
      members: c.members.map(m =>
        m.id === userId
          ? { ...m, presence_status: status, presence_note: note, presence_expires_at: expires_at }
          : m
      ),
    })),
  })),

  // ── Poll updates ───────────────────────────────────────────────────────────

  addMessage: (msg) => set(state => {
    if (state.messages.some(m => m.id === msg.id)) return state;
    return { messages: [...state.messages, msg] };
  }),

  updateMessagePoll: (messageId, poll) => set(state => ({
    messages: state.messages.map(m => m.id === messageId ? { ...m, poll } : m),
  })),

  setTyping: (chatId, userId, isTyping) => set(state => {
    const next = new Map(state.typingUsers);
    const current = next.get(chatId) ?? [];
    if (isTyping) {
      if (!current.includes(userId)) next.set(chatId, [...current, userId]);
    } else {
      const filtered = current.filter(id => id !== userId);
      filtered.length > 0 ? next.set(chatId, filtered) : next.delete(chatId);
    }
    return { typingUsers: next };
  }),

  // ── Socket-driven updates ──────────────────────────────────────────────────

  handleNewMessage: (msg) => set(state => {
    const isActive = msg.chat_id === state.activeChatId;
    const chats = state.chats
      .map(c => c.id !== msg.chat_id ? c : {
        ...c,
        last_message: msg,
        unread_count: isActive ? 0 : (c.unread_count ?? 0) + 1,
      })
      .sort((a, b) => (b.last_message?.created_at ?? b.created_at) - (a.last_message?.created_at ?? a.created_at));
    return {
      chats,
      messages: isActive && !state.messages.some(m => m.id === msg.id)
        ? [...state.messages, msg]
        : state.messages,
    };
  }),

  handleMessagesDeleted: (chatId, ids) => set(state => ({
    messages: state.messages.filter(m => !(m.chat_id === chatId && ids.includes(m.id))),
    chats: state.chats.map(c => {
      if (c.id !== chatId) return c;
      return c.last_message && ids.includes(c.last_message.id)
        ? { ...c, last_message: null }
        : c;
    }),
  })),

  handleChatRead: (chatId, userId, readAt, meId) => set(state => {
    if (userId === meId) {
      // Own read event: recompute unread_count from currently loaded messages
      const newUnread = state.activeChatId === chatId
        ? state.messages.filter(m =>
            m.created_at > readAt && m.sender_id !== meId && !m.is_system
          ).length
        : 0;
      return {
        chats: state.chats.map(c => c.id !== chatId ? c : { ...c, unread_count: newUnread }),
      };
    }
    return {
      chats: state.chats.map(c => c.id !== chatId ? c : {
        ...c,
        partner_last_read_at: Math.max(c.partner_last_read_at ?? 0, readAt),
      }),
    };
  }),

  markChatRead: (chatId) => set(state => ({
    chats: state.chats.map(c => c.id === chatId ? { ...c, unread_count: 0 } : c),
  })),

  // ── Optimistic send ────────────────────────────────────────────────────────

  confirmMessage: (tmpId, real) => set(state => {
    // If the socket already delivered this message (race condition), just remove the tmp
    const alreadyDelivered = state.messages.some(m => m.id === real.id);
    return {
      messages: alreadyDelivered
        ? state.messages.filter(m => m.id !== tmpId)
        : state.messages.map(m => m.id === tmpId ? { ...real } : m),
      // Update last_message in chat list
      chats: state.chats.map(c => c.id === real.chat_id
        ? { ...c, last_message: real }
        : c
      ),
    };
  }),

  failMessage: (tmpId) => set(state => ({
    messages: state.messages.map(m => m.id === tmpId
      ? { ...m, _pending: false, _error: true }
      : m
    ),
  })),

  // ── Async ──────────────────────────────────────────────────────────────────

  loadChats: async () => {
    set({ loadingChats: true, dataError: null });
    try {
      const list = await getChats();
      set(state => ({
        chats: list,
        loadingChats: false,
        // Auto-select first chat only if nothing is active
        activeChatId: state.activeChatId ?? (list.length ? list[0].id : null),
      }));
    } catch (e: any) {
      // Auth errors are transient (race on startup) — don't surface them to the user
      if (e?.status === 401 || e?.status === 403) {
        set({ loadingChats: false });
        return;
      }
      set({ dataError: e?.message ?? 'Не удалось загрузить чаты', loadingChats: false });
    }
  },
}));

// ── Selectors (helpers for components) ────────────────────────────────────────

/** Derived: the currently active Chat object. */
export const selectActiveChat = (s: ChatsState): Chat | null =>
  s.chats.find(c => c.id === s.activeChatId) ?? null;

/** Derived: chats filtered by the current tab. */
export const selectFilteredChats = (s: ChatsState): Chat[] => {
  if (s.chatFilter === 'groups') return s.chats.filter(c => c.type === 'group');
  if (s.chatFilter === 'direct') return s.chats.filter(c => c.type === 'direct');
  return s.chats;
};

/** Derived: unique contact users from direct chats (for CreateGroupModal). */
export const selectContacts = (s: ChatsState, meId: string) => {
  const seen = new Set<string>();
  const list = [];
  for (const c of s.chats) {
    if (c.type !== 'direct') continue;
    const other = c.members.find(m => m.id !== meId);
    if (other && !seen.has(other.id)) { seen.add(other.id); list.push(other); }
  }
  return list;
};
