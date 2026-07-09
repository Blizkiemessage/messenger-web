import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getSessions, revokeSession, revokeAllOtherSessions, type Session } from '../../api/sessions';

function formatActivity(ts: number, t: (k: string, o?: any) => string, locale: string): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)        return t('common:justNow');
  if (diff < 3_600_000)     return t('sessions.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000)    return t('sessions.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  if (diff < 86_400_000 * 7) {
    return t('sessions.daysAgo', { count: Math.floor(diff / 86_400_000) });
  }
  return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
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
  const { t, i18n } = useTranslation('settings');
  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
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
      setError(t('sessions.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleRevoke = useCallback(async (id: string) => {
    setRevoking(id);
    try {
      await revokeSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch {
      setError(t('sessions.revokeError'));
    } finally {
      setRevoking(null);
    }
  }, [t]);

  const handleRevokeAll = useCallback(async () => {
    setRevokingAll(true);
    try {
      await revokeAllOtherSessions();
      setSessions(prev => prev.filter(s => s.is_current));
    } catch {
      setError(t('sessions.revokeAllError'));
    } finally {
      setRevokingAll(false);
    }
  }, [t]);

  const otherCount = sessions.filter(s => !s.is_current).length;

  if (loading) {
    return (
      <div className="psBody">
        <div className="sessionsLoading">{t('common:loading')}</div>
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
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'scaleX(-1)' }}>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          {revokingAll ? t('sessions.revokingAll') : t('sessions.revokeAllBtn')}
        </button>
      )}

      {sessions.length === 0 && !error && (
        <div className="sessionsEmpty">{t('sessions.noActiveSessions')}</div>
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
                {s.is_current && <span className="sessionsCurrentBadge">{t('sessions.currentBadge')}</span>}
              </div>
              <div className="sessionsMeta">
                {t('sessions.activeAgo', { time: formatActivity(s.last_used_at, t, locale) })}
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
                title={t('sessions.revokeSessionTitle')}
              >
                {revoking === s.id ? '…' : t('sessions.revokeBtn')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
