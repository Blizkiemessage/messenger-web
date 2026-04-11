import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchTrendingGifs, searchGifs } from '../../api/gif';
import { type GifResult } from '../../types';

const PAGE_SIZE = 20;

interface Props {
  onSendGif: (url: string) => void;
}

export function GifTab({ onSendGif }: Props) {
  const [query,       setQuery]       = useState('');
  const [gifs,        setGifs]        = useState<GifResult[]>([]);
  const [offset,      setOffset]      = useState(0);
  const [hasMore,     setHasMore]     = useState(true);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState('');

  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef  = useRef<HTMLDivElement>(null);
  // Keep latest query/offset in refs so the IntersectionObserver closure stays fresh
  const queryRef     = useRef(query);
  const offsetRef    = useRef(offset);
  const hasMoreRef   = useRef(hasMore);
  const loadingRef   = useRef(false);

  queryRef.current   = query;
  offsetRef.current  = offset;
  hasMoreRef.current = hasMore;

  // ── Initial / query-change load ──────────────────────────────────────────
  const loadFirst = useCallback(async (q: string) => {
    setLoading(true);
    setError('');
    setGifs([]);
    setOffset(0);
    setHasMore(true);
    loadingRef.current = true;
    try {
      const page = q
        ? await searchGifs(q, PAGE_SIZE, 0)
        : await fetchTrendingGifs(PAGE_SIZE, 0);
      setGifs(page.results);
      const nextOffset = PAGE_SIZE;
      setOffset(nextOffset);
      setHasMore(page.results.length === PAGE_SIZE);
    } catch {
      setError(q ? 'Ошибка поиска' : 'Не удалось загрузить GIF');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  // ── Load next page ────────────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    const q   = queryRef.current.trim();
    const off = offsetRef.current;
    try {
      const page = q
        ? await searchGifs(q, PAGE_SIZE, off)
        : await fetchTrendingGifs(PAGE_SIZE, off);
      if (page.results.length === 0) {
        setHasMore(false);
      } else {
        setGifs(prev => [...prev, ...page.results]);
        setOffset(off + PAGE_SIZE);
        setHasMore(page.results.length === PAGE_SIZE);
      }
    } catch { /* silently ignore pagination errors */ }
    finally {
      setLoadingMore(false);
      loadingRef.current = false;
    }
  }, []);

  // ── Load trending on mount ────────────────────────────────────────────────
  useEffect(() => { loadFirst(''); }, [loadFirst]);

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Skip the very first render (handled by mount effect above)
    debounceRef.current = setTimeout(() => {
      loadFirst(query.trim());
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // ── IntersectionObserver for infinite scroll ──────────────────────────────
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

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
          placeholder="Поиск GIF…"
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
        <span className="gifMySectionLabel">Мои GIF</span>
        <span className="gifMySectionHint">Появятся после создания в Студии</span>
      </div>

      {/* Grid */}
      <div className="gifGrid">
        {/* Initial loading */}
        {loading && (
          <div className="gifLoading">
            <div className="gifSpinner" />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="gifError">
            <span>{error}</span>
            <button onClick={() => loadFirst(query.trim())}>Повторить</button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && gifs.length === 0 && (
          <div className="gifEmpty">Ничего не найдено</div>
        )}

        {/* GIF items */}
        {gifs.map(gif => (
          <div
            key={gif.id}
            className="gifItem"
            onClick={() => onSendGif(gif.url)}
            title={gif.title || 'GIF'}
          >
            <img
              src={gif.preview}
              alt={gif.title || 'GIF'}
              loading="lazy"
            />
          </div>
        ))}

        {/* Sentinel — triggers loadMore when it enters the viewport */}
        {!loading && !error && <div ref={sentinelRef} className="gifSentinel" />}

        {/* Pagination spinner */}
        {loadingMore && (
          <div className="gifLoadingMore">
            <div className="gifSpinner" />
          </div>
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
