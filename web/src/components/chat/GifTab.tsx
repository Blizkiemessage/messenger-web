import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchTrendingGifs, searchGifs } from '../../api/gif';
import { type GifResult } from '../../types';

interface Props {
  onSendGif: (url: string) => void;
}

export function GifTab({ onSendGif }: Props) {
  const [query,   setQuery]   = useState('');
  const [gifs,    setGifs]    = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTrending = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const page = await fetchTrendingGifs(20, 0);
      setGifs(page.results);
    } catch {
      setError('Не удалось загрузить GIF');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load trending on mount
  useEffect(() => { loadTrending(); }, [loadTrending]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      loadTrending();
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const page = await searchGifs(q, 20, 0);
        setGifs(page.results);
      } catch {
        setError('Ошибка поиска');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, loadTrending]);

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
        {loading && (
          <div className="gifLoading">
            <div className="gifSpinner" />
          </div>
        )}
        {!loading && error && (
          <div className="gifError">
            <span>{error}</span>
            <button onClick={loadTrending}>Повторить</button>
          </div>
        )}
        {!loading && !error && gifs.length === 0 && (
          <div className="gifEmpty">Ничего не найдено</div>
        )}
        {!loading && gifs.map(gif => (
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
