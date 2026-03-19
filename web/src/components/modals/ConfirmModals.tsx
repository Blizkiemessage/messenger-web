/**
 * ConfirmModals
 *
 * Small confirmation dialogs and the chat context menu.
 * ChatContextMenu now uses the shared ContextMenu UI component.
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
export function ChatActionConfirmModal({
  chat, onConfirm, onCancel, busy,
}: { chat: Chat; onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  const isGroup = chat.type === 'group';
  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="confirmCard">
        <div className="confirmIcon">
          {isGroup ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          )}
        </div>
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
