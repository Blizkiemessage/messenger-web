/**
 * GroupInfoModal — redesigned to match UserProfileModal style.
 */
import { useState, useEffect } from 'react';
import { type Chat, type User } from '../../types';
import { avatarLetter } from '../../utils/format';
import { Avatar } from '../ui/Avatar';
import { ContextMenu } from '../ui/ContextMenu';
import { AddGroupMembersModal } from './AddGroupMembersModal';

const DESC_MAX = 150;
const DESC_PREVIEW_CHARS = 120;

interface Props {
  chat: Chat;
  onClose: () => void;
  onViewUser: (id: string) => void;
  meId: string;
  onUpdateChat: (name: string, description: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
}

export function GroupInfoModal({ chat, onClose, onViewUser, meId, onUpdateChat, onRemoveMember }: Props) {
  const isCreator = chat.creator_id === meId;

  const [editing,   setEditing]   = useState(false);
  const [editName,  setEditName]  = useState(chat.name || '');
  const [editDesc,  setEditDesc]  = useState(chat.description || '');
  const [editBusy,  setEditBusy]  = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);

  const [showAddMembers, setShowAddMembers] = useState(false);
  const [memberCtx,      setMemberCtx]      = useState<{ x: number; y: number; user: User } | null>(null);
  const [removeConfirm,  setRemoveConfirm]  = useState<User | null>(null);
  const [removeBusy,     setRemoveBusy]     = useState(false);

  useEffect(() => {
    if (!editing) { setEditName(chat.name || ''); setEditDesc(chat.description || ''); }
  }, [chat.name, chat.description, editing]);

  useEffect(() => {
    if (removeConfirm && !chat.members.some(m => m.id === removeConfirm.id)) {
      setRemoveConfirm(null); setRemoveBusy(false);
    }
  }, [chat.members, removeConfirm]);

  async function handleSaveEdit() {
    if (!editName.trim()) { setEditError('Введите название группы'); return; }
    setEditBusy(true); setEditError(null);
    try { await onUpdateChat(editName.trim(), editDesc.trim()); setEditing(false); }
    catch (e: any) { setEditError(e?.message ?? 'Ошибка'); }
    finally { setEditBusy(false); }
  }

  async function handleRemoveConfirm() {
    if (!removeConfirm) return;
    setRemoveBusy(true);
    try { await onRemoveMember(removeConfirm.id); setRemoveConfirm(null); }
    catch { /* upstream */ }
    finally { setRemoveBusy(false); }
  }

  const desc = chat.description || '';
  const descNeedsExpand = desc.length > DESC_PREVIEW_CHARS;
  const descShown = descExpanded || !descNeedsExpand ? desc : desc.slice(0, DESC_PREVIEW_CHARS) + '…';

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && !removeConfirm && onClose()}>
      <div className="upCard giCard">

        {/* Close */}
        <button className="upCloseBtn" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {/* Header */}
        <div className="upHeader">
          <div className="upAvatarRing">
            <div className="upAvatar">
              <span className="upAvatarLetter">{avatarLetter(chat.name || 'Г')}</span>
            </div>
          </div>

          {editing ? (
            <div className="giEditForm" style={{ width: '100%', marginTop: 8 }}>
              <input
                className="giEditInput"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="Название группы"
                maxLength={64}
                autoFocus
              />
              <div className="giEditTextareaWrap">
                <textarea
                  className="giEditTextarea"
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value.slice(0, DESC_MAX))}
                  placeholder="Описание группы (необязательно)"
                  rows={3}
                  maxLength={DESC_MAX}
                />
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
                {isCreator && (
                  <button className="giEditBtn" onClick={() => setEditing(true)} title="Редактировать">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                )}
              </div>
              <div className="upUsername">{chat.members.length} участников</div>
            </>
          )}
        </div>

        {/* Description */}
        {!editing && desc && (
          <div className="upInfoSection">
            <div className="upInfoRow">
              <span className="upInfoIcon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="8" y1="6" x2="21" y2="6"/>
                  <line x1="8" y1="12" x2="21" y2="12"/>
                  <line x1="8" y1="18" x2="21" y2="18"/>
                  <line x1="3" y1="6" x2="3.01" y2="6"/>
                  <line x1="3" y1="12" x2="3.01" y2="12"/>
                  <line x1="3" y1="18" x2="3.01" y2="18"/>
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

        {/* Members section */}
        <div className="giMembersSection">
          <div className="giMemberLabel">Участники</div>

          {isCreator && (
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
            {chat.members.map(m => (
              <button
                key={m.id}
                className="giMemberItem"
                onClick={() => { onViewUser(m.id); onClose(); }}
                onContextMenu={e => {
                  if (!isCreator || m.id === meId || m.id === chat.creator_id) return;
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
                  {m.id === meId          && <span className="giYouBadge">Вы</span>}
                  {m.id === chat.creator_id && <span className="giAdminBadge">Создатель</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Context menu */}
      {memberCtx && (
        <ContextMenu x={memberCtx.x} y={memberCtx.y} onClose={() => setMemberCtx(null)} zIndex={10100}>
          <button className="ctxItem ctxItemDanger" onClick={() => { setMemberCtx(null); setRemoveConfirm(memberCtx.user); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
            Удалить {memberCtx.user.display_name || memberCtx.user.username}
          </button>
        </ContextMenu>
      )}

      {/* Remove confirmation */}
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

      {showAddMembers && (
        <AddGroupMembersModal chat={chat} meId={meId} onClose={() => setShowAddMembers(false)} />
      )}
    </div>
  );
}
