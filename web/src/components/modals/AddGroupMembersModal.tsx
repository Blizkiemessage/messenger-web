/**
 * AddGroupMembersModal
 *
 * Search and add users to an existing group chat.
 * Previously embedded inside GroupInfoModal — now a standalone component.
 */
import { useState, useEffect } from 'react';
import { type Chat, type User } from '../../types';
import { avatarLetter } from '../../utils/format';
import { addGroupMember } from '../../api/chats';
import { useSearch } from '../../hooks/useSearch';

interface Props {
  chat: Chat;
  meId: string;
  onClose: () => void;
}

export function AddGroupMembersModal({ chat, meId, onClose }: Props) {
  const { query, setQuery, results: rawResults, searching } = useSearch();
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Filter out existing members and self
  const memberIds = new Set(chat.members.map(m => m.id));
  const results = rawResults.filter(u => u.id !== meId && !memberIds.has(u.id) && !addedIds.has(u.id));

  // Remove newly-added members from results when chat.members updates (socket)
  useEffect(() => {
    setAddedIds(prev => {
      const still = new Set(prev);
      still.forEach(id => { if (!chat.members.some(m => m.id === id)) still.delete(id); });
      return still;
    });
  }, [chat.members]);

  async function handleAdd(u: User) {
    if (addingId || addedIds.has(u.id)) return;
    setError(null);
    setAddingId(u.id);
    try {
      await addGroupMember(chat.id, u.id);
      setAddedIds(prev => new Set([...prev, u.id]));
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка добавления');
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="modalOverlay" style={{ zIndex: 10050 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modalCard">
        <div className="modalHeader">
          <div className="modalTitle">Добавить участников</div>
          <button className="modalClose" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="modalBody">
          {/* Search */}
          <div className="modalField">
            <div className="modalSearch">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--muted)', flexShrink: 0 }}>
                <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.7"/>
                <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
              <input
                className="modalSearchInput"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Поиск по username…"
                autoFocus
              />
              {searching && <span className="modalSearchSpin">…</span>}
            </div>
          </div>

          {error && <div className="modalError">{error}</div>}

          {/* Results */}
          {results.length > 0 && (
            <div className="modalUserList">
              {results.map(u => {
                const isBlocked = !!u.no_group_add;
                const isAdded = addedIds.has(u.id);
                const isAdding = addingId === u.id;
                return (
                  <button
                    key={u.id}
                    className={`modalUserItem${isBlocked ? ' modalUserItemDisabled' : ''}`}
                    onClick={() => !isBlocked && !isAdded && handleAdd(u)}
                    disabled={isBlocked || isAdded || !!addingId}
                    title={isBlocked ? 'Пользователь запретил добавление в группы' : undefined}
                  >
                    <div className="modalUserAvatar">{avatarLetter(u.display_name || u.username || '')}</div>
                    <div className="modalUserInfo">
                      <div className="modalUserName">{u.display_name || u.username}</div>
                      {u.username && <div className="modalUserSub">@{u.username}</div>}
                    </div>
                    {isBlocked ? (
                      <div className="modalUserLock">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      </div>
                    ) : isAdded ? (
                      <div className="modalUserAdded">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                    ) : isAdding ? (
                      <div className="modalUserAdding">…</div>
                    ) : (
                      <div className="modalUserCheck">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {query.length >= 2 && !searching && results.length === 0 &&
            <div className="modalEmpty">Пользователи не найдены</div>}
          {query.length < 2 &&
            <div className="modalEmpty">Введите имя или username для поиска</div>}
        </div>

        <div className="modalFooter">
          <button className="modalCreateBtn" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}
