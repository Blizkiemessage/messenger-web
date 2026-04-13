/**
 * StickerPackPreviewModal — opens when user taps a public sticker in chat.
 * Shows the full pack with its stickers and an "Add / Remove" button.
 * Only shown for public packs — private packs are silently ignored upstream.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPackById, getPackItems, installPack, uninstallPack } from '../../api/sticker-packs';
import { useStickerStore } from '../../store/useStickerStore';
import { type StickerPack, type StickerPackItem } from '../../types';
import { StickerMedia } from '../ui/StickerMedia';
import { PackCover } from '../ui/PackCover';

interface Props {
  packId: string;
  onClose: () => void;
}

export function StickerPackPreviewModal({ packId, onClose }: Props) {
  const [pack, setPack]       = useState<(StickerPack & { is_installed: boolean }) | null>(null);
  const [items, setItems]     = useState<StickerPackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);

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

  return createPortal(
    <div
      className="packPreviewOverlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="packPreviewModal">
        {/* Header with close */}
        <div className="packPreviewHeader">
          <span className="packPreviewTitle">Стикерпак</span>
          <button className="packPreviewClose" onClick={onClose} title="Закрыть">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="packPreviewLoading"><div className="gifSpinner" /></div>
        ) : pack ? (
          <>
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
                  {(pack as any).item_count ?? items.length} стикеров
                </div>
              </div>
            </div>

            {/* Stickers grid */}
            <div className="packPreviewGrid">
              {items.map(item => (
                <div key={item.id} className="packPreviewCell" title={item.emoji_hint || 'Стикер'}>
                  <StickerMedia
                    fileUrl={item.file_url}
                    thumbUrl={item.thumb_url}
                    alt={item.emoji_hint || 'Стикер'}
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
                    ? 'Удалить из моих'
                    : 'Добавить стикеры'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
