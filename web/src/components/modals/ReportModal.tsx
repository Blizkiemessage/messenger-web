/**
 * ReportModal — общая форма жалобы (на сообщение или на пользователя).
 * Открывается из контекстного меню сообщения / профиля пользователя.
 * Причина + необязательный комментарий → onSubmit(reason).
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<unknown>;
}

const REASONS = ['Спам', 'Оскорбления или агрессия', 'Незаконный контент', 'Другое'];

export function ReportModal({ title, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState(REASONS[0]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const full = comment.trim() ? `${reason}: ${comment.trim()}` : reason;
      await onSubmit(full);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить жалобу');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="atcOverlay" onClick={onClose}>
      <div className="atcModal" onClick={e => e.stopPropagation()}>
        <div className="atcHead">
          <span className="atcTitle">{title}</span>
          <button className="atcClose" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        {done ? (
          <>
            <div className="colEmpty">Спасибо, жалоба отправлена. Мы её рассмотрим.</div>
            <button className="colAddBtn" onClick={onClose}>Закрыть</button>
          </>
        ) : (
          <>
            <select
              className="authInput"
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={busy}
            >
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <textarea
              className="authInput rprtTextarea"
              placeholder="Комментарий (необязательно)"
              value={comment}
              maxLength={500}
              disabled={busy}
              onChange={e => setComment(e.target.value)}
            />
            {error && <div className="colError">{error}</div>}
            <button className="colAddBtn" disabled={busy} onClick={handleSubmit}>
              {busy ? '…' : 'Отправить жалобу'}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
