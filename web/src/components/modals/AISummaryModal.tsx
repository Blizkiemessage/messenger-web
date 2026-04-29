import { useState, useEffect, useRef } from 'react';
import { getChatSummary, type SummaryResult } from '../../api/summary';

interface Props {
  chatId: string;
  chatTitle: string;
  onClose: () => void;
}

export function AISummaryModal({ chatId, chatTitle, onClose }: Props) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    getChatSummary(chatId)
      .then(r => { setResult(r); setState('ok'); })
      .catch(e => {
        const msg = e?.response?.data?.error || e?.message || 'Неизвестная ошибка';
        setErrMsg(msg);
        setState('error');
      });
  }, [chatId]);

  function handleRefresh() {
    setState('loading');
    setResult(null);
    setErrMsg('');
    getChatSummary(chatId + '?refresh=' + Date.now())
      .then(r => { setResult(r); setState('ok'); })
      .catch(e => {
        const msg = e?.response?.data?.error || e?.message || 'Неизвестная ошибка';
        setErrMsg(msg);
        setState('error');
      });
  }

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modalCard aiSummaryCard">
        <div className="modalHeader">
          <div className="aiSummaryHeaderLeft">
            <span className="aiSummaryIcon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            </span>
            <span className="modalTitle">AI-сводка</span>
          </div>
          <button className="modalClose" onClick={onClose} title="Закрыть">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="aiSummaryChatName">{chatTitle}</div>

        <div className="modalBody aiSummaryBody">
          {state === 'loading' && (
            <div className="aiSummaryLoading">
              <div className="aiSummarySpinner"/>
              <span>Анализирую переписку…</span>
            </div>
          )}

          {state === 'ok' && result && (
            <>
              <p className="aiSummaryText">{result.summary}</p>
              <div className="aiSummaryMeta">
                <span>На основе {result.messageCount} сообщ.</span>
                {result.fromCache && <span className="aiSummaryCacheBadge">из кеша</span>}
              </div>
            </>
          )}

          {state === 'error' && (
            <div className="aiSummaryError">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{errMsg}</span>
            </div>
          )}
        </div>

        {(state === 'ok' || state === 'error') && (
          <div className="aiSummaryFooter">
            <button className="aiSummaryRefreshBtn" onClick={handleRefresh}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Обновить
            </button>
            <button className="aiSummaryCloseBtn" onClick={onClose}>Закрыть</button>
          </div>
        )}
      </div>
    </div>
  );
}
