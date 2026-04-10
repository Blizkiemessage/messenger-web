/**
 * UserProfileModal — redesigned to match the sidebar popup aesthetic.
 * ✅ Added: 3-dot menu with block/unblock + contact alias (nickname) features.
 * ✅ Added: Media / Files / Voice / Links tabs (when a direct chat exists).
 */
import { useEffect, useRef, useState } from 'react';
import { type User, type Message } from '../../types';
import { avatarLetter, formatBirthDate, formatLastSeen } from '../../utils/format';
import { resolveUrl } from '../ui/Avatar';
import { getUserById, blockUser, setAlias, deleteAlias } from '../../api/users';
import { useChatsStore } from '../../store/useChatsStore';
import { getChatMessages } from '../../api/chats';

// ── Tab helpers ───────────────────────────────────────────────────────────────
type UpTab = 'media' | 'files' | 'voice' | 'links';
const UP_TABS: UpTab[] = ['media', 'files', 'voice', 'links'];
const UP_TAB_LABELS: Record<UpTab, string> = { media: 'Медиа', files: 'Файлы', voice: 'Записи', links: 'Ссылки' };

function upFmtSize(b: number): string {
  if (!b) return '';
  if (b < 1024) return `${b} Б`;
  if (b < 1_048_576) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / 1_048_576).toFixed(1)} МБ`;
}
function upFmtDur(s: number): string {
  if (!s || !isFinite(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
const UP_MO_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const UP_MO     = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
function upTsMs(ts: number) { return ts < 1e12 ? ts * 1000 : ts; }
function upFmtDt(ts: number): string {
  const d = new Date(upTsMs(ts));
  return `${d.getDate()} ${UP_MO_GEN[d.getMonth()]} в ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}
function upFmtGrp(ts: number): string {
  const d = new Date(upTsMs(ts));
  const same = d.getFullYear() === new Date().getFullYear();
  const mo = UP_MO[d.getMonth()];
  return same ? mo[0].toUpperCase() + mo.slice(1) : `${mo[0].toUpperCase() + mo.slice(1)} ${d.getFullYear()}`;
}
function upGroupByDate<T extends { created_at: number }>(items: T[]): { label: string; items: T[] }[] {
  const g: { label: string; items: T[] }[] = [];
  let last = '';
  for (const it of items) {
    const lbl = upFmtGrp(it.created_at);
    if (lbl !== last) { g.push({ label: lbl, items: [] }); last = lbl; }
    g[g.length - 1].items.push(it);
  }
  return g;
}
const UP_URL_RE = /https?:\/\/[^\s<>"']+/g;
function upExtractUrls(t: string): string[] { return t?.match(UP_URL_RE) ?? []; }
function upDomain(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
function upFileInfo(name = ''): { color: string; label: string } {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const m: Record<string, [string, string]> = {
    pdf: ['#e74c3c','PDF'], doc: ['#2980b9','DOC'], docx: ['#2980b9','DOC'],
    xls: ['#27ae60','XLS'], xlsx: ['#27ae60','XLS'], csv: ['#27ae60','CSV'],
    ppt: ['#e67e22','PPT'], pptx: ['#e67e22','PPT'],
    zip: ['#f39c12','ZIP'], rar: ['#f39c12','RAR'], '7z': ['#f39c12','ZIP'],
    txt: ['#7f8c8d','TXT'], md: ['#7f8c8d','MD'],
  };
  return m[ext] ? { color: m[ext][0], label: m[ext][1] } : { color: '#7f8c8d', label: ext.toUpperCase() || 'FILE' };
}

interface Props {
  userId: string;
  onClose: () => void;
  onStartChat?: (u: User) => void;
}

export function UserProfileModal({ userId, onClose, onStartChat }: Props) {
  const [user,       setUser]       = useState<User | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [aliasOpen,  setAliasOpen]  = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [aliasBusy,  setAliasBusy]  = useState(false);
  const [blockBusy,  setBlockBusy]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const menuRef      = useRef<HTMLDivElement>(null);
  const aliasInputRef = useRef<HTMLInputElement>(null);
  const onlineUsers  = useChatsStore(s => s.onlineUsers);

  // Find direct chat with this user (for media tabs)
  const directChatId = useChatsStore(s =>
    s.chats.find(c => c.type === 'direct' && c.members?.some(m => m.id === userId))?.id
  );

  // Tab state
  const [activeTab, setActiveTab]   = useState<UpTab>('media');
  const [tabMsgs, setTabMsgs]       = useState<Message[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabHasMore, setTabHasMore] = useState(false);
  const [tabOldest, setTabOldest]   = useState<number | undefined>(undefined);

  // Voice player
  const [playingId, setPlayingId]   = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      .catch(() => setError('Не удалось загрузить профиль'))
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

  // Load tab messages when tab or chat changes
  useEffect(() => {
    if (!directChatId) { setTabMsgs([]); return; }
    let cancelled = false;
    setTabMsgs([]);
    setTabOldest(undefined);
    setTabHasMore(false);
    setTabLoading(true);
    getChatMessages(directChatId)
      .then(msgs => {
        if (cancelled) return;
        setTabMsgs(msgs);
        setTabHasMore(msgs.length >= 50);
        if (msgs.length > 0) setTabOldest(msgs[msgs.length - 1].created_at);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTabLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, directChatId]);

  // Stop audio on unmount
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const isOnline = user ? onlineUsers.has(user.id) : false;
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
      setError(e?.message || 'Не удалось выполнить действие');
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
      setError(e?.message || 'Не удалось сохранить псевдоним');
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
      setError(e?.message || 'Не удалось удалить псевдоним');
    }
  };

  async function loadMore() {
    if (!directChatId || tabLoading || !tabOldest) return;
    setTabLoading(true);
    try {
      const msgs = await getChatMessages(directChatId, tabOldest);
      setTabMsgs(prev => [...prev, ...msgs]);
      setTabHasMore(msgs.length >= 50);
      if (msgs.length > 0) setTabOldest(msgs[msgs.length - 1].created_at);
    } catch { /**/ }
    finally { setTabLoading(false); }
  }

  function togglePlay(msg: Message) {
    if (!audioRef.current) return;
    if (playingId === msg.id) {
      audioRef.current.pause();
      setPlayingId(null);
    } else {
      audioRef.current.pause();
      audioRef.current.src = msg.attachment_url ?? '';
      audioRef.current.play().catch(() => {});
      setPlayingId(msg.id);
    }
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const mediaItems = tabMsgs.filter(m => m.attachment_type === 'image' || m.attachment_type === 'video');
  const fileItems  = tabMsgs.filter(m =>
    m.attachment_url && m.attachment_type &&
    !['image', 'video', 'audio', 'video_note'].includes(m.attachment_type)
  );
  const voiceItems = tabMsgs.filter(m => m.attachment_type === 'audio' || m.attachment_type === 'video_note');
  const linkItems: { msg: Message; url: string }[] = tabMsgs.flatMap(m =>
    upExtractUrls(m.text || '').map(url => ({ msg: m, url }))
  );
  const mediaGroups = upGroupByDate(mediaItems);
  const fileGroups  = upGroupByDate(fileItems);
  const voiceGroups = upGroupByDate(voiceItems);

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`upCard${directChatId ? ' upCardTabs' : ''}`}>

        {/* 3-dot menu */}
        {!loading && user && (
          <div className="upMenuWrap" ref={menuRef}>
            <button
              className={`upMenuBtn${menuOpen ? ' upMenuBtnActive' : ''}`}
              onClick={() => setMenuOpen(v => !v)}
              title="Действия"
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
                      Разблокировать
                    </>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                      </svg>
                      Заблокировать
                    </>
                  )}
                </button>

                <div className="ctxDivider" />

                <button className="ctxItem" onClick={openAliasDialog}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  Переименовать
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
          <div className="upLoading">Загрузка…</div>
        ) : error && !user ? (
          <div className="upLoading">{error}</div>
        ) : !user ? (
          <div className="upLoading">Пользователь не найден</div>
        ) : (
          <>
            {/* ── Static head (scrolls away only when card has tabs) ── */}
            <div className={directChatId ? 'giCardHead' : undefined}>

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
                    Заблокирован
                  </div>
                )}

                <div className={`upOnlineStatus${isOnline ? ' upOnlineStatusOnline' : ''}`}>
                  {formatLastSeen(lastSeenAt, isOnline)}
                </div>
              </div>

              {/* Error bar */}
              {error && <div className="upErrorBar">{error}</div>}

              {/* Alias edit dialog */}
              {aliasOpen && (
                <div className="upAliasDialog">
                  <p className="upAliasHint">Псевдоним виден только вам</p>
                  <input
                    ref={aliasInputRef}
                    className="upAliasInput"
                    value={aliasInput}
                    onChange={e => setAliasInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveAlias();
                      if (e.key === 'Escape') setAliasOpen(false);
                    }}
                    placeholder="Введите псевдоним..."
                    maxLength={50}
                  />
                  <div className="upAliasActions">
                    <button className="upAliasSave" onClick={handleSaveAlias} disabled={aliasBusy || !aliasInput.trim()}>
                      {aliasBusy ? 'Сохранение…' : 'Сохранить'}
                    </button>
                    <button className="upAliasCancel" onClick={() => setAliasOpen(false)}>
                      Отмена
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
                      Удалить псевдоним
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
                        <div className="upInfoLabel">Почта</div>
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
                        <div className="upInfoLabel">О себе</div>
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
                        <div className="upInfoLabel">Дата рождения</div>
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
                    Написать сообщение
                  </button>
                </div>
              )}

            </div>{/* /giCardHead */}

            {/* ── Tabs (only when direct chat exists) ───────────────── */}
            {directChatId && (
              <>
                <div className="giTabs">
                  {UP_TABS.map(tab => (
                    <button
                      key={tab}
                      className={`giTab${activeTab === tab ? ' giTabActive' : ''}`}
                      onClick={() => setActiveTab(tab)}
                    >
                      {UP_TAB_LABELS[tab]}
                    </button>
                  ))}
                </div>

                <div className="giTabContent">

                  {/* MEDIA */}
                  {activeTab === 'media' && (
                    <div className="giTabSection">
                      {tabLoading && mediaItems.length === 0 ? (
                        <div className="giTabSpinner"><div className="giSpinner" /></div>
                      ) : mediaItems.length === 0 ? (
                        <div className="giTabEmpty">
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".3">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                          </svg>
                          <span>Нет медиафайлов</span>
                        </div>
                      ) : (
                        <>
                          {mediaGroups.map(group => (
                            <div key={group.label}>
                              <div className="giDateLabel">{group.label}</div>
                              <div className="giMediaGrid">
                                {group.items.map(m => (
                                  <a key={m.id} className="giMediaThumb" href={m.attachment_url!} target="_blank" rel="noreferrer">
                                    {m.attachment_type === 'image' ? (
                                      <img src={m.attachment_url!} alt="" loading="lazy" />
                                    ) : (
                                      <>
                                        <video src={m.attachment_url!} preload="none" muted />
                                        <div className="giVideoOverlay">
                                          <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                                            <polygon points="5 3 19 12 5 21 5 3"/>
                                          </svg>
                                        </div>
                                      </>
                                    )}
                                  </a>
                                ))}
                              </div>
                            </div>
                          ))}
                          {tabHasMore && (
                            <button className="giLoadMore" onClick={loadMore} disabled={tabLoading}>
                              {tabLoading ? '…' : 'Загрузить ещё'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* FILES */}
                  {activeTab === 'files' && (
                    <div className="giTabSection">
                      {tabLoading && fileItems.length === 0 ? (
                        <div className="giTabSpinner"><div className="giSpinner" /></div>
                      ) : fileItems.length === 0 ? (
                        <div className="giTabEmpty">
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".3">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                            <polyline points="13 2 13 9 20 9"/>
                          </svg>
                          <span>Нет файлов</span>
                        </div>
                      ) : (
                        <>
                          {fileGroups.map(group => (
                            <div key={group.label}>
                              <div className="giDateLabel">{group.label}</div>
                              {group.items.map(m => {
                                const { color, label } = upFileInfo(m.attachment_name || '');
                                return (
                                  <a key={m.id} className="giFileItem"
                                    href={m.attachment_url!} target="_blank" rel="noreferrer"
                                    download={m.attachment_name || true}
                                  >
                                    <div className="giFileIcon" style={{ background: color + '22', borderColor: color + '44', color }}>
                                      <span>{label}</span>
                                    </div>
                                    <div className="giFileInfo">
                                      <div className="giFileName">{m.attachment_name || 'Файл'}</div>
                                      <div className="giFileMeta">
                                        {upFmtSize(m.attachment_size || 0)}
                                        {' · '}{upFmtDt(m.created_at)}
                                      </div>
                                    </div>
                                    <div className="giFileDownload">
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                      </svg>
                                    </div>
                                  </a>
                                );
                              })}
                            </div>
                          ))}
                          {tabHasMore && (
                            <button className="giLoadMore" onClick={loadMore} disabled={tabLoading}>
                              {tabLoading ? '…' : 'Загрузить ещё'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* VOICE */}
                  {activeTab === 'voice' && (
                    <div className="giTabSection">
                      <audio ref={audioRef} onEnded={() => setPlayingId(null)} style={{ display: 'none' }} />
                      {tabLoading && voiceItems.length === 0 ? (
                        <div className="giTabSpinner"><div className="giSpinner" /></div>
                      ) : voiceItems.length === 0 ? (
                        <div className="giTabEmpty">
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".3">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                            <line x1="12" y1="19" x2="12" y2="23"/>
                            <line x1="8" y1="23" x2="16" y2="23"/>
                          </svg>
                          <span>Нет голосовых записей</span>
                        </div>
                      ) : (
                        <>
                          {voiceGroups.map(group => (
                            <div key={group.label}>
                              <div className="giDateLabel">{group.label}</div>
                              {group.items.map(m => {
                                const isPlaying = playingId === m.id;
                                return (
                                  <div key={m.id} className="giVoiceItem">
                                    <button
                                      className={`giVoicePlayBtn${isPlaying ? ' giVoicePlayBtnActive' : ''}`}
                                      onClick={() => togglePlay(m)}
                                      aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
                                    >
                                      {isPlaying ? (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                          <rect x="6" y="4" width="4" height="16" rx="1"/>
                                          <rect x="14" y="4" width="4" height="16" rx="1"/>
                                        </svg>
                                      ) : (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                          <polygon points="5 3 19 12 5 21 5 3"/>
                                        </svg>
                                      )}
                                    </button>
                                    <div className="giVoiceInfo">
                                      <div className="giVoiceDate">{upFmtDt(m.created_at)}</div>
                                      {m.attachment_duration
                                        ? <div className="giVoiceMeta">{upFmtDur(m.attachment_duration)}</div>
                                        : null
                                      }
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                          {tabHasMore && (
                            <button className="giLoadMore" onClick={loadMore} disabled={tabLoading}>
                              {tabLoading ? '…' : 'Загрузить ещё'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* LINKS */}
                  {activeTab === 'links' && (
                    <div className="giTabSection">
                      {tabLoading && linkItems.length === 0 ? (
                        <div className="giTabSpinner"><div className="giSpinner" /></div>
                      ) : linkItems.length === 0 ? (
                        <div className="giTabEmpty">
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".3">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                          </svg>
                          <span>Нет ссылок</span>
                        </div>
                      ) : (
                        <>
                          {linkItems.map(({ msg, url }, i) => (
                            <a key={`${msg.id}-${i}`} className="giLinkItem" href={url} target="_blank" rel="noreferrer">
                              <div className="giLinkIcon">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                                </svg>
                              </div>
                              <div className="giLinkInfo">
                                <div className="giLinkDomain">{upDomain(url)}</div>
                                <div className="giLinkUrl">{url}</div>
                                <div className="giLinkDate">{upFmtDt(msg.created_at)}</div>
                              </div>
                            </a>
                          ))}
                          {tabHasMore && (
                            <button className="giLoadMore" onClick={loadMore} disabled={tabLoading}>
                              {tabLoading ? '…' : 'Загрузить ещё'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                </div>{/* /giTabContent */}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
