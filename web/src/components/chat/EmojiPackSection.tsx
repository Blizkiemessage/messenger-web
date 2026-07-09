/**
 * EmojiPackSection.tsx
 * Custom emoji picker — shown inside the Emoji tab of EmojiStickerPanel.
 * Displays installed emoji packs as an icon strip + scrollable emoji grid.
 * Clicking an emoji calls onSelectEmoji(packId, itemId, fileUrl).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStickerStore } from '../../store/useStickerStore';
import { browsePublicPacks, installPack, uninstallPack, getPackItems } from '../../api/sticker-packs';
import { PackCover } from '../ui/PackCover';
import { type StickerPack, type StickerPackItem } from '../../types';

interface Props {
  onSelectEmoji: (packId: string, itemId: string, fileUrl: string) => void;
  onOpenStudio: () => void;
}

type Mode = 'grid' | 'browse';

export function EmojiPackSection({ onSelectEmoji, onOpenStudio }: Props) {
  const { t } = useTranslation('chat');
  const { emojiPacks, packItems, fetchInstalledPacks, fetchPackItems } = useStickerStore();

  const [mode, setMode]                 = useState<Mode>('grid');
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [items, setItems]               = useState<StickerPackItem[]>([]);
  const [loading, setLoading]           = useState(false);

  // Browse state
  const [browseQuery, setBrowseQuery]       = useState('');
  const [browseType, setBrowseType]         = useState<'emoji' | 'sticker'>('emoji');
  const [browseResults, setBrowseResults]   = useState<(StickerPack & { is_installed: boolean })[]>([]);
  const [browsing, setBrowsing]             = useState(false);
  const [installingId, setInstallingId]     = useState<string | null>(null);
  const [browsePreview, setBrowsePreview]   = useState<(StickerPack & { is_installed: boolean }) | null>(null);
  const [previewItems, setPreviewItems]     = useState<StickerPackItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetchInstalledPacks();
  }, [fetchInstalledPacks]);

  // Auto-select first pack
  useEffect(() => {
    if (emojiPacks.length > 0 && !activePackId) {
      setActivePackId(emojiPacks[0].id);
    }
    if (emojiPacks.length === 0) setActivePackId(null);
  }, [emojiPacks, activePackId]);

  // Load items from store cache
  useEffect(() => {
    if (!activePackId || mode !== 'grid') return;
    const cached = packItems[activePackId];
    if (cached) {
      setItems(cached);
      setLoading(false);
    } else {
      setLoading(true);
      fetchPackItems(activePackId);
    }
  }, [activePackId, packItems, fetchPackItems, mode]);

  const loadBrowse = useCallback(async (q?: string, type?: 'emoji' | 'sticker') => {
    setBrowsing(true);
    try {
      const results = await browsePublicPacks({ q: q?.trim(), limit: 40, type: type ?? browseType } as any);
      setBrowseResults(results);
    } catch { /* ignore */ } finally {
      setBrowsing(false);
    }
  }, [browseType]); // eslint-disable-line

  useEffect(() => {
    if (mode === 'browse') loadBrowse(browseQuery, browseType);
  }, [mode]); // eslint-disable-line

  function handleBrowseSearch(val: string) {
    setBrowseQuery(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadBrowse(val, browseType), 350);
  }

  function handleBrowseTypeChange(type: 'emoji' | 'sticker') {
    setBrowseType(type);
    setBrowsePreview(null);
    clearTimeout(searchTimer.current);
    loadBrowse(browseQuery, type);
  }

  async function handleInstall(pack: StickerPack & { is_installed: boolean }) {
    setInstallingId(pack.id);
    try {
      if (pack.is_installed) {
        await uninstallPack(pack.id);
        setBrowseResults(prev => prev.map(p => p.id === pack.id ? { ...p, is_installed: false } : p));
        if (browsePreview?.id === pack.id) setBrowsePreview({ ...browsePreview, is_installed: false });
      } else {
        await installPack(pack.id);
        setBrowseResults(prev => prev.map(p => p.id === pack.id ? { ...p, is_installed: true } : p));
        if (browsePreview?.id === pack.id) setBrowsePreview({ ...browsePreview, is_installed: true });
      }
      await fetchInstalledPacks();
    } catch { /* ignore */ } finally {
      setInstallingId(null);
    }
  }

  async function handlePreview(pack: StickerPack & { is_installed: boolean }) {
    setBrowsePreview(pack);
    setPreviewItems([]);
    setPreviewLoading(true);
    try {
      const its = await getPackItems(pack.id);
      setPreviewItems(its);
    } catch { /* ignore */ } finally {
      setPreviewLoading(false);
    }
  }

  // ── Browse mode ──────────────────────────────────────────────────────────────
  if (mode === 'browse') {
    return (
      <div className="emojiPackSection">
        <div className="emojiPackSectionHeader">
          <button className="emojiPackBackBtn" onClick={() => { setMode('grid'); setBrowsePreview(null); setBrowseQuery(''); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <input
            className="emojiPackBrowseSearch"
            placeholder={t('emojiPackSection.searchPacksPlaceholder')}
            value={browseQuery}
            onChange={e => handleBrowseSearch(e.target.value)}
            autoFocus
          />
        </div>

        {/* Type slider */}
        <div className="browseTypeSlider">
          <button
            className={`browseTypeBtn${browseType === 'emoji' ? ' active' : ''}`}
            onClick={() => handleBrowseTypeChange('emoji')}
          >
            {t('emojiPackSection.typeEmoji')}
          </button>
          <button
            className={`browseTypeBtn${browseType === 'sticker' ? ' active' : ''}`}
            onClick={() => handleBrowseTypeChange('sticker')}
          >
            {t('emojiPackSection.typeStickers')}
          </button>
        </div>

        {browsePreview ? (
          <div className="emojiPackBrowsePreview">
            <div className="emojiPackPreviewHeader">
              <button className="emojiPackBackBtn" onClick={() => setBrowsePreview(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              <div className="emojiPackPreviewThumb">
                <PackCover url={browsePreview.cover_url} name={browsePreview.name} />
              </div>
              <div className="emojiPackPreviewInfo">
                <div className="emojiPackPreviewName">{browsePreview.name}</div>
              </div>
              <button
                className={`emojiPackInstallBtn${browsePreview.is_installed ? ' installed' : ''}`}
                disabled={installingId === browsePreview.id}
                onClick={() => handleInstall(browsePreview)}
              >
                {installingId === browsePreview.id ? '…' : browsePreview.is_installed ? t('common:delete') : t('emojiPackSection.add')}
              </button>
            </div>
            {previewLoading && <div className="emojiPackLoading"><div className="gifSpinner" /></div>}
            <div className="emojiGrid">
              {previewItems.map(item => (
                <button key={item.id} className="emojiItem"
                  title={item.emoji_hint || item.keywords?.[0] || t('emojiPackSection.emojiAlt')}
                  onClick={() => browsePreview.is_installed && onSelectEmoji(item.pack_id, item.id, item.file_url)}
                >
                  <img src={item.thumb_url || item.file_url} className="emojiItemImg" alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="emojiPackBrowseList">
            {browsing && <div className="emojiPackLoading"><div className="gifSpinner" /></div>}
            {!browsing && browseResults.length === 0 && (
              <div className="emojiPackEmpty">
                <span>{t('sticker.noPacksFound')}</span>
                <button className="emojiPackStudioBtn" onClick={() => { setMode('grid'); onOpenStudio(); }}>
                  {t('emojiPackSection.createInStudioCta')}
                </button>
              </div>
            )}
            {!browsing && browseResults.map(pack => (
              <div key={pack.id} className="emojiPackBrowseRow" onClick={() => handlePreview(pack)}>
                <div className="emojiPackBrowseThumb">
                  <PackCover url={pack.cover_url} name={pack.name} />
                </div>
                <div className="emojiPackBrowseInfo">
                  <div className="emojiPackBrowseName">{pack.name}</div>
                  <div className="emojiPackBrowseMeta">
                    {browseType === 'sticker'
                      ? t('sticker.itemCountStickers', { count: (pack as any).item_count ?? 0 })
                      : t('sticker.itemCountEmoji', { count: (pack as any).item_count ?? 0 })}
                  </div>
                </div>
                <button
                  className={`emojiPackInstallBtn${pack.is_installed ? ' installed' : ''}`}
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

  // ── Grid mode ────────────────────────────────────────────────────────────────
  if (emojiPacks.length === 0) {
    return (
      <div className="emojiPackSection emojiPackSectionEmpty">
        <div className="emojiPackSectionLabel">{t('emojiPackSection.customEmojiLabel')}</div>
        <div className="emojiPackEmpty">
          <span>{t('emojiPackSection.noPacksInstalled')}</span>
          <button className="emojiPackStudioBtn" onClick={onOpenStudio}>
            {t('emojiPackSection.createInStudioCta')}
          </button>
          <button className="emojiPackStudioBtn" onClick={() => setMode('browse')}>
            {t('emojiPackSection.findPacksCta')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="emojiPackSection">
      {/* Header row */}
      <div className="emojiPackSectionHeader">
        <span className="emojiPackSectionLabel">{t('emojiPackSection.customEmojiLabel')}</span>
        <button className="emojiPackFindBtn" onClick={() => setMode('browse')} title={t('emojiPackSection.findEmojiPacksTitle')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      </div>

      {/* Pack icon strip */}
      <div className="emojiPackStrip">
        {emojiPacks.map(pack => (
          <button key={pack.id}
            className={`emojiPackIcon${activePackId === pack.id ? ' active' : ''}`}
            onClick={() => setActivePackId(pack.id)}
            title={pack.name}
          >
            <PackCover url={pack.cover_url} name={pack.name} />
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="emojiGrid">
        {loading && (
          <div className="emojiPackLoading"><div className="gifSpinner" /></div>
        )}
        {!loading && items.length === 0 && (
          <div className="emojiPackEmpty"><span>{t('sticker.packEmpty')}</span></div>
        )}
        {!loading && items.filter(it => it?.id).map(item => (
          <button
            key={item.id}
            className="emojiItem"
            title={item.emoji_hint || item.keywords?.[0] || t('emojiPackSection.emojiAlt')}
            onClick={() => onSelectEmoji(item.pack_id, item.id, item.file_url)}
          >
            <img
              src={item.thumb_url || item.file_url}
              className="emojiItemImg"
              alt={item.emoji_hint || ''}
              loading="lazy"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
