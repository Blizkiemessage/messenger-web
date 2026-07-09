/**
 * UserProfileModal — redesigned to match the sidebar popup aesthetic.
 * ✅ 3-dot menu with block/unblock + contact alias (nickname) features.
 * Media / Files / Voice / Links are in ChatMediaModal (gallery button in header).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type User } from '../../types';
import { avatarLetter, formatBirthDate, formatLastSeen } from '../../utils/format';
import { resolveUrl, PRESENCE_COLORS, getPresenceLabel, PRESENCE_EMOJI } from '../ui/Avatar';
import { getUserById, blockUser, reportUser, setAlias, deleteAlias } from '../../api/users';
import { useChatsStore } from '../../store/useChatsStore';
import { ReportModal } from './ReportModal';

interface Props {
  userId: string;
  onClose: () => void;
  onStartChat?: (u: User) => void;
  onJumpToMessage?: (msgId: string) => void;
}

export function UserProfileModal({ userId, onClose, onStartChat }: Props) {
  const { t } = useTranslation('modals');
  const [user,       setUser]       = useState<User | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [aliasOpen,  setAliasOpen]  = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [aliasBusy,  setAliasBusy]  = useState(false);
  const [blockBusy,  setBlockBusy]  = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const menuRef       = useRef<HTMLDivElement>(null);
  const aliasInputRef = useRef<HTMLInputElement>(null);
  const onlineUsers   = useChatsStore(s => s.onlineUsers);

  // Pick up last_seen_at from store chat members — updated in real-time by socket events
  const storeMemberLastSeen = useChatsStore(s => {
    if (!user) return undefined;
    for (const chat of s.chats) {
      const member = chat.members.find(m => m.id === user.id);
      if (member?.last_seen_at) return member.last_seen_at;
    }
    return undefined;
  });

  useEffect(() => {
    setLoading(true);
    setError(null);
    getUserById(userId)
      .then(u => { setUser(u); setAliasInput(u.alias ?? ''); })
      .catch(() => setError(t('userProfile.loadError')))
      .finally(() => setLoading(false));
  }, [userId]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  useEffect(() => {
    if (aliasOpen) setTimeout(() => aliasInputRef.current?.focus(), 50);
  }, [aliasOpen]);

  const isOnline   = user ? onlineUsers.has(user.id) : false;
  const lastSeenAt = storeMemberLastSeen ?? user?.last_seen_at;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleBlock = async () => {
    if (!user || blockBusy) return;
    setMenuOpen(false);
    setBlockBusy(true);
    setError(null);
    try {
      const result = await blockUser(user.id);
      setUser(u => u ? { ...u, is_blocked: result.is_blocked } : u);
    } catch (e: any) {
      setError(e?.message || t('userProfile.actionError'));
    } finally {
      setBlockBusy(false);
    }
  };

  const openAliasDialog = () => {
    setMenuOpen(false);
    setAliasInput(user?.alias ?? '');
    setError(null);
    setAliasOpen(true);
  };

  const handleSaveAlias = async () => {
    if (!user || !aliasInput.trim() || aliasBusy) return;
    setAliasBusy(true);
    setError(null);
    try {
      const result = await setAlias(user.id, aliasInput.trim());
      setUser(u => u ? { ...u, alias: result.alias, display_name: result.alias } : u);
      setAliasOpen(false);
    } catch (e: any) {
      setError(e?.message || t('userProfile.saveAliasError'));
    } finally {
      setAliasBusy(false);
    }
  };

  const handleDeleteAlias = async () => {
    if (!user) return;
    setAliasOpen(false);
    setError(null);
    try {
      await deleteAlias(user.id);
      const fresh = await getUserById(user.id);
      setUser(fresh);
      setAliasInput('');
    } catch (e: any) {
      setError(e?.message || t('userProfile.deleteAliasError'));
    }
  };

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <>
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="upCard">

        {/* 3-dot menu */}
        {!loading && user && (
          <div className="upMenuWrap" ref={menuRef}>
            <button
              className={`upMenuBtn${menuOpen ? ' upMenuBtnActive' : ''}`}
              onClick={() => setMenuOpen(v => !v)}
              title={t('userProfile.actions')}
              disabled={blockBusy}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
              </svg>
            </button>

            {menuOpen && (
              <div className="ctxMenu upMenuDropdown">
                <button
                  className={`ctxItem${user.is_blocked ? '' : ' ctxItemDanger'}`}
                  onClick={handleBlock}
                >
                  {user.is_blocked ? (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>
                      </svg>
                      {t('userProfile.unblock')}
                    </>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                      </svg>
                      {t('userProfile.block')}
                    </>
                  )}
                </button>

                <button className="ctxItem" onClick={() => { setMenuOpen(false); setShowReport(true); }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                    <line x1="4" y1="22" x2="4" y2="15"/>
                  </svg>
                  {t('common:report')}
                </button>

                <div className="ctxDivider" />

                <button className="ctxItem" onClick={openAliasDialog}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  {t('common:rename')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Close */}
        <button className="upCloseBtn" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {loading ? (
          <div className="upLoading">{t('common:loading')}</div>
        ) : error && !user ? (
          <div className="upLoading">{error}</div>
        ) : !user ? (
          <div className="upLoading">{t('userProfile.userNotFound')}</div>
        ) : (
          <>
            {/* Header */}
            <div className="upHeader">
              <div className="upAvatarRing">
                <div className="upAvatar">
                  {resolveUrl(user.avatar_url)
                    ? <img src={resolveUrl(user.avatar_url)!} alt="" className="upAvatarImg" />
                    : <span className="upAvatarLetter">{avatarLetter(user.display_name || user.username || '')}</span>
                  }
                </div>
              </div>
              <div className="upName">{user.display_name || user.username}</div>
              {user.username && <div className="upUsername">@{user.username}</div>}

              {user.alias && (
                <div className="upAliasBadge">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  {user.alias}
                </div>
              )}

              {user.is_blocked && (
                <div className="upBlockedBadge">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                  </svg>
                  {t('userProfile.blocked')}
                </div>
              )}

              <div className={`upOnlineStatus${isOnline ? ' upOnlineStatusOnline' : ''}`}>
                {formatLastSeen(lastSeenAt, isOnline)}
              </div>

              {user.presence_status && (
                <div
                  className="upPresenceCard"
                  style={{ '--up-presence-color': PRESENCE_COLORS[user.presence_status] } as React.CSSProperties}
                >
                  <span className="upPresenceEmoji">{PRESENCE_EMOJI[user.presence_status]}</span>
                  <span className="upPresenceLabel">{getPresenceLabel(user.presence_status)}</span>
                  {user.presence_note && (
                    <span className="upPresenceNote">— {user.presence_note}</span>
                  )}
                </div>
              )}
            </div>

            {/* Error bar */}
            {error && <div className="upErrorBar">{error}</div>}

            {/* Alias edit dialog */}
            {aliasOpen && (
              <div className="upAliasDialog">
                <p className="upAliasHint">{t('userProfile.aliasHint')}</p>
                <input
                  ref={aliasInputRef}
                  className="upAliasInput"
                  value={aliasInput}
                  onChange={e => setAliasInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveAlias();
                    if (e.key === 'Escape') setAliasOpen(false);
                  }}
                  placeholder={t('userProfile.aliasPlaceholder')}
                  maxLength={50}
                />
                <div className="upAliasActions">
                  <button className="upAliasSave" onClick={handleSaveAlias} disabled={aliasBusy || !aliasInput.trim()}>
                    {aliasBusy ? t('userProfile.savingAlias') : t('common:save')}
                  </button>
                  <button className="upAliasCancel" onClick={() => setAliasOpen(false)}>
                    {t('common:cancel')}
                  </button>
                </div>
                {user.alias && (
                  <button className="upAliasDelete" onClick={handleDeleteAlias}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                    {t('userProfile.deleteAlias')}
                  </button>
                )}
              </div>
            )}

            {/* Info rows */}
            {!aliasOpen && (user.email || user.bio || user.birth_date) && (
              <div className="upInfoSection">
                {user.email && (
                  <div className="upInfoRow">
                    <span className="upInfoIcon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                        <polyline points="22,6 12,13 2,6"/>
                      </svg>
                    </span>
                    <div className="upInfoContent">
                      <div className="upInfoLabel">{t('userProfile.email')}</div>
                      <div className="upInfoValue">{user.email}</div>
                    </div>
                  </div>
                )}
                {user.bio && (
                  <div className="upInfoRow">
                    <span className="upInfoIcon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                      </svg>
                    </span>
                    <div className="upInfoContent">
                      <div className="upInfoLabel">{t('userProfile.bio')}</div>
                      <div className="upInfoValue">{user.bio}</div>
                    </div>
                  </div>
                )}
                {user.birth_date && (
                  <div className="upInfoRow">
                    <span className="upInfoIcon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                    </span>
                    <div className="upInfoContent">
                      <div className="upInfoLabel">{t('userProfile.birthDate')}</div>
                      <div className="upInfoValue">{formatBirthDate(user.birth_date)}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action */}
            {onStartChat && (
              <div className="upFooter">
                <button className="upChatBtn" onClick={() => { onStartChat(user); onClose(); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  {t('userProfile.writeMessage')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
    {showReport && user && (
      <ReportModal
        title={t('userProfile.reportUserTitle')}
        onClose={() => setShowReport(false)}
        onSubmit={reason => reportUser(user.id, reason)}
      />
    )}
    </>
  );
}
