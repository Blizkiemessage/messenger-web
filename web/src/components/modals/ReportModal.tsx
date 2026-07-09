/**
 * ReportModal — общая форма жалобы (на сообщение или на пользователя).
 * Открывается из контекстного меню сообщения / профиля пользователя.
 * Причина + необязательный комментарий → onSubmit(reason).
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<unknown>;
}

export function ReportModal({ title, onClose, onSubmit }: Props) {
  const { t } = useTranslation('modals');
  const REASONS = [
    t('report.reasonSpam'), t('report.reasonAbuse'), t('report.reasonIllegal'), t('report.reasonOther'),
  ];
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
      setError(e instanceof Error ? e.message : t('report.submitError'));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="atcOverlay" onClick={onClose}>
      <div className="atcModal" onClick={e => e.stopPropagation()}>
        <div className="atcHead">
          <span className="atcTitle">{title}</span>
          <button className="atcClose" onClick={onClose} aria-label={t('common:close')}>✕</button>
        </div>

        {done ? (
          <>
            <div className="colEmpty">{t('report.thanks')}</div>
            <button className="colAddBtn" onClick={onClose}>{t('common:close')}</button>
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
              placeholder={t('report.commentPlaceholder')}
              value={comment}
              maxLength={500}
              disabled={busy}
              onChange={e => setComment(e.target.value)}
            />
            {error && <div className="colError">{error}</div>}
            <button className="colAddBtn" disabled={busy} onClick={handleSubmit}>
              {busy ? '…' : t('report.submit')}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
