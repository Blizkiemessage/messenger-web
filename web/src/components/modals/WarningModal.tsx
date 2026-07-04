/**
 * WarningModal — shows unacknowledged moderation warnings (services/moderationService.js
 * on the backend) one at a time until the user dismisses each with "Понятно".
 * Mounted unconditionally in App.tsx while logged in; fetches once on mount.
 */
import { useState, useEffect } from 'react';
import { getUnacknowledgedWarnings, acknowledgeWarning, type Warning } from '../../api/users';

export function WarningModal() {
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getUnacknowledgedWarnings().then(setWarnings).catch(() => {});
  }, []);

  if (warnings.length === 0) return null;
  const current = warnings[0];

  async function handleAck() {
    setBusy(true);
    try {
      await acknowledgeWarning(current.id);
      setWarnings(w => w.slice(1));
    } catch {
      // Leave it in the list — will be re-fetched and shown again next load.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalOverlay" style={{ zIndex: 10500 }}>
      <div className="confirmCard">
        <div className="confirmIcon" style={{ color: 'var(--danger)' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="confirmTitle">Предупреждение от администрации</div>
        <div className="confirmText">{current.message}</div>
        <div className="confirmBtns">
          <button className="psDeleteConfirmBtn" style={{ width: '100%' }} disabled={busy} onClick={handleAck}>
            {busy ? '…' : 'Понятно'}
          </button>
        </div>
      </div>
    </div>
  );
}
