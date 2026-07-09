/**
 * PrivacyTab — Конфиденциальность
 * ✅ Added: hide_avatar toggle with exceptions picker.
 */
import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type User } from '../../types';
import { Toggle } from '../ui/Toggle';
import { Avatar } from '../ui/Avatar';
import { updateMe, searchUsers, getUserById } from '../../api/users';

interface Props {
  me: User;
  onUpdate: (u: User) => void;
}

export function PrivacyTab({ me, onUpdate }: Props) {
  const { t } = useTranslation('settings');
  // ── Group add privacy ──────────────────────────────────────────────────────
  const [noGroupAdd, setNoGroupAdd] = useState(me.no_group_add ?? false);

  // ── Last seen privacy ─────────────────────────────────────────────────────
  const [hideLastSeen, setHideLastSeen] = useState(me.hide_last_seen ?? false);

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
        hide_last_seen:    hideLastSeen,
      });
      onUpdate(next);
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }

  return (
    <div className="psBody">

      {/* ── Last seen section ── */}
      <div className="psPrivacySection">
        <div className="psPrivacyTitle">{t('privacy.lastSeenTitle')}</div>
        <div className="psPrivacyDesc">{t('privacy.lastSeenDesc')}</div>
        <label className="psPrivacyRow">
          <div className="psPrivacyRowText">
            <div className="psPrivacyRowLabel">{t('privacy.hideLastSeenLabel')}</div>
            <div className="psPrivacyRowSub">{t('privacy.hideLastSeenSub')}</div>
          </div>
          <Toggle value={hideLastSeen} onChange={setHideLastSeen} />
        </label>
      </div>

      {/* ── Groups section ── */}
      <div className="psPrivacySection">
        <div className="psPrivacyTitle">{t('privacy.groupsTitle')}</div>
        <div className="psPrivacyDesc">{t('privacy.groupsDesc')}</div>
        <label className="psPrivacyRow">
          <div className="psPrivacyRowText">
            <div className="psPrivacyRowLabel">{t('privacy.noGroupAddLabel')}</div>
            <div className="psPrivacyRowSub">{t('privacy.noGroupAddSub')}</div>
          </div>
          <Toggle value={noGroupAdd} onChange={setNoGroupAdd} />
        </label>
      </div>

      {/* ── Avatar privacy section ── */}
      <div className="psPrivacySection">
        <div className="psPrivacyTitle">{t('privacy.avatarTitle')}</div>
        <div className="psPrivacyDesc">
          {t('privacy.avatarDesc')}
        </div>

        <label className="psPrivacyRow">
          <div className="psPrivacyRowText">
            <div className="psPrivacyRowLabel">{t('privacy.hideAvatarLabel')}</div>
            <div className="psPrivacyRowSub">
              {t('privacy.hideAvatarSub')}
            </div>
          </div>
          <Toggle value={hideAvatar} onChange={setHideAvatar} />
        </label>

        {/* ── Exceptions picker — only visible when hiding is enabled ── */}
        {hideAvatar && (
          <div className="psExceptionsWrap">
            <div className="psExceptionsLabel">{t('privacy.exceptionsLabel')}</div>

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
                      title={t('privacy.removeExceptionTitle')}
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
              placeholder={t('privacy.searchPlaceholder')}
            />

            {/* Search results */}
            {searchQ.length >= 2 && (
              <div className="psExceptionsList">
                {searching && (
                  <div className="psExceptionsEmpty">{t('privacy.searching')}</div>
                )}
                {!searching && searchRes.length === 0 && (
                  <div className="psExceptionsEmpty">{t('modals:addGroupMembers.noUsersFound')}</div>
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
                {t('privacy.exceptionsHint')}
              </div>
            )}
          </div>
        )}
      </div>

      {ok && <div className="psOk">✓ {t('privacy.saved')}</div>}
      <button className="psSaveBtn" onClick={onSave} disabled={busy}>
        {busy ? '…' : t('common:save')}
      </button>
    </div>
  );
}
