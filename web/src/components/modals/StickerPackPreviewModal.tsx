/**
 * StickerPackPreviewModal — opens when user taps a public sticker in chat.
 * Shows the full pack with its stickers, an "Add / Remove" button, and a report option.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getPackById, getPackItems, installPack, uninstallPack, reportPack } from '../../api/sticker-packs';
import { useStickerStore } from '../../store/useStickerStore';
import { type StickerPack, type StickerPackItem } from '../../types';
import { StickerMedia } from '../ui/StickerMedia';
import { PackCover } from '../ui/PackCover';

interface Props {
  packId: string;
  onClose: () => void;
}

type View = 'preview' | 'report';

export function StickerPackPreviewModal({ packId, onClose }: Props) {
  const { t } = useTranslation('modals');
  const [pack, setPack]       = useState<(StickerPack & { is_installed: boolean }) | null>(null);
  const [items, setItems]     = useState<StickerPackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);

  const [view, setView]             = useState<View>('preview');
  const [reportReason, setReportReason] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [reportDone, setReportDone]   = useState(false);
  const [reportError, setReportError] = useState('');

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    Promise.all([getPackById(packId), getPackItems(packId)])
      .then(([p, its]) => { setPack(p); setItems(its); })
      .catch(onClose)
      .finally(() => setLoading(false));
  }, [packId]); // eslint-disable-line

  async function handleToggle() {
    if (!pack) return;
    setInstalling(true);
    try {
      if (pack.is_installed) {
        await uninstallPack(pack.id);
        setPack(p => p ? { ...p, is_installed: false } : p);
      } else {
        await installPack(pack.id);
        setPack(p => p ? { ...p, is_installed: true } : p);
      }
      useStickerStore.getState().fetchInstalledPacks();
    } catch { /* ignore */ } finally {
      setInstalling(false);
    }
  }

  async function handleReport() {
    if (!reportReason.trim()) return;
    setReportSending(true);
    setReportError('');
    try {
      await reportPack(packId, reportReason.trim());
      setReportDone(true);
    } catch (e: any) {
      setReportError(e?.response?.data?.error || t('stickerPackPreview.reportError'));
    } finally {
      setReportSending(false);
    }
  }

  return createPortal(
    <div
      className="packPreviewOverlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="packPreviewModal">
        {/* Header */}
        <div className="packPreviewHeader">
          {view === 'report' ? (
            <button className="packPreviewBack" onClick={() => { setView('preview'); setReportError(''); }} title={t('common:back')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
          ) : (
            <span className="packPreviewTitle">{t('stickerPackPreview.title')}</span>
          )}
          {view === 'report' && <span className="packPreviewTitle">{t('stickerPackPreview.reportTitle')}</span>}
          <button className="packPreviewClose" onClick={onClose} title={t('common:close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="packPreviewLoading"><div className="gifSpinner" /></div>
        ) : pack && view === 'preview' ? (
          <>
            {/* Report link row */}
            <div className="packPreviewReportRow">
              <button className="packPreviewReportBtn" onClick={() => setView('report')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                  <line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
                {t('stickerPackPreview.reportPack')}
              </button>
            </div>

            {/* Pack identity */}
            <div className="packPreviewIdentity">
              <div className="packPreviewLogo">
                <PackCover url={pack.cover_url} name={pack.name} />
              </div>
              <div className="packPreviewInfo">
                <div className="packPreviewName">{pack.name}</div>
                {pack.description && (
                  <div className="packPreviewDesc">{pack.description}</div>
                )}
                <div className="packPreviewCount">
                  {t('stickerPackPreview.stickerCount', { count: (pack as any).item_count ?? items.length })}
                </div>
              </div>
            </div>

            {/* Stickers grid */}
            <div className="packPreviewGrid">
              {items.map(item => (
                <div key={item.id} className="packPreviewCell" title={item.emoji_hint || t('stickerPackPreview.sticker')}>
                  <StickerMedia
                    fileUrl={item.file_url}
                    thumbUrl={item.thumb_url}
                    alt={item.emoji_hint || t('stickerPackPreview.sticker')}
                  />
                </div>
              ))}
            </div>

            {/* Footer: add / remove button */}
            <div className="packPreviewFooter">
              <button
                className={`packPreviewBtn${pack.is_installed ? ' packPreviewBtnRemove' : ''}`}
                disabled={installing}
                onClick={handleToggle}
              >
                {installing
                  ? '…'
                  : pack.is_installed
                    ? t('stickerPackPreview.removeFromMine')
                    : t('stickerPackPreview.addStickers')}
              </button>
            </div>
          </>
        ) : pack && view === 'report' ? (
          <div className="packReportView">
            {reportDone ? (
              <div className="packReportDone">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <p className="packReportDoneTitle">{t('stickerPackPreview.reportSent')}</p>
                <p className="packReportDoneDesc">{t('stickerPackPreview.reportSentDesc')}</p>
                <button className="packPreviewBtn" style={{ marginTop: 16 }} onClick={onClose}>{t('common:close')}</button>
              </div>
            ) : (
              <>
                <div className="packReportPackInfo">
                  <div className="packReportLogo">
                    <PackCover url={pack.cover_url} name={pack.name} />
                  </div>
                  <div className="packReportPackName">{pack.name}</div>
                </div>

                <label className="packReportLabel">{t('stickerPackPreview.reportReasonLabel')}</label>
                <textarea
                  className="packReportTextarea"
                  placeholder={t('stickerPackPreview.reportReasonPlaceholder')}
                  maxLength={1000}
                  value={reportReason}
                  onChange={e => setReportReason(e.target.value)}
                  rows={4}
                />
                {reportError && <p className="packReportError">{reportError}</p>}
                <button
                  className="packPreviewBtn"
                  disabled={!reportReason.trim() || reportSending}
                  onClick={handleReport}
                  style={{ marginTop: 12 }}
                >
                  {reportSending ? '…' : t('report.submit')}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
