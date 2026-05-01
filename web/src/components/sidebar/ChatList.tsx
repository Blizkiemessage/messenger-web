import { useState, useCallback } from 'react';
import { type Chat } from '../../types';
import { ChatItem } from './ChatItem';
import { useChatsStore } from '../../store/useChatsStore';
import { updatePinOrder } from '../../api/chats';

type ChatFilter = string;

interface Props {
  chats: Chat[];
  meId: string;
  activeChatId: string | null;
  filter: ChatFilter;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, chat: Chat) => void;
}

export function ChatList({
  chats, meId, activeChatId, filter, loading, error, onSelect, onContextMenu,
}: Props) {
  const onlineUsers  = useChatsStore(s => s.onlineUsers);
  const typingUsers  = useChatsStore(s => s.typingUsers);

  // ── Drag-and-drop for pinned section ─────────────────────────────────────
  const [draggedId, setDraggedId]   = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const pinnedChats  = chats.filter(c => c.is_pinned);
  const regularChats = chats.filter(c => !c.is_pinned);

  const handleDragStart = useCallback((chatId: string) => {
    setDraggedId(chatId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, chatId: string) => {
    e.preventDefault();
    if (chatId !== dragOverId) setDragOverId(chatId);
  }, [dragOverId]);

  const handleDrop = useCallback(async (targetId: string) => {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null); setDragOverId(null); return;
    }
    const ordered = [...pinnedChats];
    const fromIdx = ordered.findIndex(c => c.id === draggedId);
    const toIdx   = ordered.findIndex(c => c.id === targetId);
    if (fromIdx === -1 || toIdx === -1) { setDraggedId(null); setDragOverId(null); return; }

    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);

    const orderedIds = ordered.map(c => c.id);
    // Optimistic update
    const store = useChatsStore.getState();
    orderedIds.forEach((id, i) => store.updateChatPatch(id, { pin_order: i }));

    setDraggedId(null);
    setDragOverId(null);

    try { await updatePinOrder(orderedIds); } catch { /* silent */ }
  }, [draggedId, pinnedChats]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  // ── Per-chat derived values ───────────────────────────────────────────────
  const enrichChat = (c: Chat) => {
    const partner      = c.type === 'direct' ? c.members.find(m => m.id !== meId) : null;
    const isOnline     = partner ? onlineUsers.has(partner.id) : false;
    const chatTypingIds = typingUsers.get(c.id) ?? [];
    const othersTyping  = chatTypingIds.filter(id => id !== meId);
    let typingPreview: string | null = null;
    if (othersTyping.length === 1) {
      const member = c.members.find(m => m.id === othersTyping[0]);
      const name   = member?.display_name || member?.username || null;
      typingPreview = name ? `${name} печатает` : 'Печатает';
    } else if (othersTyping.length > 1) {
      typingPreview = `${othersTyping.length} пользователя печатают`;
    }
    return { partner, isOnline, typingPreview };
  };

  if (!loading && chats.length === 0) {
    return (
      <div className="chatList">
        {error && <div className="listErr">{error}</div>}
        <div className="listHint">
          {filter === 'groups' ? 'Нет групп'
            : filter === 'direct' ? 'Нет личных чатов'
            : filter.startsWith('folder:') ? 'Папка пуста. Добавьте чаты через контекстное меню'
            : 'Найдите пользователя выше чтобы начать диалог'}
        </div>
      </div>
    );
  }

  return (
    <div className="chatList">
      {error  && <div className="listErr">{error}</div>}
      {loading && <div className="listHint">Загрузка…</div>}

      {/* ── Pinned chats (draggable) ───────────────────────────────────────── */}
      {pinnedChats.length > 0 && (
        <>
          {pinnedChats.map(c => {
            const { isOnline, typingPreview } = enrichChat(c);
            const isDragging = draggedId === c.id;
            const isDragOver = dragOverId === c.id && draggedId !== c.id;
            return (
              <ChatItem
                key={c.id}
                chat={c}
                meId={meId}
                isActive={c.id === activeChatId}
                isOnline={isOnline}
                typingPreview={typingPreview}
                draggable
                isDragging={isDragging}
                isDragOver={isDragOver}
                onDragStart={() => handleDragStart(c.id)}
                onDragOver={e => handleDragOver(e, c.id)}
                onDrop={() => handleDrop(c.id)}
                onDragEnd={handleDragEnd}
                onClick={() => onSelect(c.id)}
                onContextMenu={e => { e.preventDefault(); onContextMenu(e, c); }}
              />
            );
          })}
          {/* Separator between pinned and regular */}
          {regularChats.length > 0 && <div className="pinnedDivider" />}
        </>
      )}

      {/* ── Regular chats ──────────────────────────────────────────────────── */}
      {regularChats.map(c => {
        const { isOnline, typingPreview } = enrichChat(c);
        return (
          <ChatItem
            key={c.id}
            chat={c}
            meId={meId}
            isActive={c.id === activeChatId}
            isOnline={isOnline}
            typingPreview={typingPreview}
            onClick={() => onSelect(c.id)}
            onContextMenu={e => { e.preventDefault(); onContextMenu(e, c); }}
          />
        );
      })}
    </div>
  );
}
