/**
 * ChatMediaModal — E5: media / files / audio / stickers / links gallery for a chat.
 * Lazy-loaded. Works for both direct and group chats.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getChatMedia, type MediaTab } from '../../api/chats';
import type { Message } from '../../types';
import client from '../../api/client';
import { CollectionsPanel } from './CollectionsPanel';

// Gallery tabs = the media-query tabs plus the «Коллекции» (folders) view, which
// is NOT a getChatMedia query — it has its own data source (CollectionsPanel).
type Tab = MediaTab | 'collections';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TAB_LABELS: Record<MediaTab, string> = {
  media:    'Медиа',
  files:    'Файлы',
  audio:    'Аудио',
  stickers: 'Стикеры',
  links:    'Ссылки',
};

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024)       return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatDuration(secs: number | null | undefined): string {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getFileExt(name: string | null | undefined): string {
  if (!name) return '?';
  return (name.split('.').pop() || '').toUpperCase().slice(0, 5) || '?';
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
function extractUrls(text: string | null | undefined): string[] {
  return text?.match(URL_RE) ?? [];
}
function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** 3-column grid for images, videos, gifs */
function MediaGrid({ items, onImageClick }: { items: Message[]; onImageClick: (url: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="cmMediaGrid">
      {items.map(msg => {
        const isImg  = msg.attachment_type === 'image';
        const isGif  = msg.attachment_type === 'gif_tenor' || msg.attachment_type === 'gif_custom';
        const isVid  = msg.attachment_type === 'video' || msg.attachment_type === 'video_note';
        const url    = msg.attachment_url ?? '';

        return (
          <div
            key={msg.id}
            className={`cmMediaCell${isImg || isGif ? ' cmMediaCellClickable' : ''}`}
            onClick={() => (isImg || isGif) ? onImageClick(url) : undefined}
            title={formatDate(msg.created_at)}
          >
            {(isImg || isGif) ? (
              <img src={url} className="cmMediaImg" alt="" loading="lazy" />
            ) : isVid ? (
              <div className="cmMediaVideoPlaceholder">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                {msg.attachment_duration ? (
                  <span className="cmMediaVideoDur">{formatDuration(msg.attachment_duration)}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** List for audio messages */
function AudioList({ items }: { items: Message[] }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});

  const togglePlay = (id: string, url: string) => {
    const cur = audioRefs.current[id];
    if (!cur) {
      const el = new Audio(url);
      el.onended = () => setPlaying(null);
      audioRefs.current[id] = el;
      el.play().catch(() => {});
      setPlaying(id);
      return;
    }
    if (playing === id) {
      cur.pause();
      setPlaying(null);
    } else {
      // pause currently playing
      if (playing && audioRefs.current[playing]) {
        audioRefs.current[playing].pause();
      }
      cur.play().catch(() => {});
      setPlaying(id);
    }
  };

  if (!items.length) return null;
  return (
    <div className="cmList">
      {items.map(msg => (
        <div key={msg.id} className="cmAudioItem">
          <button
            className={`cmAudioPlayBtn${playing === msg.id ? ' playing' : ''}`}
            onClick={() => msg.attachment_url && togglePlay(msg.id, msg.attachment_url)}
            title={playing === msg.id ? 'Пауза' : 'Воспроизвести'}
          >
            {playing === msg.id ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="3" width="4" height="18" rx="1"/><rect x="15" y="3" width="4" height="18" rx="1"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            )}
          </button>
          <div className="cmAudioMeta">
            <span className="cmAudioName">{msg.attachment_name || 'Аудио'}</span>
            <span className="cmAudioSub">
              {msg.attachment_duration ? formatDuration(msg.attachment_duration) : ''}
              {msg.attachment_duration && msg.attachment_size ? ' · ' : ''}
              {formatSize(msg.attachment_size)}
              {(msg.attachment_duration || msg.attachment_size) ? ' · ' : ''}
              {formatDate(msg.created_at)}
            </span>
          </div>
          {msg.attachment_url && (
            <a href={msg.attachment_url} download={msg.attachment_name || 'audio'} className="cmItemDownload" title="Скачать">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

/** List for file/document attachments */
function FilesList({ items }: { items: Message[] }) {
  if (!items.length) return null;
  return (
    <div className="cmList">
      {items.map(msg => {
        const ext = getFileExt(msg.attachment_name);
        return (
          <div key={msg.id} className="cmFileItem">
            <div className="cmFileIcon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span className="cmFileExt">{ext}</span>
            </div>
            <div className="cmFileMeta">
              <span className="cmFileName">{msg.attachment_name || 'Файл'}</span>
              <span className="cmFileSub">
                {formatSize(msg.attachment_size)}
                {msg.attachment_size ? ' · ' : ''}
                {formatDate(msg.created_at)}
              </span>
            </div>
            {msg.attachment_url && (
              <a href={msg.attachment_url} download={msg.attachment_name || 'file'} className="cmItemDownload" title="Скачать">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 4-column grid for stickers */
function StickersGrid({ items }: { items: Message[] }) {
  if (!items.length) return null;
  return (
    <div className="cmStickerGrid">
      {items.map(msg => (
        <div key={msg.id} className="cmStickerCell" title={formatDate(msg.created_at)}>
          <img src={msg.attachment_url ?? ''} className="cmStickerImg" alt="" loading="lazy" />
        </div>
      ))}
    </div>
  );
}

// ── Link preview ──────────────────────────────────────────────────────────────

interface OgMeta {
  title?: string | null;
  description?: string | null;
  image?: string | null;
}

/** Single link card — fetches OG preview on mount */
function LinkCard({ url, date }: { url: string; date: number }) {
  const [meta, setMeta] = useState<OgMeta | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client.get<OgMeta>('/link-preview', { params: { url } })
      .then(r => { if (!cancelled) setMeta(r.data); })
      .catch(() => { /* silently fail – show bare link */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [url]);

  const domain = getDomain(url);

  return (
    <a className="cmLinkCard" href={url} target="_blank" rel="noreferrer noopener">
      {/* Thumbnail / placeholder */}
      <div className="cmLinkThumb">
        {meta?.image ? (
          <img src={meta.image} alt="" className="cmLinkThumbImg" loading="lazy" />
        ) : loaded ? (
          <div className="cmLinkThumbFallback">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </div>
        ) : (
          <div className="cmLinkThumbFallback">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="cmSpinner">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
          </div>
        )}
      </div>

      {/* Text */}
      <div className="cmLinkMeta">
        <div className="cmLinkDomain">{domain}</div>
        {meta?.title && <div className="cmLinkTitle">{meta.title}</div>}
        {meta?.description && <div className="cmLinkDesc">{meta.description}</div>}
        <div className="cmLinkUrl">{url}</div>
        <div className="cmLinkDate">{formatDate(date)}</div>
      </div>

      {/* External arrow */}
      <div className="cmLinkArrow">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </div>
    </a>
  );
}

/** Flat list of links extracted from message texts, deduplicated */
function LinksList({ items }: { items: Message[] }) {
  // Extract all unique (url, date) pairs, earliest occurrence per URL
  const seen = new Set<string>();
  const links: { url: string; date: number }[] = [];

  // items are sorted newest-first from server — iterate to collect them all
  for (const msg of items) {
    for (const url of extractUrls(msg.text)) {
      if (!seen.has(url)) {
        seen.add(url);
        links.push({ url, date: msg.created_at });
      }
    }
  }

  if (!links.length) return null;

  return (
    <div className="cmList cmLinkList">
      {links.map(({ url, date }) => (
        <LinkCard key={url} url={url} date={date} />
      ))}
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="cmLightboxOverlay" onClick={onClose}>
      <button className="cmLightboxClose" onClick={onClose}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <img
        src={url}
        className="cmLightboxImg"
        alt=""
        onClick={e => e.stopPropagation()}
      />
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface Props {
  chatId: string;
  onClose: () => void;
}

export function ChatMediaModal({ chatId, onClose }: Props) {
  const [tab,       setTab]       = useState<Tab>('media');
  const [items,     setItems]     = useState<Message[]>([]);
  const [hasMore,   setHasMore]   = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [lightbox,  setLightbox]  = useState<string | null>(null);

  const load = useCallback(async (before?: number) => {
    if (tab === 'collections') return; // own data source — handled by CollectionsPanel
    setLoading(true);
    try {
      const result = await getChatMedia(chatId, tab, before);
      setItems(prev => before ? [...prev, ...result.items] : result.items);
      setHasMore(result.hasMore);
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }, [chatId, tab]);

  // Reload whenever tab changes
  useEffect(() => {
    setItems([]);
    setHasMore(false);
    load(undefined);
  }, [load]); // eslint-disable-line

  const handleLoadMore = () => {
    if (!items.length) return;
    load(items[items.length - 1].created_at);
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !lightbox) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, lightbox]);

  // Check whether the current items yield any links (for the empty-state check on links tab)
  const hasLinks = tab === 'links' && items.some(m => extractUrls(m.text).length > 0);
  const isEmpty  = !loading && (tab === 'links' ? !hasLinks : items.length === 0);

  return (
    <>
      <div className="cmOverlay" onClick={onClose}>
        <div className="cmModal" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="cmHeader">
            <span className="cmTitle">Медиа и файлы</span>
            <button className="cmCloseBtn" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="cmTabs">
            {([...(Object.keys(TAB_LABELS) as MediaTab[]), 'collections'] as Tab[]).map(t => (
              <button
                key={t}
                className={`cmTab${tab === t ? ' active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'collections' ? 'Коллекции' : TAB_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="cmContent">
            {tab === 'collections' ? (
              <CollectionsPanel chatId={chatId} onImageClick={setLightbox} />
            ) : isEmpty ? (
              <div className="cmEmpty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
                  {tab === 'media'    && <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>}
                  {tab === 'files'    && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>}
                  {tab === 'audio'    && <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>}
                  {tab === 'stickers' && <><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></>}
                  {tab === 'links'    && <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>}
                </svg>
                <span>Нет вложений</span>
              </div>
            ) : (
              <>
                {tab === 'media'    && <MediaGrid   items={items} onImageClick={setLightbox} />}
                {tab === 'files'    && <FilesList   items={items} />}
                {tab === 'audio'    && <AudioList   items={items} />}
                {tab === 'stickers' && <StickersGrid items={items} />}
                {tab === 'links'    && <LinksList   items={items} />}

                {loading && (
                  <div className="cmLoading">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="cmSpinner">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                  </div>
                )}

                {hasMore && !loading && (
                  <button className="cmLoadMore" onClick={handleLoadMore}>
                    Загрузить ещё
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}
