import { type Chat } from '../../types';
import { ChatItem } from './ChatItem';

type ChatFilter = 'all' | 'groups' | 'direct';

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
  return (
    <div className="chatList">
      {error && <div className="listErr">{error}</div>}
      {loading && <div className="listHint">Загрузка…</div>}
      {!loading && chats.length === 0 && (
        <div className="listHint">
          {filter === 'groups'
            ? 'Нет групп'
            : filter === 'direct'
            ? 'Нет личных чатов'
            : 'Найдите пользователя выше чтобы начать диалог'}
        </div>
      )}
      {chats.map(c => (
        <ChatItem
          key={c.id}
          chat={c}
          meId={meId}
          isActive={c.id === activeChatId}
          onClick={() => onSelect(c.id)}
          onContextMenu={e => { e.preventDefault(); onContextMenu(e, c); }}
        />
      ))}
    </div>
  );
}
