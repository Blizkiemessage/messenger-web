import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadMyData } from '../../api/export';

type Status = 'idle' | 'loading' | 'done' | 'rate-limited' | 'error';

export function ExportDataTab() {
  const { t } = useTranslation('settings');
  const CONTENTS = [
    { label: t('exportData.contentProfile'),  desc: t('exportData.contentProfileDesc') },
    { label: t('exportData.contentMessages'), desc: t('exportData.contentMessagesDesc') },
    { label: t('exportData.contentFriends'),  desc: t('exportData.contentFriendsDesc') },
    { label: t('exportData.contentSessions'), desc: t('exportData.contentSessionsDesc') },
  ];
  const [status, setStatus] = useState<Status>('idle');

  async function handleExport() {
    setStatus('loading');
    try {
      await downloadMyData();
      setStatus('done');
    } catch (err: unknown) {
      const code = (err as { response?: { status?: number } })?.response?.status;
      setStatus(code === 429 ? 'rate-limited' : 'error');
    }
  }

  return (
    <div className="permTab">
      <p className="permTabHint">
        {t('exportData.hint')}
      </p>

      {/* What's included */}
      <div className="exportContents">
        {CONTENTS.map(item => (
          <div key={item.label} className="exportContentItem">
            <span className="exportCheckIcon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="3"
                   strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </span>
            <span>
              <span className="exportContentLabel">{item.label}</span>
              <span className="exportContentDesc"> — {item.desc}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Status notices */}
      {status === 'done' && (
        <div className="exportNotice exportNoticeOk">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {t('exportData.archiveReady')}
        </div>
      )}
      {status === 'rate-limited' && (
        <div className="exportNotice exportNoticeWarn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {t('exportData.rateLimited')}
        </div>
      )}
      {status === 'error' && (
        <div className="exportNotice exportNoticeErr">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          {t('exportData.createError')}
        </div>
      )}

      {/* Download button */}
      <button
        className="exportBtn"
        onClick={handleExport}
        disabled={status === 'loading' || status === 'done' || status === 'rate-limited'}
      >
        {status === 'loading' ? (
          <>
            <span className="exportBtnSpinner" aria-hidden="true" />
            {t('exportData.creating')}
          </>
        ) : (
          <>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {t('exportData.downloadBtn')}
          </>
        )}
      </button>

      <p className="exportNote">
        {t('exportData.formatNote')}
      </p>
    </div>
  );
}
