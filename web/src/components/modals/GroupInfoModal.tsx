/**
 * GroupInfoModal — with media tabs.
 * Tabs: Участники | Медиа | Файлы | Записи | Ссылки
 */
import { useState, useEffect, useRef } from 'react';
import { type Chat, type User, type Message } from '../../types';
import { avatarLetter } from '../../utils/format';
import { Avatar } from '../ui/Avatar';
import { ContextMenu } from '../ui/ContextMenu';
import { AddGroupMembersModal } from './AddGroupMembersModal';
import { Portal } from '../ui/Portal';
import client from '../../api/client';
import { getChatMessages, setMemberRole as setMemberRoleApi } from '../../api/chats';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1_048_576).toFixed(1)} МБ`;
}

function fmtDur(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

const MO_RU  = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const MO_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

function tsMs(ts: number): number { return ts < 1e12 ? ts * 1000 : ts; }

function fmtDateTime(ts: number): string {
  const d  = new Date(tsMs(ts));
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${d.getDate()} ${MO_GEN[d.getMonth()]} в ${hm}`;
}

function fmtGroup(ts: number): string {
  const d = new Date(tsMs(ts));
  const same = d.getFullYear() === new Date().getFullYear();
  const mo = MO_RU[d.getMonth()];
  const cap = mo[0].toUpperCase() + mo.slice(1);
  return same ? cap : `${cap} ${d.getFullYear()}`;
}

function groupByDate<T extends { created_at: number }>(items: T[]): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  let last = '';
  for (const item of items) {
    const label = fmtGroup(item.created_at);
    if (label !== last) { groups.push({ label, items: [] }); last = label; }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;
function extractUrls(text: string): string[] { return text?.match(URL_RE) ?? []; }
function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function fileTypeInfo(name = ''): { color: string; label: string } {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, [string, string]> = {
    pdf: ['#e74c3c','PDF'], doc: ['#2980b9','DOC'], docx: ['#2980b9','DOC'],
    xls: ['#27ae60','XLS'], xlsx: ['#27ae60','XLS'], csv: ['#27ae60','CSV'],
    ppt: ['#e67e22','PPT'], pptx: ['#e67e22','PPT'],
    zip: ['#f39c12','ZIP'], rar: ['#f39c12','RAR'], '7z': ['#f39c12','ZIP'],
    tar: ['#f39c12','TAR'], gz: ['#f39c12','GZ'],
    txt: ['#7f8c8d','TXT'], md: ['#7f8c8d','MD'],
  };
  return map[ext]
    ? { color: map[ext][0], label: map[ext][1] }
    : { color: '#7f8c8d', label: ext.toUpperCase() || 'FILE' };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type TabType = 'members' | 'media' | 'files' | 'voice' | 'links';
const TABS: TabType[]                  = ['members', 'media', 'files', 'voice', 'links'];
const TAB_LABELS: Record<TabType, string> = {
  members: 'Участники',
  media:   'Медиа',
  files:   'Файлы',
  voice:   'Записи',
  links:   'Ссылки',
};

const DESC_MAX     = 150;
const DESC_PREVIEW = 120;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  chat: Chat;
  onClose: () => void;
  onViewUser: (id: string) => void;
  meId: string;
  onUpdateChat: (name: string, description: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onCloseGroup: () => Promise<void>;
  onTransferAdmin: (userId: string) => Promise<void>;
  onUpdateAvatar: (url: string) => Promise<void>;
  onJumpToMessage?: (msgId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GroupInfoModal({
  chat, onClose, onViewUser, meId,
  onUpdateChat, onRemoveMember, onCloseGroup, onTransferAdmin, onUpdateAvatar,
  onJumpToMessage,
}: Props) {
  const myRole           = chat.members.find(m => m.id === meId)?.role ?? 'member';
  const isAdmin          = myRole === 'admin';
  const isModerator      = myRole === 'moderator';
  const canManageMembers = isAdmin || isModerator;
  const isGroupClosed    = chat.is_closed === true;

  // ── Edit ─────────────────────────────────────────────────────────────────
  const [editing,   setEditing]   = useState(false);
  const [editName,  setEditName]  = useState(chat.name || '');
  const [editDesc,  setEditDesc]  = useState(chat.description || '');
  const [editBusy,  setEditBusy]  = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [showAddMembers, setShowAddMembers] = useState(false);

  // ── Member ctx ───────────────────────────────────────────────────────────
  const [memberCtx, setMemberCtx] = useState<{ x: number; y: number; user: User } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<User | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  // ── Delete / transfer / close dialogs ────────────────────────────────────
  const [showDeleteDialog, setShowDeleteDialog]   = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferTarget, setTransferTarget]       = useState<User | null>(null);
  const [transferBusy, setTransferBusy]           = useState(false);
  const [transferError, setTransferError]         = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm]   = useState(false);
  const [closeBusy, setCloseBusy]                 = useState(false);
  const [makeAdminTarget, setMakeAdminTarget]     = useState<User | null>(null);
  const [makeAdminBusy, setMakeAdminBusy]         = useState(false);
  const [modRoleTarget, setModRoleTarget]         = useState<{ user: User; action: 'assign' | 'revoke' } | null>(null);
  const [modRoleBusy, setModRoleBusy]             = useState(false);

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabType>('members');
  const [tabMsgs, setTabMsgs]     = useState<Message[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabHasMore, setTabHasMore] = useState(false);
  const [tabOldest, setTabOldest]   = useState<number | undefined>(undefined);

  // ── Voice player ─────────────────────────────────────────────────────────
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── Item context menu (right-click / long-press → jump to message) ────────
  const [itemCtx, setItemCtx] = useState<{ x: number; y: number; msgId: string } | null>(null);
  const lpTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpFired  = useRef(false);

  function itemEvents(msg: Message) {
    const open = (x: number, y: number) => setItemCtx({ x, y, msgId: msg.id });
    return {
      onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); open(e.clientX, e.clientY); },
      onTouchStart:  (e: React.TouchEvent) => {
        lpFired.current = false;
        const { clientX, clientY } = e.touches[0];
        lpTimer.current = setTimeout(() => { lpFired.current = true; open(clientX, clientY); }, 500);
      },
      onTouchEnd:  (e: React.TouchEvent)  => { if (lpTimer.current) clearTimeout(lpTimer.current); if (lpFired.current) e.preventDefault(); },
      onTouchMove: ()                      => { if (lpTimer.current) clearTimeout(lpTimer.current); },
    };
  }

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!editing) { setEditName(chat.name || ''); setEditDesc(chat.description || ''); }
  }, [chat.name, chat.description, editing]);

  useEffect(() => {
    if (removeConfirm && !chat.members.some(m => m.id === removeConfirm.id)) {
      setRemoveConfirm(null); setRemoveBusy(false);
    }
  }, [chat.members, removeConfirm]);

  // Load messages on tab switch (non-members tabs)
  useEffect(() => {
    if (activeTab === 'members') { setTabMsgs([]); return; }

    let cancelled = false;
    setTabMsgs([]);
    setTabOldest(undefined);
    setTabHasMore(false);
    setTabLoading(true);

    getChatMessages(chat.id)
      .then(msgs => {
        if (cancelled) return;
        setTabMsgs(msgs);
        setTabHasMore(msgs.length >= 50);
        if (msgs.length > 0) setTabOldest(msgs[0].created_at);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTabLoading(false); });

    return () => { cancelled = true; };
  }, [activeTab, chat.id]);

  // Stop audio on unmount
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSaveEdit() {
    if (!editName.trim()) { setEditError('Введите название группы'); return; }
    setEditBusy(true); setEditError(null);
    try { await onUpdateChat(editName.trim(), editDesc.trim()); setEditing(false); }
    catch (e: any) { setEditError(e?.message ?? 'Ошибка'); }
    finally { setEditBusy(false); }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || avatarUploading) return;
    e.target.value = '';
    setAvatarUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await client.post<{ url: string }>('/upload', fd, { headers: { 'Content-Type': undefined } });
      await onUpdateAvatar(res.data.url);
    } catch { /* upstream */ }
    finally { setAvatarUploading(false); }
  }

  async function handleRemoveConfirm() {
    if (!removeConfirm) return;
    setRemoveBusy(true);
    try { await onRemoveMember(removeConfirm.id); setRemoveConfirm(null); }
    catch { /* upstream */ }
    finally { setRemoveBusy(false); }
  }

  async function handleCloseGroup() {
    setCloseBusy(true);
    try { await onCloseGroup(); setShowCloseConfirm(false); setShowDeleteDialog(false); onClose(); }
    catch { /* upstream */ }
    finally { setCloseBusy(false); }
  }

  async function handleTransferAdmin() {
    if (!transferTarget) return;
    setTransferBusy(true); setTransferError(null);
    try { await onTransferAdmin(transferTarget.id); setShowTransferModal(false); setShowDeleteDialog(false); onClose(); }
    catch (e: any) { setTransferError(e?.message ?? 'Ошибка при передаче прав'); }
    finally { setTransferBusy(false); }
  }

  async function handleMakeAdminFromCtx() {
    if (!makeAdminTarget) return;
    setMakeAdminBusy(true);
    try { await onTransferAdmin(makeAdminTarget.id); setMakeAdminTarget(null); onClose(); }
    catch { /* upstream */ }
    finally { setMakeAdminBusy(false); }
  }

  async function handleModRole() {
    if (!modRoleTarget) return;
    setModRoleBusy(true);
    try {
      const newRole = modRoleTarget.action === 'assign' ? 'moderator' : 'member';
      await setMemberRoleApi(chat.id, modRoleTarget.user.id, newRole);
      setModRoleTarget(null);
    } catch { /* socket will update chat */ }
    finally { setModRoleBusy(false); }
  }

  async function loadMore() {
    if (tabLoading || !tabOldest) return;
    setTabLoading(true);
    try {
      const msgs = await getChatMessages(chat.id, tabOldest);
      setTabMsgs(prev => [...msgs, ...prev]);
      setTabHasMore(msgs.length >= 50);
      if (msgs.length > 0) setTabOldest(msgs[0].created_at);
    } catch { /* */ }
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

  // ── Derived data ──────────────────────────────────────────────────────────

  const desc             = chat.description || '';
  const descNeedsExpand  = desc.length > DESC_PREVIEW;
  const descShown        = descExpanded || !descNeedsExpand ? desc : desc.slice(0, DESC_PREVIEW) + '…';
  const transferCandidates = chat.members.filter(m => m.id !== meId && m.id !== chat.creator_id);

  const mediaItems = tabMsgs.filter(m => m.attachment_type === 'image' || m.attachment_type === 'video');
  const fileItems  = tabMsgs.filter(m =>
    m.attachment_url && m.attachment_type &&
    !['image', 'video', 'audio', 'video_note'].includes(m.attachment_type)
  );
  const voiceItems = tabMsgs.filter(m => m.attachment_type === 'audio' || m.attachment_type === 'video_note');
  const linkItems: { msg: Message; url: string }[] = tabMsgs.flatMap(m =>
    extractUrls(m.text || '').map(url => ({ msg: m, url }))
  );

  const mediaGroups = groupByDate(mediaItems);
  const fileGroups  = groupByDate(fileItems);
  const voiceGroups = groupByDate(voiceItems);

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <>
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && !removeConfirm && !showDeleteDialog && onClose()}>
      <div className="upCard giCard">

        {/* Close */}
        <button className="upCloseBtn" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {/* ── Single unified scroll area ─────────────────────────────────── */}
        <div className="giCardScroll">
        <div className="upHeader">
            <div className="upAvatarRing">
              <div className="upAvatar"
                style={{ position: 'relative', cursor: isAdmin ? 'pointer' : 'default' }}
                onClick={() => isAdmin && avatarInputRef.current?.click()}
              >
                {chat.avatar_url
                  ? <img src={chat.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                  : <span className="upAvatarLetter">{avatarLetter(chat.name || 'Г')}</span>
                }
                {isAdmin && (
                  <div className="giAvatarOverlay">
                    {avatarUploading
                      ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    }
                  </div>
                )}
              </div>
              {isAdmin && <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />}
            </div>

            {editing ? (
              <div className="giEditForm" style={{ width: '100%', marginTop: 8 }}>
                <input className="giEditInput" value={editName} onChange={e => setEditName(e.target.value)}
                  placeholder="Название группы" maxLength={64} autoFocus />
                <div className="giEditTextareaWrap">
                  <textarea className="giEditTextarea" value={editDesc}
                    onChange={e => setEditDesc(e.target.value.slice(0, DESC_MAX))}
                    placeholder="Описание группы (необязательно)" rows={3} maxLength={DESC_MAX} />
                  <span className={`giCharCounter${editDesc.length >= DESC_MAX ? ' giCharCounterMax' : ''}`}>
                    {editDesc.length}/{DESC_MAX}
                  </span>
                </div>
                {editError && <div className="giEditError">{editError}</div>}
                <div className="giEditBtns">
                  <button className="giEditCancelBtn" onClick={() => { setEditing(false); setEditError(null); }}>Отмена</button>
                  <button className="giEditSaveBtn" onClick={handleSaveEdit} disabled={editBusy || !editName.trim()}>
                    {editBusy ? '…' : 'Сохранить'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="giNameRow">
                  <div className="upName">{chat.name || 'Группа'}</div>
                  {isAdmin && !isGroupClosed && (
                    <button className="giEditBtn" onClick={() => setEditing(true)} title="Редактировать">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  )}
                </div>
                <div className="upUsername">
                  {chat.members.length} участников
                  {isGroupClosed && (
                    <span className="giClosedBadge">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                      Закрыта
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Description */}
          {!editing && desc && (
            <div className="upInfoSection">
              <div className="upInfoRow">
                <span className="upInfoIcon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                    <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
                    <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                  </svg>
                </span>
                <div className="upInfoContent">
                  <div className="upInfoLabel">Описание группы</div>
                  <div className="upInfoValue">{descShown}</div>
                  {descNeedsExpand && (
                    <button className="giDescToggle" onClick={() => setDescExpanded(v => !v)}>
                      {descExpanded ? 'Свернуть' : 'Подробнее'}
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                        style={{ transform: descExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

        {/* ── Tab bar (sticky) ───────────────────────────────────────────── */}
        {!editing && (
          <div className="giTabs">
            {TABS.map(tab => (
              <button
                key={tab}
                className={`giTab${activeTab === tab ? ' giTabActive' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        )}

        {/* ── Tab content ────────────────────────────────────────────────── */}
        <div className="giTabContent">

          {/* MEMBERS (also shown when editing) */}
          {(activeTab === 'members' || editing) && (
            <div className="giMembersSection">
              {canManageMembers && !isGroupClosed && (
                <button className="giAddMembersBtn" onClick={() => setShowAddMembers(true)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                  Добавить участников
                </button>
              )}
              <div className="giMemberList">
                {chat.members.map(m => {
                  const targetRole = m.role ?? 'member';
                  const canOpenCtx = m.id !== meId && (
                    (isAdmin && targetRole !== 'admin') ||
                    (isModerator && targetRole === 'member')
                  );
                  return (
                  <button key={m.id} className="giMemberItem"
                    onClick={() => { onViewUser(m.id); onClose(); }}
                    onContextMenu={e => {
                      if (!canOpenCtx) return;
                      e.preventDefault();
                      setMemberCtx({ x: e.clientX, y: e.clientY, user: m });
                    }}
                  >
                    <Avatar user={m} size={38} radius={12} />
                    <div className="giMemberInfo">
                      <div className="giMemberName">{m.display_name || m.username}</div>
                      {m.username && <div className="giMemberSub">@{m.username}</div>}
                    </div>
                    <div className="giBadges">
                      {m.id === meId             && <span className="giYouBadge">Вы</span>}
                      {targetRole === 'admin'     && <span className="giAdminBadge">Администратор</span>}
                      {targetRole === 'moderator' && <span className="giModeratorBadge">Модератор</span>}
                    </div>
                  </button>
                  );
                })}
              </div>
              {isAdmin && !isGroupClosed && (
                <div className="giDangerZone">
                  <button className="giDeleteGroupBtn" onClick={() => setShowDeleteDialog(true)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                    Удалить группу
                  </button>
                </div>
              )}
            </div>
          )}

          {/* MEDIA */}
          {activeTab === 'media' && !editing && (
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
                          <a key={m.id} className="giMediaThumb" href={m.attachment_url!} target="_blank" rel="noreferrer" {...itemEvents(m)}>
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
          {activeTab === 'files' && !editing && (
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
                        const { color, label } = fileTypeInfo(m.attachment_name || '');
                        const sender = chat.members.find(mb => mb.id === m.sender_id);
                        return (
                          <a key={m.id} className="giFileItem"
                            href={m.attachment_url!} target="_blank" rel="noreferrer"
                            download={m.attachment_name || true}
                            {...itemEvents(m)}
                          >
                            <div className="giFileIcon" style={{ background: color + '22', borderColor: color + '44', color }}>
                              <span>{label}</span>
                            </div>
                            <div className="giFileInfo">
                              <div className="giFileName">{m.attachment_name || 'Файл'}</div>
                              <div className="giFileMeta">
                                {fmtSize(m.attachment_size || 0)}
                                {sender && <> · {sender.display_name || sender.username}</>}
                                {' · '}{fmtDateTime(m.created_at)}
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
          {activeTab === 'voice' && !editing && (
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
                        const sender    = chat.members.find(mb => mb.id === m.sender_id);
                        const isPlaying = playingId === m.id;
                        return (
                          <div key={m.id} className="giVoiceItem" {...itemEvents(m)}>
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
                              <div className="giVoiceDate">{fmtDateTime(m.created_at)}</div>
                              <div className="giVoiceMeta">
                                {sender?.display_name || sender?.username || 'Участник'}
                                {m.attachment_duration
                                  ? <> &middot; {fmtDur(m.attachment_duration)}</>
                                  : null
                                }
                              </div>
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
          {activeTab === 'links' && !editing && (
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
                    <a key={`${msg.id}-${i}`} className="giLinkItem" href={url} target="_blank" rel="noreferrer" {...itemEvents(msg)}>
                      <div className="giLinkIcon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                        </svg>
                      </div>
                      <div className="giLinkInfo">
                        <div className="giLinkDomain">{getDomain(url)}</div>
                        <div className="giLinkUrl">{url}</div>
                        <div className="giLinkDate">{fmtDateTime(msg.created_at)}</div>
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
        </div>{/* /giCardScroll */}
      </div>
    </div>

    {/* ── Portal dialogs ────────────────────────────────────────────────────── */}
    <Portal>
      {/* Jump-to-message context menu */}
      {itemCtx && onJumpToMessage && (
        <ContextMenu x={itemCtx.x} y={itemCtx.y} onClose={() => setItemCtx(null)} zIndex={10200}>
          <button className="ctxItem ctxItemJump" onClick={() => { setItemCtx(null); onJumpToMessage(itemCtx.msgId); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>
            </svg>
            Перейти к сообщению
          </button>
        </ContextMenu>
      )}

      {memberCtx && (
        <ContextMenu x={memberCtx.x} y={memberCtx.y} onClose={() => setMemberCtx(null)} zIndex={10100}>
          {/* Admin: toggle moderator role */}
          {isAdmin && (
            (memberCtx.user.role ?? 'member') === 'moderator' ? (
              <button className="ctxItem"
                onClick={() => { setMemberCtx(null); setModRoleTarget({ user: memberCtx.user, action: 'revoke' }); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  <line x1="4" y1="4" x2="20" y2="20"/>
                </svg>
                Снять роль модератора
              </button>
            ) : (
              <button className="ctxItem"
                onClick={() => { setMemberCtx(null); setModRoleTarget({ user: memberCtx.user, action: 'assign' }); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
                Назначить модератором
              </button>
            )
          )}
          {/* Admin: transfer admin rights */}
          {isAdmin && memberCtx.user.id !== chat.creator_id && (
            <button className="ctxItem ctxItemAdmin"
              onClick={() => { setMemberCtx(null); setMakeAdminTarget(memberCtx.user); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              Сделать администратором
            </button>
          )}
          {/* Admin/moderator: remove member */}
          <button className="ctxItem ctxItemDanger"
            onClick={() => { setMemberCtx(null); setRemoveConfirm(memberCtx.user); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
            Удалить участника
          </button>
        </ContextMenu>
      )}

      {removeConfirm && (
        <div className="giConfirmOverlay" onClick={e => e.target === e.currentTarget && !removeBusy && setRemoveConfirm(null)}>
          <div className="confirmCard">
            <div className="confirmIcon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
            </div>
            <div className="confirmTitle">Удалить участника?</div>
            <div className="confirmText">
              {removeConfirm.display_name || removeConfirm.username} будет удалён(а) из группы.
            </div>
            <div className="confirmBtns">
              <button className="confirmCancel" onClick={() => setRemoveConfirm(null)} disabled={removeBusy}>Отмена</button>
              <button className="confirmDelete" onClick={handleRemoveConfirm} disabled={removeBusy}>
                {removeBusy ? '…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {makeAdminTarget && (
        <div className="giConfirmOverlay" onClick={e => e.target === e.currentTarget && !makeAdminBusy && setMakeAdminTarget(null)}>
          <div className="confirmCard">
            <div className="confirmIcon confirmIconAdmin">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </div>
            <div className="confirmTitle">Передать права?</div>
            <div className="confirmText">
              <strong>{makeAdminTarget.display_name || makeAdminTarget.username}</strong> станет новым администратором группы.
              Вы потеряете права администратора.
            </div>
            <div className="confirmBtns">
              <button className="confirmCancel" onClick={() => setMakeAdminTarget(null)} disabled={makeAdminBusy}>Отмена</button>
              <button className="confirmAdmin" onClick={handleMakeAdminFromCtx} disabled={makeAdminBusy}>
                {makeAdminBusy ? '…' : 'Передать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modRoleTarget && (
        <div className="giConfirmOverlay" onClick={e => e.target === e.currentTarget && !modRoleBusy && setModRoleTarget(null)}>
          <div className="confirmCard">
            <div className="confirmIcon" style={{ color: '#fbbf24' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </div>
            <div className="confirmTitle">
              {modRoleTarget.action === 'assign' ? 'Назначить модератором?' : 'Снять роль модератора?'}
            </div>
            <div className="confirmText">
              {modRoleTarget.action === 'assign'
                ? <><strong>{modRoleTarget.user.display_name || modRoleTarget.user.username}</strong> получит права модератора: добавлять участников, удалять рядовых участников и закреплять сообщения.</>
                : <><strong>{modRoleTarget.user.display_name || modRoleTarget.user.username}</strong> потеряет права модератора и станет обычным участником.</>
              }
            </div>
            <div className="confirmBtns">
              <button className="confirmCancel" onClick={() => setModRoleTarget(null)} disabled={modRoleBusy}>Отмена</button>
              <button className="confirmAdmin" style={{ background: 'rgba(251,191,36,.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.3)' }}
                onClick={handleModRole} disabled={modRoleBusy}>
                {modRoleBusy ? '…' : modRoleTarget.action === 'assign' ? 'Назначить' : 'Снять'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteDialog && (
        <div className="giConfirmOverlay" onClick={e => e.target === e.currentTarget && setShowDeleteDialog(false)}>
          <div className="giDeleteDialog">
            <button className="giDeleteDialogClose" onClick={() => setShowDeleteDialog(false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div className="giDeleteDialogIcon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </div>
            <div className="giDeleteDialogTitle">Удалить группу</div>
            <div className="giDeleteDialogSubtitle">Выберите действие перед удалением</div>

            <button className="giDeleteOption giDeleteOptionSafe"
              onClick={() => { setShowDeleteDialog(false); setShowTransferModal(true); }}>
              <div className="giDeleteOptionIcon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </div>
              <div className="giDeleteOptionText">
                <div className="giDeleteOptionTitle">Передать права администратора</div>
                <div className="giDeleteOptionDesc">Группа продолжит работу под управлением другого участника</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>

            <button className="giDeleteOption giDeleteOptionDanger"
              onClick={() => { setShowDeleteDialog(false); setShowCloseConfirm(true); }}>
              <div className="giDeleteOptionIcon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <div className="giDeleteOptionText">
                <div className="giDeleteOptionTitle">Закрыть группу</div>
                <div className="giDeleteOptionDesc">Переписка будет заблокирована для всех участников</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {showCloseConfirm && (
        <div className="giConfirmOverlay" onClick={e => e.target === e.currentTarget && !closeBusy && setShowCloseConfirm(false)}>
          <div className="confirmCard">
            <div className="confirmIcon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div className="confirmTitle">Закрыть группу?</div>
            <div className="confirmText">
              Все участники увидят историю переписки, но не смогут отправлять новые сообщения. Действие нельзя отменить.
            </div>
            <div className="confirmBtns">
              <button className="confirmCancel" onClick={() => setShowCloseConfirm(false)} disabled={closeBusy}>Отмена</button>
              <button className="confirmDelete" onClick={handleCloseGroup} disabled={closeBusy}>
                {closeBusy ? '…' : 'Закрыть группу'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransferModal && (
        <div className="giConfirmOverlay" onClick={e => e.target === e.currentTarget && !transferBusy && setShowTransferModal(false)}>
          <div className="giTransferModal">
            <button className="giDeleteDialogClose" onClick={() => { setShowTransferModal(false); setTransferTarget(null); setTransferError(null); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div className="giTransferTitle">Передать права администратора</div>
            <div className="giTransferSubtitle">Выберите нового администратора группы</div>
            <div className="giTransferList">
              {transferCandidates.length === 0 ? (
                <div className="giTransferEmpty">Нет других участников для передачи прав</div>
              ) : (
                transferCandidates.map(m => (
                  <button key={m.id}
                    className={`giTransferItem${transferTarget?.id === m.id ? ' giTransferItemSelected' : ''}`}
                    onClick={() => setTransferTarget(m)}
                  >
                    <Avatar user={m} size={36} radius={10} />
                    <div className="giTransferItemInfo">
                      <div className="giTransferItemName">{m.display_name || m.username}</div>
                      {m.username && <div className="giTransferItemSub">@{m.username}</div>}
                    </div>
                    {transferTarget?.id === m.id && (
                      <div className="giTransferCheck">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
            {transferError && <div className="giTransferError">{transferError}</div>}
            <div className="giTransferBtns">
              <button className="giEditCancelBtn"
                onClick={() => { setShowTransferModal(false); setTransferTarget(null); setTransferError(null); }}
                disabled={transferBusy}>Отмена</button>
              <button className="giEditSaveBtn" onClick={handleTransferAdmin} disabled={transferBusy || !transferTarget}>
                {transferBusy ? '…' : 'Передать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddMembers && (
        <AddGroupMembersModal chat={chat} meId={meId} onClose={() => setShowAddMembers(false)} />
      )}
    </Portal>
    </>
  );
}
