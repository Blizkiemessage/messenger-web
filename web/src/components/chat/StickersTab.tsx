import { useEffect, useState } from 'react';
import { useStickerStore } from '../../store/useStickerStore';
import { type StickerPackItem } from '../../types';

interface Props {
  onSendSticker: (url: string, itemId: string, packId: string) => void;
  onOpenStudio: () => void;
}

export function StickersTab({ onSendSticker, onOpenStudio }: Props) {
  const { installedPacks, packItems, recentStickers, fetchInstalledPacks, fetchPackItems } =
    useStickerStore();
  const [activePackId, setActivePackId] = useState<'recent' | string>('recent');
  const [items, setItems] = useState<StickerPackItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchInstalledPacks();
  }, [fetchInstalledPacks]);

  // Sync items from store when active pack or store state changes
  useEffect(() => {
    if (activePackId === 'recent') {
      setItems(recentStickers);
      return;
    }
    const cached = packItems[activePackId];
    if (cached) {
      setItems(cached);
      setLoading(false);
    } else {
      setLoading(true);
      fetchPackItems(activePackId);
    }
  }, [activePackId, packItems, recentStickers, fetchPackItems]);

  function handleSend(item: StickerPackItem) {
    useStickerStore.getState().addRecent(item);
    onSendSticker(item.file_url, item.id, item.pack_id);
  }

  const hasRecent = recentStickers.length > 0;

  return (
    <div className="stickersTabRoot">
      {/* Pack strip */}
      <div className="stickerPackStrip">
        {/* Recent */}
        <button
          className={`stickerPackIcon stickerPackIconBtn${activePackId === 'recent' ? ' active' : ''}`}
          onClick={() => setActivePackId('recent')}
          title="Недавние"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </button>

        {installedPacks.filter(p => p?.id).map(pack => (
          <button
            key={pack.id}
            className={`stickerPackIcon${activePackId === pack.id ? ' active' : ''}`}
            onClick={() => setActivePackId(pack.id)}
            title={pack.name}
          >
            {pack.cover_url
              ? <img src={pack.cover_url} alt={pack.name} />
              : <span className="stickerPackIconFallback">{pack.name[0]}</span>
            }
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="stickerGrid">
        {loading && (
          <div className="stickerLoading"><div className="gifSpinner" /></div>
        )}

        {!loading && activePackId === 'recent' && !hasRecent && (
          <div className="stickerEmpty">
            <span>Нет недавних стикеров</span>
          </div>
        )}

        {!loading && activePackId !== 'recent' && items.length === 0 && (
          <div className="stickerEmpty">
            <span>Пак пуст</span>
          </div>
        )}

        {!loading && installedPacks.length === 0 && activePackId === 'recent' && (
          <div className="stickerEmpty">
            <span>Нет установленных паков.</span>
            <button className="stickerEmptyStudioBtn" onClick={onOpenStudio}>
              Создай свой в Студии →
            </button>
          </div>
        )}

        {!loading && items.filter(it => it?.id).map(item => (
          <button
            key={item.id}
            className="stickerItem"
            onClick={() => handleSend(item)}
            title={item.emoji_hint || 'Стикер'}
          >
            <img src={item.thumb_url || item.file_url} alt={item.emoji_hint || 'Стикер'} loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}
