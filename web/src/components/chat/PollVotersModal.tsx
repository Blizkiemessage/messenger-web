import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getPollVoters } from '../../api/polls';
import type { User } from '../../types';
import { Avatar } from '../ui/Avatar';

interface Props {
  pollId: string;
  optionId: string;
  optionText: string;
  onClose: () => void;
}

export function PollVotersModal({ pollId, optionId, optionText, onClose }: Props) {
  const { t } = useTranslation('chat');
  const [voters, setVoters] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getPollVoters(pollId, optionId)
      .then(v => setVoters(v))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [pollId, optionId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  return createPortal(
    <div className="modalOverlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="modalCard" style={{ width: 340, maxWidth: '95vw' }}>
        <div className="modalHeader">
          <div className="modalTitle">{t('poll.votersTitle', { option: optionText })}</div>
          <button className="modalClose" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="modalBody">
          {loading && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '16px 0' }}>{t('common:loading')}</div>}
          {error && <div className="modalError">{error}</div>}
          {!loading && !error && voters.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '16px 0' }}>{t('poll.noVotes')}</div>
          )}
          {voters.map(u => (
            <div key={u.id} className="modalUserItem" style={{ cursor: 'default' }}>
              <Avatar user={u} size={36} radius={10} />
              <div className="modalUserInfo">
                <div className="modalUserName">{u.display_name || u.username || u.id}</div>
                {u.username && u.display_name && (
                  <div className="modalUserSub">@{u.username}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
