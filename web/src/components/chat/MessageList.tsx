import { useRef, useEffect } from 'react';
import { type Message, type Chat } from '../../types';
import { MessageBubble } from './MessageBubble';

interface Props {
  messages: Message[];
  chat: Chat;
  meId: string;
  partnerReadAt: number;
  selectedIds: Set<string>;
  hasSelection: boolean;
  loadingMessages: boolean;
  onToggleSelect: (id: string) => void;
  onClearSelection: () => void;
  onViewUser: (id: string) => void;
}

export function MessageList({
  messages, chat, meId, partnerReadAt, selectedIds, hasSelection,
  loadingMessages, onToggleSelect, onClearSelection, onViewUser,
}: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const isGroup = chat.type === 'group';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, chat.id]);

  return (
    <div className="messages" onClick={() => hasSelection && onClearSelection()}>
      {loadingMessages && <div className="msgHint">Загрузка…</div>}
      {messages.map((m, idx) => {
        const isOwn = m.sender_id === meId;
        const isRead = isOwn && partnerReadAt >= m.created_at;
        const isSelected = selectedIds.has(m.id);
        const sender = !isOwn ? chat.members.find(mb => mb.id === m.sender_id) : undefined;
        const nextMsg = messages[idx + 1];
        const isLastInRow = !nextMsg || nextMsg.sender_id !== m.sender_id;
        const showAvatar = isGroup && !isOwn && isLastInRow && !m.is_system;
        const showName =
          isGroup && !isOwn && !m.is_system &&
          (idx === 0 || messages[idx - 1].sender_id !== m.sender_id || !!messages[idx - 1].is_system);

        if (m.is_system) {
          return (
            <div key={m.id} className="msgSystem">
              <span>{m.text}</span>
            </div>
          );
        }

        return (
          <MessageBubble
            key={m.id}
            message={m}
            isOwn={isOwn}
            isRead={isRead}
            isSelected={isSelected}
            isGroup={isGroup}
            sender={sender}
            showAvatar={showAvatar}
            showName={showName}
            hasSelection={hasSelection}
            onContextMenu={() => onToggleSelect(m.id)}
            onClick={() => onToggleSelect(m.id)}
            onViewUser={onViewUser}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
