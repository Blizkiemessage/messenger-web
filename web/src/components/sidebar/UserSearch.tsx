/**
 * UserSearch — now uses useSearch hook internally.
 * No longer needs search props from parent.
 */
import { Avatar } from '../ui/Avatar';
import { useSearch } from '../../hooks/useSearch';
import { createDirectChat } from '../../api/chats';
import { useChatsStore } from '../../store/useChatsStore';
import { type User } from '../../types';

export function UserSearch() {
  const { query, setQuery, results, searching, error } = useSearch();

  async function onStartChat(u: User) {
    try {
      const chat = await createDirectChat(u.id);
      useChatsStore.getState().upsertChat(chat);
      useChatsStore.getState().setActiveChatId(chat.id);
      setQuery('');
    } catch { /* ignore */ }
  }

  return (
    <div className="sidebarSearch">
      <div className="searchRow">
        <svg className="searchIcon" viewBox="0 0 20 20" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
        <input
          className="searchInput"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Поиск пользователей…"
        />
        {searching && <span style={{ fontSize: '12px', color: 'var(--muted)', padding: '0 6px' }}>…</span>}
      </div>
      {error && <div className="searchError">{error}</div>}
      {results.length > 0 && (
        <div className="searchResults">
          {results.map(u => (
            <button key={u.id} className="srItem" onClick={() => onStartChat(u)}>
              <Avatar user={u} size={34} radius={10} />
              <div>
                <div className="srName">{u.display_name || u.username || u.id}</div>
                {u.username && <div className="srSub">@{u.username}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
