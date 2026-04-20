import { useState, useEffect, useCallback } from 'react';
import { getSessions, revokeSession, revokeAllOtherSessions, type Session } from '../../api/sessions';

function formatActivity(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)        return 'только что';
  if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)} мин. назад`;
  if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)} ч. назад`;
  if (diff < 86_400_000 * 7) {
    const d = Math.floor(diff / 86_400_000);
    return `${d} ${d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'} назад`;
  }
  return new Date(ts).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' });
}

function DeviceIcon({ device }: { device: string }) {
  const isMobile = /iPhone|iPad|Android/i.test(device);
  return isMobile ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2"/>
      <line x1="12" y1="18" x2="12.01" y2="18"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  );
}

export function SessionsTab() {
  const [sessions,    setSessions]    = useState<Session[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [revoking,    setRevoking]    = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await getSessions());
    } catch {
      setError('Не удалось загрузить сессии');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRevoke = useCallback(async (id: string) => {
    setRevoking(id);
    try {
      await revokeSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch {
      setError('Не удалось завершить сессию');
    } finally {
      setRevoking(null);
    }
  }, []);

  const handleRevokeAll = useCallback(async () => {
    setRevokingAll(true);
    try {
      await revokeAllOtherSessions();
      setSessions(prev => prev.filter(s => s.is_current));
    } catch {
      setError('Не удалось завершить сессии');
    } finally {
      setRevokingAll(false);
    }
  }, []);

  const otherCount = sessions.filter(s => !s.is_current).length;

  if (loading) {
    return (
      <div className="psBody">
        <div className="sessionsLoading">Загрузка…</div>
      </div>
    );
  }

  return (
    <div className="psBody">
      {error && <div className="psError">{error}</div>}

      {otherCount > 0 && (
        <button
          className="sessionsRevokeAllBtn"
          onClick={handleRevokeAll}
          disabled={revokingAll}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          {revokingAll ? 'Завершение…' : 'Завершить все остальные'}
        </button>
      )}

      {sessions.length === 0 && !error && (
        <div className="sessionsEmpty">Нет активных сессий</div>
      )}

      <div className="sessionsList">
        {sessions.map(s => (
          <div key={s.id} className={`sessionsItem${s.is_current ? ' sessionsItemCurrent' : ''}`}>
            <div className="sessionsIcon">
              <DeviceIcon device={s.device} />
            </div>
            <div className="sessionsInfo">
              <div className="sessionsDevice">
                {s.device}
                {s.is_current && <span className="sessionsCurrentBadge">текущая</span>}
              </div>
              <div className="sessionsMeta">
                Активна {formatActivity(s.last_used_at)}
              </div>
              {s.ip_address && (
                <div className="sessionsIp">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="2" y1="12" x2="22" y2="12"/>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  </svg>
                  {s.ip_address}
                </div>
              )}
            </div>
            {!s.is_current && (
              <button
                className="sessionsRevokeBtn"
                onClick={() => handleRevoke(s.id)}
                disabled={revoking === s.id}
                title="Завершить сессию"
              >
                {revoking === s.id ? '…' : 'Завершить'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
