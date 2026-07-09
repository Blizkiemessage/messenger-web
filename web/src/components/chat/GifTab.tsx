import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchTrendingGifs, searchGifs } from '../../api/gif';
import { type GifResult } from '../../types';

const PAGE_SIZE = 20;
const SCROLL_THRESHOLD = 150; // px from bottom to trigger next load

interface Props {
  onSendGif: (url: string) => void;
}

export function GifTab({ onSendGif }: Props) {
  const { t } = useTranslation('chat');
  const [query,       setQuery]       = useState('');
  const [gifs,        setGifs]        = useState<GifResult[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState('');

  const gridRef      = useRef<HTMLDivElement>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsetRef    = useRef(0);
  const hasMoreRef   = useRef(true);
  const busyRef      = useRef(false);   // prevents concurrent fetches
  const isMounted    = useRef(false);   // skip debounce on first render

  // ── Load first page (resets grid) ────────────────────────────────────────
  const loadFirst = useCallback(async (q: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    offsetRef.current = 0;
    hasMoreRef.current = true;
    setLoading(true);
    setError('');
    setGifs([]);
    try {
      const page = q
        ? await searchGifs(q, PAGE_SIZE, 0)
        : await fetchTrendingGifs(PAGE_SIZE, 0);
      setGifs(page.results);
      offsetRef.current = PAGE_SIZE;
      hasMoreRef.current = page.results.length === PAGE_SIZE;
    } catch {
      setError(q ? t('gif.searchError') : t('gif.loadError'));
    } finally {
      setLoading(false);
      busyRef.current = false;
    }
  }, [t]);

  // ── Load next page (appends) ──────────────────────────────────────────────
  const loadMore = useCallback(async (q: string) => {
    if (busyRef.current || !hasMoreRef.current) return;
    busyRef.current = true;
    setLoadingMore(true);
    const off = offsetRef.current;
    try {
      const page = q
        ? await searchGifs(q, PAGE_SIZE, off)
        : await fetchTrendingGifs(PAGE_SIZE, off);
      if (page.results.length > 0) {
        setGifs(prev => [...prev, ...page.results]);
        offsetRef.current = off + PAGE_SIZE;
        hasMoreRef.current = page.results.length === PAGE_SIZE;
      } else {
        hasMoreRef.current = false;
      }
    } catch { /* ignore pagination errors */ }
    finally {
      setLoadingMore(false);
      busyRef.current = false;
    }
  }, []);

  // ── Load trending on mount ────────────────────────────────────────────────
  useEffect(() => {
    isMounted.current = true;
    loadFirst('');
  }, [loadFirst]);

  // ── Debounced search (skip initial render) ────────────────────────────────
  useEffect(() => {
    if (!isMounted.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadFirst(query.trim()), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // ── Scroll-based infinite scroll ──────────────────────────────────────────
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onScroll = () => {
      if (grid.scrollHeight - grid.scrollTop - grid.clientHeight < SCROLL_THRESHOLD) {
        loadMore(query);
      }
    };
    grid.addEventListener('scroll', onScroll, { passive: true });
    return () => grid.removeEventListener('scroll', onScroll);
  }, [loadMore, query]);

  return (
    <div className="gifTabRoot">
      {/* Search bar */}
      <div className="gifSearchWrap">
        <svg className="gifSearchIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          className="gifSearch"
          type="text"
          placeholder={t('gif.searchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {query && (
          <button className="gifSearchClear" onClick={() => setQuery('')} tabIndex={-1}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* My GIFs section (empty until Stage 6) */}
      <div className="gifMySection">
        <span className="gifMySectionLabel">{t('gif.myGifs')}</span>
        <span className="gifMySectionHint">{t('gif.myGifsHint')}</span>
      </div>

      {/* Grid */}
      <div className="gifGrid" ref={gridRef}>
        {loading && (
          <div className="gifLoading"><div className="gifSpinner" /></div>
        )}
        {!loading && error && (
          <div className="gifError">
            <span>{error}</span>
            <button onClick={() => loadFirst(query.trim())}>{t('common:retry')}</button>
          </div>
        )}
        {!loading && !error && gifs.length === 0 && (
          <div className="gifEmpty">{t('gif.nothingFound')}</div>
        )}
        {gifs.map(gif => (
          <div
            key={gif.id}
            className="gifItem"
            onClick={() => onSendGif(gif.url)}
            title={gif.title || 'GIF'}
          >
            <img src={gif.preview} alt={gif.title || 'GIF'} loading="lazy" />
          </div>
        ))}
        {loadingMore && (
          <div className="gifLoadingMore"><div className="gifSpinner" /></div>
        )}
      </div>

      {/* Giphy attribution — required by Giphy ToS */}
      <div className="gifAttribution">
        <svg width="56" height="14" viewBox="0 0 200 50" xmlns="http://www.w3.org/2000/svg">
          <text x="0" y="38" fontSize="38" fontWeight="900" fontFamily="Arial,sans-serif" fill="currentColor" letterSpacing="-1">GIPHY</text>
        </svg>
      </div>
    </div>
  );
}
