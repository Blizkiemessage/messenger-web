import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getChatSummary, type SummaryPeriod, type SummaryFormat, type SummaryResult } from '../../api/summary';

interface Props {
  chatId: string;
  chatTitle: string;
  onClose: () => void;
}

export function AISummaryModal({ chatId, chatTitle, onClose }: Props) {
  const { t } = useTranslation('modals');

  const PERIOD_OPTIONS: { value: SummaryPeriod; label: string }[] = [
    { value: 'unread', label: t('aiSummary.periodUnread')  },
    { value: '1h',     label: t('aiSummary.period1h')       },
    { value: '6h',     label: t('aiSummary.period6h')       },
    { value: '24h',    label: t('aiSummary.period24h')      },
    { value: '3d',     label: t('aiSummary.period3d')       },
    { value: '7d',     label: t('aiSummary.period7d')       },
    { value: '30d',    label: t('aiSummary.period30d')      },
    { value: 'all',    label: t('aiSummary.periodAll')      },
  ];

  const FORMAT_OPTIONS: { value: SummaryFormat; label: string; hint: string }[] = [
    { value: 'short',    label: t('aiSummary.formatShort'),    hint: t('aiSummary.formatShortHint')    },
    { value: 'normal',   label: t('aiSummary.formatNormal'),   hint: t('aiSummary.formatNormalHint')   },
    { value: 'detailed', label: t('aiSummary.formatDetailed'), hint: t('aiSummary.formatDetailedHint') },
  ];

  const [period, setPeriod]   = useState<SummaryPeriod>('unread');
  const [format, setFormat]   = useState<SummaryFormat>('normal');
  const [status, setStatus]   = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [result, setResult]   = useState<SummaryResult | null>(null);
  const [errMsg, setErrMsg]   = useState('');

  async function generate(p: SummaryPeriod, f: SummaryFormat) {
    setStatus('loading');
    setResult(null);
    setErrMsg('');
    try {
      const r = await getChatSummary(chatId, p, f);
      setResult(r);
      setStatus('ok');
    } catch (e: any) {
      setErrMsg(e?.response?.data?.error || e?.message || t('aiSummary.unknownError'));
      setStatus('error');
    }
  }

  const periodLabel = PERIOD_OPTIONS.find(o => o.value === period)?.label ?? '';
  const formatLabel = FORMAT_OPTIONS.find(o => o.value === format)?.label ?? '';

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modalCard aiSummaryCard">

        {/* Header */}
        <div className="modalHeader">
          <div className="aiSummaryHeaderLeft">
            <span className="aiSummaryIcon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </span>
            <span className="modalTitle">{t('aiSummary.title')}</span>
          </div>
          <button className="modalClose" onClick={onClose} title={t('common:close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="aiSummaryChatName">{chatTitle}</div>

        <div className="modalBody aiSummaryBody">

          {/* Options */}
          <div className="aiSummarySection">
            <div className="aiSummarySectionTitle">{t('aiSummary.periodTitle')}</div>
            <div className="aiSummaryChips">
              {PERIOD_OPTIONS.map(o => (
                <button
                  key={o.value}
                  className={`aiSummaryChip${period === o.value ? ' active' : ''}`}
                  onClick={() => setPeriod(o.value)}
                  disabled={status === 'loading'}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="aiSummarySection">
            <div className="aiSummarySectionTitle">{t('aiSummary.formatTitle')}</div>
            <div className="aiSummaryFormatRow">
              {FORMAT_OPTIONS.map(o => (
                <button
                  key={o.value}
                  className={`aiSummaryFormatBtn${format === o.value ? ' active' : ''}`}
                  onClick={() => setFormat(o.value)}
                  disabled={status === 'loading'}
                >
                  <span className="aiSummaryFormatLabel">{o.label}</span>
                  <span className="aiSummaryFormatHint">{o.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          {status !== 'idle' && <div className="aiSummaryDivider" />}

          {/* Loading */}
          {status === 'loading' && (
            <div className="aiSummaryLoading">
              <div className="aiSummarySpinner"/>
              <span>{t('aiSummary.analyzing')}</span>
            </div>
          )}

          {/* Result */}
          {status === 'ok' && result && (
            <div className="aiSummaryResult">
              <p className="aiSummaryText">
                {result.summary || t('aiSummary.noMessages')}
              </p>
              <div className="aiSummaryMeta">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
                <span>{result.messageCount != null ? t('aiSummary.messageCount', { count: result.messageCount }) : t('aiSummary.messageCountUnknown')} · {periodLabel} · {formatLabel}</span>
                {result.fromCache && <span className="aiSummaryCacheBadge">{t('aiSummary.cacheBadge')}</span>}
              </div>
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="aiSummaryError">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{errMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="aiSummaryFooter">
          {(status === 'ok' || status === 'error') && (
            <button className="aiSummaryRefreshBtn" onClick={() => generate(period, format)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              {t('aiSummary.refresh')}
            </button>
          )}
          {status !== 'loading' && (
            <button className="aiSummaryGenBtn" onClick={() => generate(period, format)}>
              {status === 'idle' ? t('aiSummary.generate') : t('aiSummary.change')}
            </button>
          )}
          <button className="aiSummaryCloseBtn" onClick={onClose}>{t('common:close')}</button>
        </div>
      </div>
    </div>
  );
}
