/**
 * GroupInfoModal — redesigned to match UserProfileModal style.
 *
 * ✅ New features:
 *   - "Удалить группу" button for admin (shows dialog with two options)
 *   - Right-click on member → "Удалить участника" + "Сделать администратором"
 *   - Transfer admin modal with member picker
 *   - Close group confirmation dialog
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
  onCloseGroup: () => Promise<void>;
  onTransferAdmin: (userId: string) => Promise<void>;
}

export function GroupInfoModal({
  chat, onClose, onViewUser, meId,
  onUpdateChat, onRemoveMember,
  onCloseGroup, onTransferAdmin,
}: Props) {
  const isCreator = chat.creator_id === meId;
  const isGroupClosed = chat.is_closed === true;

  const [editing,   setEditing]   = useState(false);
  const [editName,  setEditName]  = useState(chat.name || '');
  const [editDesc,  setEditDesc]  = useState(chat.description || '');
  const [editBusy,  setEditBusy]  = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);

  const [showAddMembers, setShowAddMembers] = useState(false);

  // ── Member right-click context menu ──────────────────────────────────────
  const [memberCtx, setMemberCtx] = useState<{ x: number; y: number; user: User } | null>(null);

  // ── Remove member confirm ─────────────────────────────────────────────────
  const [removeConfirm, setRemoveConfirm] = useState<User | null>(null);
  const [removeBusy,    setRemoveBusy]    = useState(false);

  // ── Delete group dialog (admin only) ─────────────────────────────────────
  const [showDeleteDialog,   setShowDeleteDialog]   = useState(false);

  // ── Transfer admin modal ──────────────────────────────────────────────────
  const [showTransferModal,  setShowTransferModal]  = useState(false);
  const [transferTarget,     setTransferTarget]     = useState<User | null>(null);
  const [transferBusy,       setTransferBusy]       = useState(false);
  const [transferError,      setTransferError]      = useState<string | null>(null);

  // ── Close group confirm ───────────────────────────────────────────────────
  const [showCloseConfirm,  setShowCloseConfirm]  = useState(false);
  const [closeBusy,          setCloseBusy]          = useState(false);

  // ── Make admin confirm (from right-click) ─────────────────────────────────
  const [makeAdminTarget,  setMakeAdminTarget]  = useState<User | null>(null);
  const [makeAdminBusy,    setMakeAdminBusy]    = useState(false);

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

  async function handleCloseGroup() {
    setCloseBusy(true);
    try {
      await onCloseGroup();
      setShowCloseConfirm(false);
      setShowDeleteDialog(false);
      onClose();
    } catch { /* upstream */ }
    finally { setCloseBusy(false); }
  }

  async function handleTransferAdmin() {
    if (!transferTarget) return;
    setTransferBusy(true);
    setTransferError(null);
    try {
      await onTransferAdmin(transferTarget.id);
      setShowTransferModal(false);
      setShowDeleteDialog(false);
      onClose();
    } catch (e: any) {
      setTransferError(e?.message ?? 'Ошибка при передаче прав');
    } finally {
      setTransferBusy(false);
    }
  }

  async function handleMakeAdminFromCtx() {
    if (!makeAdminTarget) return;
    setMakeAdminBusy(true);
    try {
      await onTransferAdmin(makeAdminTarget.id);
      setMakeAdminTarget(null);
      onClose();
    } catch { /* upstream */ }
    finally { setMakeAdminBusy(false); }
  }

  const desc = chat.description || '';
  const descNeedsExpand = desc.length > DESC_PREVIEW_CHARS;
  const descShown = descExpanded || !descNeedsExpand ? desc : desc.slice(0, DESC_PREVIEW_CHARS) + '…';

  // Members eligible for admin transfer (not self, not current admin)
  const transferCandidates = chat.members.filter(m => m.id !== meId && m.id !== chat.creator_id);

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && !removeConfirm && !showDeleteDialog && onClose()}>
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
                {isCreator && !isGroupClosed && (
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

          {isCreator && !isGroupClosed && (
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
                  // ✅ Show context menu only for admin on non-self, non-admin members
                  if (!isCreator || m.id === meId) return;
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
                  {m.id === meId            && <span className="giYouBadge">Вы</span>}
                  {m.id === chat.creator_id && <span className="giAdminBadge">Администратор</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ✅ Admin "Delete group" button */}
        {isCreator && !isGroupClosed && (
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

      {/* ─── Right-click context menu on member ─────────────────────── */}
      {memberCtx && (
        <ContextMenu x={memberCtx.x} y={memberCtx.y} onClose={() => setMemberCtx(null)} zIndex={10100}>
          {/* Make admin (only show if member is not already admin) */}
          {memberCtx.user.id !== chat.creator_id && (
            <button
              className="ctxItem ctxItemAdmin"
              onClick={() => { setMemberCtx(null); setMakeAdminTarget(memberCtx.user); }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              Сделать администратором
            </button>
          )}
          {/* Remove member */}
          <button
            className="ctxItem ctxItemDanger"
            onClick={() => { setMemberCtx(null); setRemoveConfirm(memberCtx.user); }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
            Удалить участника
          </button>
        </ContextMenu>
      )}

      {/* ─── Remove member confirmation ──────────────────────────────── */}
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

      {/* ─── Make admin confirmation (from right-click) ──────────────── */}
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
              <strong>{makeAdminTarget.display_name || makeAdminTarget.username}</strong> станет новым администратором группы. Вы потеряете права администратора.
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

      {/* ─── Delete group dialog ─────────────────────────────────────── */}
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
            <div className="giDeleteDialogSubtitle">
              Выберите действие перед удалением
            </div>

            {/* Option 1: Transfer admin */}
            <button
              className="giDeleteOption giDeleteOptionSafe"
              onClick={() => { setShowDeleteDialog(false); setShowTransferModal(true); }}
            >
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

            {/* Option 2: Close group */}
            <button
              className="giDeleteOption giDeleteOptionDanger"
              onClick={() => { setShowDeleteDialog(false); setShowCloseConfirm(true); }}
            >
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

      {/* ─── Close group confirmation ─────────────────────────────────── */}
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

      {/* ─── Transfer admin modal ─────────────────────────────────────── */}
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
                  <button
                    key={m.id}
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
              <button
                className="giEditCancelBtn"
                onClick={() => { setShowTransferModal(false); setTransferTarget(null); setTransferError(null); }}
                disabled={transferBusy}
              >
                Отмена
              </button>
              <button
                className="giEditSaveBtn"
                onClick={handleTransferAdmin}
                disabled={transferBusy || !transferTarget}
              >
                {transferBusy ? '…' : 'Передать'}
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
