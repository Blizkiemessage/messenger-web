import { useEffect, useState, useCallback, useRef } from 'react';
import { useStickerStore } from '../../store/useStickerStore';
import { browsePublicPacks, installPack, uninstallPack, getPackItems } from '../../api/sticker-packs';
import { type StickerPack, type StickerPackItem } from '../../types';

interface Props {
  onSendSticker: (url: string, itemId: string, packId: string) => void;
  onOpenStudio: () => void;
}

type Mode = 'browse' | 'grid';

export function StickersTab({ onSendSticker, onOpenStudio }: Props) {
  const { installedPacks, packItems, recentStickers, fetchInstalledPacks, fetchPackItems } =
    useStickerStore();

  const [mode, setMode] = useState<Mode>('grid');
  const [activePackId, setActivePackId] = useState<'recent' | string>('recent');
  const [items, setItems] = useState<StickerPackItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Browse state
  const [browseQuery, setBrowseQuery]     = useState('');
  const [browseResults, setBrowseResults] = useState<(StickerPack & { is_installed: boolean })[]>([]);
  const [browsing, setBrowsing]           = useState(false);
  const [browsePreviewPack, setBrowsePreviewPack] = useState<StickerPack | null>(null);
  const [browsePreviewItems, setBrowsePreviewItems] = useState<StickerPackItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [installingId, setInstallingId]   = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    fetchInstalledPacks();
  }, [fetchInstalledPacks]);

  // Sync items from store
  useEffect(() => {
    if (mode !== 'grid') return;
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
  }, [activePackId, packItems, recentStickers, fetchPackItems, mode]);

  // Load initial browse results when entering browse mode
  useEffect(() => {
    if (mode !== 'browse') return;
    runBrowse('');
  }, [mode]); // eslint-disable-line

  function handleSend(item: StickerPackItem) {
    useStickerStore.getState().addRecent(item);
    onSendSticker(item.file_url, item.id, item.pack_id);
  }

  const runBrowse = useCallback(async (q: string) => {
    setBrowsing(true);
    try {
      const results = await browsePublicPacks({ q: q.trim(), limit: 30 });
      setBrowseResults(results);
    } catch { /* ignore */ } finally {
      setBrowsing(false);
    }
  }, []);

  function handleSearchChange(val: string) {
    setBrowseQuery(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runBrowse(val), 350);
  }

  async function handlePreviewPack(pack: StickerPack & { is_installed: boolean }) {
    setBrowsePreviewPack(pack);
    setBrowsePreviewItems([]);
    setPreviewLoading(true);
    try {
      const its = await getPackItems(pack.id);
      setBrowsePreviewItems(its);
    } catch { /* ignore */ } finally {
      setPreviewLoading(false);
    }
  }

  async function handleInstall(pack: StickerPack & { is_installed: boolean }) {
    setInstallingId(pack.id);
    try {
      if (pack.is_installed) {
        await uninstallPack(pack.id);
        setBrowseResults(prev => prev.map(p => p.id === pack.id ? { ...p, is_installed: false } : p));
        if (browsePreviewPack?.id === pack.id) setBrowsePreviewPack({ ...browsePreviewPack, is_installed: false } as any);
      } else {
        await installPack(pack.id);
        setBrowseResults(prev => prev.map(p => p.id === pack.id ? { ...p, is_installed: true } : p));
        if (browsePreviewPack?.id === pack.id) setBrowsePreviewPack({ ...browsePreviewPack, is_installed: true } as any);
      }
      await fetchInstalledPacks();
    } catch { /* ignore */ } finally {
      setInstallingId(null);
    }
  }

  const hasRecent = recentStickers.length > 0;

  // ── Browse mode ───────────────────────────────────────────────────────────
  if (mode === 'browse') {
    return (
      <div className="stickersTabRoot">
        <div className="stickerBrowseHeader">
          <button className="stickerBrowseBack" onClick={() => { setMode('grid'); setBrowsePreviewPack(null); setBrowseQuery(''); }}
            title="Назад">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <input
            className="stickerBrowseSearch"
            placeholder="Поиск публичных паков…"
            value={browseQuery}
            onChange={e => handleSearchChange(e.target.value)}
            autoFocus
          />
        </div>

        {browsePreviewPack ? (
          /* Pack preview */
          <div className="stickerBrowsePreview">
            <div className="stickerBrowsePreviewHeader">
              <button className="stickerBrowseBack" onClick={() => setBrowsePreviewPack(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              <div className="stickerBrowsePreviewThumb">
                {browsePreviewPack.cover_url
                  ? <img src={browsePreviewPack.cover_url} alt={browsePreviewPack.name} />
                  : <span>{browsePreviewPack.name[0]}</span>}
              </div>
              <div className="stickerBrowsePreviewInfo">
                <div className="stickerBrowsePreviewName">{browsePreviewPack.name}</div>
                {browsePreviewPack.description && (
                  <div className="stickerBrowsePreviewDesc">{browsePreviewPack.description}</div>
                )}
              </div>
              <button
                className={`stickerInstallBtn${(browsePreviewPack as any).is_installed ? ' installed' : ''}`}
                disabled={installingId === browsePreviewPack.id}
                onClick={() => handleInstall(browsePreviewPack as any)}
              >
                {installingId === browsePreviewPack.id
                  ? '…'
                  : (browsePreviewPack as any).is_installed ? 'Удалить' : 'Установить'}
              </button>
            </div>
            {previewLoading && <div className="stickerLoading"><div className="gifSpinner" /></div>}
            <div className="stickerGrid">
              {browsePreviewItems.map(item => (
                <button key={item.id} className="stickerItem"
                  title={item.emoji_hint || 'Стикер'}
                  onClick={() => (browsePreviewPack as any).is_installed && handleSend(item)}>
                  <img src={item.thumb_url || item.file_url} alt={item.emoji_hint || 'Стикер'} loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Browse results */
          <div className="stickerBrowseList">
            {browsing && <div className="stickerLoading"><div className="gifSpinner" /></div>}
            {!browsing && browseResults.length === 0 && (
              <div className="stickerEmpty"><span>Публичных паков не найдено</span></div>
            )}
            {!browsing && browseResults.map(pack => (
              <div key={pack.id} className="stickerBrowseRow" onClick={() => handlePreviewPack(pack)}>
                <div className="stickerPackIcon" style={{ flexShrink: 0 }}>
                  {pack.cover_url
                    ? <img src={pack.cover_url} alt={pack.name} />
                    : <span className="stickerPackIconFallback">{pack.name[0]}</span>}
                </div>
                <div className="stickerBrowseRowInfo">
                  <div className="stickerBrowseRowName">{pack.name}</div>
                  <div className="stickerBrowseRowMeta">{(pack as any).item_count ?? 0} стикеров</div>
                </div>
                <button
                  className={`stickerInstallBtn${pack.is_installed ? ' installed' : ''}`}
                  disabled={installingId === pack.id}
                  onClick={e => { e.stopPropagation(); handleInstall(pack); }}
                >
                  {installingId === pack.id ? '…' : pack.is_installed ? '✓' : '+'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Grid mode ─────────────────────────────────────────────────────────────
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
          <button key={pack.id}
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

        {/* Browse button */}
        <button
          className="stickerPackIcon stickerPackIconBtn"
          onClick={() => setMode('browse')}
          title="Найти паки"
          style={{ marginLeft: 'auto' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
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
            <button className="stickerEmptyStudioBtn" onClick={() => setMode('browse')}>
              Найти публичные паки →
            </button>
          </div>
        )}

        {!loading && items.filter(it => it?.id).map(item => (
          <button key={item.id} className="stickerItem" onClick={() => handleSend(item)}
            title={item.emoji_hint || 'Стикер'}>
            <img src={item.thumb_url || item.file_url} alt={item.emoji_hint || 'Стикер'} loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}
