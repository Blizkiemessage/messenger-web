/**
 * PrivacyTab — Конфиденциальность
 * ✅ Added: hide_avatar toggle with exceptions picker.
 */
import { useState, useCallback, useEffect } from 'react';
import { type User } from '../../types';
import { Toggle } from '../ui/Toggle';
import { Avatar } from '../ui/Avatar';
import { updateMe, searchUsers, getUserById } from '../../api/users';

interface Props {
  me: User;
  onUpdate: (u: User) => void;
}

export function PrivacyTab({ me, onUpdate }: Props) {
  // ── Group add privacy ──────────────────────────────────────────────────────
  const [noGroupAdd, setNoGroupAdd] = useState(me.no_group_add ?? false);

  // ── Avatar privacy ─────────────────────────────────────────────────────────
  const [hideAvatar,   setHideAvatar]   = useState(me.hide_avatar ?? false);
  const [exceptions,   setExceptions]   = useState<User[]>([]);
  const [searchQ,      setSearchQ]      = useState('');
  const [searchRes,    setSearchRes]    = useState<User[]>([]);
  const [searching,    setSearching]    = useState(false);

  // Parse stored exception IDs → load full user objects on mount
  useEffect(() => {
    const ids: string[] = JSON.parse(me.avatar_exceptions || '[]');
    if (ids.length === 0) return;
    // Fetch full user data for each stored ID so names/avatars show correctly
    Promise.all(
      ids.map(id =>
        getUserById(id).catch(() => ({ id } as User))
      )
    ).then(users => setExceptions(users));
  }, []); // eslint-disable-line

  // Search users for exceptions
  useEffect(() => {
    if (!searchQ.trim() || searchQ.length < 2) { setSearchRes([]); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchUsers(searchQ);
        setSearchRes(results.filter(u => !exceptions.some(e => e.id === u.id)));
      } catch { /* ignore */ }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQ]); // eslint-disable-line

  const addException = useCallback((user: User) => {
    setExceptions(prev => prev.some(e => e.id === user.id) ? prev : [...prev, user]);
    setSearchQ('');
    setSearchRes([]);
  }, []);

  const removeException = useCallback((id: string) => {
    setExceptions(prev => prev.filter(e => e.id !== id));
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [ok,   setOk]   = useState(false);

  async function onSave() {
    setBusy(true); setOk(false);
    try {
      const next = await updateMe({
        no_group_add:      noGroupAdd,
        hide_avatar:       hideAvatar,
        avatar_exceptions: JSON.stringify(exceptions.map(e => e.id)),
      });
      onUpdate(next);
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }

  return (
    <div className="psBody">

      {/* ── Groups section ── */}
      <div className="psPrivacySection">
        <div className="psPrivacyTitle">Группы</div>
        <div className="psPrivacyDesc">Управляйте тем, кто может добавлять вас в групповые чаты.</div>
        <label className="psPrivacyRow">
          <div className="psPrivacyRowText">
            <div className="psPrivacyRowLabel">Запретить добавление в группы</div>
            <div className="psPrivacyRowSub">Никто не сможет добавить вас в групповой чат без вашего согласия</div>
          </div>
          <Toggle value={noGroupAdd} onChange={setNoGroupAdd} />
        </label>
      </div>

      {/* ── Avatar privacy section ── */}
      <div className="psPrivacySection">
        <div className="psPrivacyTitle">Фото профиля</div>
        <div className="psPrivacyDesc">
          Управляйте тем, кто видит вашу аватарку в чатах, в списке контактов и в профиле.
        </div>

        <label className="psPrivacyRow">
          <div className="psPrivacyRowText">
            <div className="psPrivacyRowLabel">Скрыть фото профиля</div>
            <div className="psPrivacyRowSub">
              Ваша аватарка будет видна только вам. Остальные увидят букву-заглушку.
            </div>
          </div>
          <Toggle value={hideAvatar} onChange={setHideAvatar} />
        </label>

        {/* ── Exceptions picker — only visible when hiding is enabled ── */}
        {hideAvatar && (
          <div className="psExceptionsWrap">
            <div className="psExceptionsLabel">Исключения — видят вашу аватарку</div>

            {/* Selected exceptions as removable tags */}
            {exceptions.length > 0 && (
              <div className="psExceptionTagsWrap">
                {exceptions.map(u => (
                  <div key={u.id} className="psExceptionTag">
                    <Avatar user={u} size={18} radius={5} />
                    <span>{u.display_name || u.username || u.id}</span>
                    <button
                      className="psExceptionTagRemove"
                      onClick={() => removeException(u.id)}
                      title="Удалить из исключений"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Search input */}
            <input
              className="psExceptionsSearch"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Найти пользователя…"
            />

            {/* Search results */}
            {searchQ.length >= 2 && (
              <div className="psExceptionsList">
                {searching && (
                  <div className="psExceptionsEmpty">Поиск…</div>
                )}
                {!searching && searchRes.length === 0 && (
                  <div className="psExceptionsEmpty">Пользователи не найдены</div>
                )}
                {!searching && searchRes.map(u => (
                  <button
                    key={u.id}
                    className="psExceptionItem"
                    onClick={() => addException(u)}
                  >
                    <Avatar user={u} size={34} radius={10} />
                    <div className="psExceptionInfo">
                      <div className="psExceptionName">{u.display_name || u.username}</div>
                      {u.username && <div className="psExceptionSub">@{u.username}</div>}
                    </div>
                    <div style={{
                      width: 22, height: 22, borderRadius: 6,
                      background: 'var(--accent-dim)', color: 'var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {exceptions.length === 0 && searchQ.length < 2 && (
              <div className="psExceptionsEmpty">
                Начните вводить имя пользователя, чтобы добавить исключение
              </div>
            )}
          </div>
        )}
      </div>

      {ok && <div className="psOk">✓ Настройки сохранены</div>}
      <button className="psSaveBtn" onClick={onSave} disabled={busy}>
        {busy ? '…' : 'Сохранить'}
      </button>
    </div>
  );
}
