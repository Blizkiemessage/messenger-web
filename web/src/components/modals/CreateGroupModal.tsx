/**
 * CreateGroupModal — now uses useSearch hook instead of inline debounce.
 */
import { useState, useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { type User } from '../../types';
import { avatarLetter } from '../../utils/format';
import { useSearch } from '../../hooks/useSearch';
import { useChatsStore, selectContacts } from '../../store/useChatsStore';
import { useSessionStore } from '../../store/useSessionStore';
import { createGroupChat } from '../../api/chats';

interface Props {
  onClose: () => void;
}

export function CreateGroupModal({ onClose }: Props) {
  const me = useSessionStore(s => s.me)!;
  const contacts = useChatsStore(useShallow(s => selectContacts(s, me.id)));

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { query, setQuery, results: rawResults, searching } = useSearch();

  const selectedIds = useMemo(() => new Set(selected.map(u => u.id)), [selected]);

  const suggested = useMemo(
    () => contacts.filter(u => u.id !== me.id && !selectedIds.has(u.id)),
    [contacts, me.id, selectedIds],
  );

  const searchResults = rawResults.filter(u => u.id !== me.id && !selectedIds.has(u.id));
  const displayList = query.length >= 2 ? searchResults : suggested;

  function toggleUser(u: User) {
    setSelected(prev => prev.some(s => s.id === u.id) ? prev.filter(s => s.id !== u.id) : [...prev, u]);
  }

  async function handleCreate() {
    if (!name.trim()) return setError('Введите название группы');
    if (selected.length < 1) return setError('Добавьте хотя бы одного участника');
    setBusy(true); setError(null);
    try {
      const chat = await createGroupChat({ name: name.trim(), description: description.trim() || undefined, memberIds: selected.map(u => u.id) });
      // Order matters: upsert first, then switch filter, then activate
      useChatsStore.getState().upsertChat(chat);
      useChatsStore.getState().setChatFilter('all');
      useChatsStore.getState().setActiveChatId(chat.id);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка создания группы');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modalCard">
        <div className="modalHeader">
          <div className="modalTitle">Новая группа</div>
          <button className="modalClose" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="modalBody">
          <div className="modalField">
            <label className="modalLabel">Название *</label>
            <input className="modalInput" value={name} onChange={e => setName(e.target.value)} placeholder="Например: Команда разработки" autoFocus maxLength={64} />
          </div>
          <div className="modalField">
            <label className="modalLabel">Описание <span className="modalOptional">(необязательно)</span></label>
            <textarea className="modalTextarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="О чём эта группа…" rows={2} maxLength={256} />
          </div>
          <div className="modalField">
            <label className="modalLabel">Участники</label>
            <div className="modalSearch">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--muted)', flexShrink: 0 }}>
                <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.7"/>
                <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
              <input className="modalSearchInput" value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по username…" />
              {searching && <span className="modalSearchSpin">…</span>}
            </div>
          </div>

          {selected.length > 0 && (
            <div className="memberChips">
              {selected.map(u => (
                <button key={u.id} className="memberChip" onClick={() => toggleUser(u)}>
                  <div className="memberChipAvatar">{avatarLetter(u.display_name || u.username || '')}</div>
                  <span>{u.display_name || u.username}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              ))}
            </div>
          )}

          {displayList.length > 0 && (
            <div className="modalUserList">
              <div className="modalListLabel">{query.length >= 2 ? 'Результаты поиска' : 'Из личных чатов'}</div>
              {displayList.map(u => {
                const isBlocked = !!u.no_group_add;
                return (
                  <button key={u.id} className={`modalUserItem${isBlocked ? ' modalUserItemDisabled' : ''}`}
                    onClick={() => !isBlocked && toggleUser(u)}
                    title={isBlocked ? 'Пользователь запретил добавление в группы' : undefined}
                    disabled={isBlocked}>
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
                    ) : (
                      <div className="modalUserCheck">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {query.length >= 2 && !searching && searchResults.length === 0 && <div className="modalEmpty">Пользователи не найдены</div>}
        </div>
        {error && <div className="modalError">{error}</div>}
        <div className="modalFooter">
          <button className="modalCancelBtn" onClick={onClose}>Отмена</button>
          <button className="modalCreateBtn" onClick={handleCreate} disabled={busy || !name.trim() || selected.length === 0}>
            {busy ? '…' : `Создать${selected.length > 0 ? ` (${selected.length + 1})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
