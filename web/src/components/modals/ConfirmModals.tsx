/**
 * ConfirmModals
 *
 * Small confirmation dialogs and the chat context menu.
<<<<<<< HEAD
 * ChatContextMenu now uses the shared ContextMenu UI component.
=======
 * ✅ ChatActionConfirmModal now shows admin-specific text when admin leaves a group.
>>>>>>> devDK
 */
import { type Chat } from '../../types';
import { ContextMenu } from '../ui/ContextMenu';

// ── DeleteConfirmModal ────────────────────────────────────────────────────────
export function DeleteConfirmModal({
  count, onConfirm, onCancel, busy,
}: { count: number; onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="confirmCard">
        <div className="confirmIcon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </div>
        <div className="confirmTitle">
          Удалить {count === 1 ? 'сообщение' : `${count} сообщения`}?
        </div>
        <div className="confirmText">
          {count === 1
            ? 'Это сообщение будет удалено для всех участников чата.'
            : `Эти ${count} сообщения будут удалены для всех участников чата.`
          }{' '}Действие нельзя отменить.
        </div>
        <div className="confirmBtns">
          <button className="confirmCancel" onClick={onCancel} disabled={busy}>Отмена</button>
          <button className="confirmDelete" onClick={onConfirm} disabled={busy}>{busy ? '…' : 'Удалить'}</button>
        </div>
      </div>
    </div>
  );
}

// ── ChatActionConfirmModal ────────────────────────────────────────────────────
<<<<<<< HEAD
export function ChatActionConfirmModal({
  chat, onConfirm, onCancel, busy,
}: { chat: Chat; onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  const isGroup = chat.type === 'group';
=======
// ✅ meId added: if admin leaves a group, show "close group" wording instead of "leave"
export function ChatActionConfirmModal({
  chat, meId, onConfirm, onCancel, busy,
}: { chat: Chat; meId: string; onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  const isGroup = chat.type === 'group';
  const isAdmin = isGroup && chat.creator_id === meId;

  const title = !isGroup
    ? 'Удалить чат?'
    : isAdmin
      ? 'Закрыть группу?'
      : 'Покинуть группу?';

  const description = !isGroup
    ? 'Чат будет удалён для обоих участников. Действие нельзя отменить.'
    : isAdmin
      ? `Вы — администратор группы «${chat.name || 'Группы'}». Покидая её, вы закроете группу для всех участников. Переписка сохранится, но отправка новых сообщений будет заблокирована.`
      : `Вы покинете «${chat.name || 'Группу'}». Остальные участники увидят уведомление.`;

  const confirmLabel = !isGroup ? 'Удалить' : isAdmin ? 'Закрыть группу' : 'Покинуть';

>>>>>>> devDK
  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="confirmCard">
        <div className="confirmIcon">
          {isGroup ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
<<<<<<< HEAD
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
=======
              {isAdmin ? (
                // Lock icon for admin closing
                <>
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </>
              ) : (
                // Leave icon for regular member
                <>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </>
              )}
>>>>>>> devDK
            </svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          )}
        </div>
<<<<<<< HEAD
        <div className="confirmTitle">{isGroup ? 'Покинуть группу?' : 'Удалить чат?'}</div>
        <div className="confirmText">
          {isGroup
            ? `Вы покинете «${chat.name || 'Группу'}». Остальные участники увидят уведомление.`
            : 'Чат будет удалён для обоих участников. Действие нельзя отменить.'}
        </div>
        <div className="confirmBtns">
          <button className="confirmCancel" onClick={onCancel} disabled={busy}>Отмена</button>
          <button className="confirmDelete" onClick={onConfirm} disabled={busy}>
            {busy ? '…' : isGroup ? 'Покинуть' : 'Удалить'}
=======
        <div className="confirmTitle">{title}</div>
        <div className="confirmText">{description}</div>
        <div className="confirmBtns">
          <button className="confirmCancel" onClick={onCancel} disabled={busy}>Отмена</button>
          <button className="confirmDelete" onClick={onConfirm} disabled={busy}>
            {busy ? '…' : confirmLabel}
>>>>>>> devDK
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ChatContextMenu ───────────────────────────────────────────────────────────
export function ChatContextMenu({
  x, y, chat, onClose, onDelete, onLeave,
}: { x: number; y: number; chat: Chat; onClose: () => void; onDelete: () => void; onLeave: () => void }) {
  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {chat.type === 'direct' ? (
        <button className="ctxItem ctxItemDanger" onClick={() => { onClose(); onDelete(); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
          </svg>
          Удалить чат
        </button>
      ) : (
        <button className="ctxItem ctxItemDanger" onClick={() => { onClose(); onLeave(); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Покинуть группу
        </button>
      )}
    </ContextMenu>
  );
}
