import { useState, useEffect, useRef } from 'react';
import { type ChatFolder } from '../../types';

const EMOJI_OPTIONS = ['📁', '⭐', '💼', '🏠', '❤️', '🔥', '🎮', '📚', '🎵', '💡', '🌍', '👥', '🔔', '✅', '🚀'];

interface Props {
  folder?: ChatFolder | null;
  onSave: (name: string, emoji: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function FolderModal({ folder, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(folder?.name ?? '');
  const [emoji, setEmoji] = useState(folder?.emoji ?? '📁');
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSave = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(name.trim(), emoji);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || busy) return;
    setBusy(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="folderModalCard">
        <div className="folderModalHeader">
          <span className="folderModalTitle">
            {folder ? 'Редактировать папку' : 'Новая папка'}
          </span>
          <button className="folderModalClose" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Emoji picker */}
        <div className="folderEmojiPicker">
          {EMOJI_OPTIONS.map(e => (
            <button
              key={e}
              className={`folderEmojiBtn${emoji === e ? ' selected' : ''}`}
              onClick={() => setEmoji(e)}
            >
              {e}
            </button>
          ))}
        </div>

        {/* Name input */}
        <div className="folderNameRow">
          <span className="folderNamePreview">{emoji}</span>
          <input
            ref={inputRef}
            className="folderNameInput"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={onKey}
            placeholder="Название папки…"
            maxLength={64}
          />
        </div>

        <div className="folderModalActions">
          {folder && onDelete && (
            deleteConfirm ? (
              <button className="folderBtnDanger" onClick={handleDelete} disabled={busy}>
                {busy ? '…' : 'Удалить?'}
              </button>
            ) : (
              <button className="folderBtnDanger" onClick={() => setDeleteConfirm(true)}>
                Удалить
              </button>
            )
          )}
          <div style={{ flex: 1 }} />
          <button className="folderBtnCancel" onClick={onClose} disabled={busy}>Отмена</button>
          <button className="folderBtnSave" onClick={handleSave} disabled={!name.trim() || busy}>
            {busy ? '…' : folder ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}
