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
  /** Add a chat if it doesn't exist, or replace it if it does. */
  upsertChat: (chat: Chat) => void;
  removeChat: (chatId: string) => void;
  setActiveChatId: (id: string | null) => void;

  // ── Message actions ────────────────────────────────────────────────────────
  setMessages: (msgs: Message[]) => void;
  appendMessage: (msg: Message) => void;
  removeBulkMessages: (chatId: string, ids: string[]) => void;

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

  // ── Socket-driven updates ──────────────────────────────────────────────────
  /** Incoming new-message event: update last_message + unread count. */
  handleNewMessage: (msg: Message) => void;
  /** messages-deleted event: soft-remove from list + fix last_message. */
  handleMessagesDeleted: (chatId: string, ids: string[]) => void;
  /** chat-read event from a partner: advance partner_last_read_at. */
  handleChatRead: (chatId: string, userId: string, readAt: number, meId: string) => void;
  /** Optimistically mark a chat as read for the current user. */
  markChatRead: (chatId: string) => void;

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

  // ── Chat list ──────────────────────────────────────────────────────────────

  setChats: (chats) => set({ chats }),

  upsertChat: (chat) => set(state => ({
    chats: state.chats.some(c => c.id === chat.id)
      ? state.chats.map(c => c.id === chat.id ? chat : c)
      : [chat, ...state.chats],
  })),

  removeChat: (chatId) => set(state => ({
    chats: state.chats.filter(c => c.id !== chatId),
    activeChatId: state.activeChatId === chatId ? null : state.activeChatId,
    messages: state.activeChatId === chatId ? [] : state.messages,
  })),

  setActiveChatId: (id) => set({ activeChatId: id, selectedIds: new Set() }),

  // ── Messages ───────────────────────────────────────────────────────────────

  setMessages: (messages) => set({ messages }),

  appendMessage: (msg) => set(state => {
    if (state.messages.some(m => m.id === msg.id)) return state;
    return { messages: [...state.messages, msg] };
  }),

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

  // ── Loading ────────────────────────────────────────────────────────────────

  setLoadingChats: (loadingChats) => set({ loadingChats }),
  setLoadingMessages: (loadingMessages) => set({ loadingMessages }),
  setDataError: (dataError) => set({ dataError }),

  // ── Socket-driven updates ──────────────────────────────────────────────────

  handleNewMessage: (msg) => set(state => {
    const isActive = msg.chat_id === state.activeChatId;
    return {
      chats: state.chats.map(c => c.id !== msg.chat_id ? c : {
        ...c,
        last_message: msg,
        unread_count: isActive ? 0 : (c.unread_count ?? 0) + 1,
      }),
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

  handleChatRead: (chatId, userId, readAt, meId) => {
    if (userId === meId) return;
    set(state => ({
      chats: state.chats.map(c => c.id !== chatId ? c : {
        ...c,
        partner_last_read_at: Math.max(c.partner_last_read_at ?? 0, readAt),
      }),
    }));
  },

  markChatRead: (chatId) => set(state => ({
    chats: state.chats.map(c => c.id === chatId ? { ...c, unread_count: 0 } : c),
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
