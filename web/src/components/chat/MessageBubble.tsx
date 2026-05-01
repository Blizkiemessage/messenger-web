/**
 * MessageBubble.tsx
 * ✅ FIXED: resolveUrl applied to attachment URLs so /uploads/ paths resolve
 *           to the backend (Railway) instead of the frontend (Vercel).
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { getLinkPreview, type LinkPreview } from '../../api/linkPreview';
import { type Message, type User, type MessageReaction } from '../../types';
import { formatTime } from '../../utils/format';
import { renderMarkdown } from '../../utils/markdown';
import { Avatar, resolveUrl } from '../ui/Avatar';
import { ChatSticker } from './ChatSticker';
import { MsgStatus } from '../ui/icons/MsgStatus';
import { PollBubble } from './PollBubble';
import { useMediaPlayer } from '../../contexts/MediaPlayerContext';
import { useStickerStore } from '../../store/useStickerStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024)                return `${bytes} B`;
  if (bytes < 1024 * 1024)         return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface FileCategory { color: string; bgColor: string; label: string }

function getFileCategory(name: string): FileCategory {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','heic','bmp','tiff'].includes(ext))
    return { color: '#9b59b6', bgColor: '#9b59b622', label: ext.toUpperCase() };
  if (ext === 'pdf')
    return { color: '#e74c3c', bgColor: '#e74c3c22', label: 'PDF' };
  if (['doc','docx','odt'].includes(ext))
    return { color: '#2980b9', bgColor: '#2980b922', label: 'DOC' };
  if (['xls','xlsx','ods','csv'].includes(ext))
    return { color: '#27ae60', bgColor: '#27ae6022', label: 'XLS' };
  if (['ppt','pptx','odp'].includes(ext))
    return { color: '#e67e22', bgColor: '#e67e2222', label: 'PPT' };
  if (['txt','md','markdown','rtf'].includes(ext))
    return { color: '#7f8c8d', bgColor: '#7f8c8d22', label: 'TXT' };
  if (['js','ts','jsx','tsx','py','java','c','cpp','cs','go','rb','php',
       'html','css','json','xml','yaml','yml','sh','sql','swift','kt','rs'].includes(ext))
    return { color: '#16a085', bgColor: '#16a08522', label: ext.toUpperCase() };
  if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext))
    return { color: '#f39c12', bgColor: '#f39c1222', label: 'ZIP' };
  if (['mp3','wav','aac','flac','ogg','m4a','wma'].includes(ext))
    return { color: '#e91e63', bgColor: '#e91e6322', label: 'AUD' };
  if (['mp4','avi','mov','mkv','wmv','webm','flv','m4v'].includes(ext))
    return { color: '#c0392b', bgColor: '#c0392b22', label: 'VID' };
  return { color: '#95a5a6', bgColor: '#95a5a622', label: ext.toUpperCase() || 'FILE' };
}

function BubbleFileIcon({ name }: { name: string }) {
  const { color, bgColor, label } = getFileCategory(name);
  const fontSize = label.length > 3 ? 9 : 11;
  return (
    <div className="bubbleFileIcon" style={{ background: bgColor, borderColor: color + '55' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
              fill={color + '33'} stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
        <polyline points="14 2 14 8 20 8" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
      <span className="bubbleFileIconLabel" style={{ color, fontSize }}>{label}</span>
    </div>
  );
}

function downloadFile(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── File card ─────────────────────────────────────────────────────────────────
function FileCard({
  url, name, size, isOwn, caption,
}: { url: string; name: string; size?: number | null; isOwn: boolean; caption?: string }) {
  return (
    <div className={`bubbleAttachFile${isOwn ? ' bubbleAttachFileOwn' : ''}`}>
      <button
        className="bubbleFileCard"
        onClick={() => downloadFile(url, name)}
        title={`Скачать ${name}`}
      >
        <BubbleFileIcon name={name} />
        <div className="bubbleFileMeta">
          <div className="bubbleFileName" title={name}>{name}</div>
          {size ? <div className="bubbleFileSize">{formatFileSize(size)}</div> : null}
        </div>
        <div className="bubbleFileDownloadBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
      </button>
      {caption && <div className="bubbleCaption bubbleCaptionFile">{caption}</div>}
    </div>
  );
}

// ── Image attachment ──────────────────────────────────────────────────────────
function ImageAttachment({
  url, name, size, caption, isOwn,
}: { url: string; name: string; size?: number | null; caption?: string; isOwn: boolean }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <FileCard url={url} name={name} size={size} isOwn={isOwn} caption={caption} />;
  }

  return (
    <div className="bubbleAttachImg">
      <a href={url} target="_blank" rel="noopener noreferrer" className="bubbleImgLink">
        <img
          src={url}
          alt={name}
          className="bubbleImg"
          loading="lazy"
          onError={() => setFailed(true)}
        />
        <div className="bubbleImgOverlay">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </div>
      </a>
      {caption && <div className="bubbleCaption">{caption}</div>}
    </div>
  );
}

// ── Video attachment — custom player ─────────────────────────────────────────
function VideoAttachment({ url, caption }: { url: string; caption?: string; name?: string }) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const hideRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [started,   setStarted]   = useState(false);
  const [playing,   setPlaying]   = useState(false);
  const [muted,     setMuted]     = useState(false);
  const [current,   setCurrent]   = useState(0);
  const [duration,  setDuration]  = useState(0);
  const [buffered,  setBuffered]  = useState(0);
  const [ctrlVis,   setCtrlVis]   = useState(false);

  const fmtT = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const showControls = useCallback(() => {
    setCtrlVis(true);
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => setCtrlVis(false), 2500);
  }, []);

  useEffect(() => () => { if (hideRef.current) clearTimeout(hideRef.current); }, []);

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (!started) setStarted(true);
    if (v.paused) { v.play().catch(() => {}); }
    else { v.pause(); }
    showControls();
  }, [started, showControls]);

  const seek = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    const bar = progressRef.current;
    if (!v || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
    showControls();
  }, [duration, showControls]);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    showControls();
  }, [showControls]);

  const goFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen();
    else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
  }, []);

  const pct    = duration > 0 ? current / duration : 0;
  const bufPct = duration > 0 ? buffered / duration : 0;

  return (
    <div className="bubbleAttachVideo">
      <div
        className={`bubbleVideoWrap${started && ctrlVis ? ' bvCtrl' : ''}`}
        onClick={togglePlay}
        onMouseMove={started ? showControls : undefined}
        onMouseLeave={() => { if (hideRef.current) clearTimeout(hideRef.current); setCtrlVis(false); }}
      >
        <video
          ref={videoRef}
          src={url}
          className="bubbleVideo"
          preload="metadata"
          playsInline
          onTimeUpdate={e => {
            const v = e.currentTarget;
            setCurrent(v.currentTime);
            if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
          }}
          onDurationChange={e => setDuration(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setCtrlVis(true); }}
        />

        {/* Poster / initial play overlay */}
        {!started && (
          <div className="bvPoster">
            <div className="bvPlayCircle">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
            {duration > 0 && <span className="bvDurBadge">{fmtT(duration)}</span>}
          </div>
        )}

        {/* Custom controls — fade in on hover / interaction */}
        {started && (
          <div className="bvControls" onClick={e => e.stopPropagation()}>
            <div className="bvProgress" ref={progressRef} onClick={seek}>
              <div className="bvProgressBuf"  style={{ width: `${bufPct * 100}%` }} />
              <div className="bvProgressFill" style={{ width: `${pct    * 100}%` }} />
              <div className="bvProgressThumb" style={{ left: `${pct   * 100}%` }} />
            </div>
            <div className="bvBar">
              <button className="bvBtn" onClick={togglePlay} title={playing ? 'Пауза' : 'Воспроизвести'}>
                {playing
                  ? <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  : <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                }
              </button>
              <span className="bvTime">{fmtT(current)} / {fmtT(duration)}</span>
              <div className="bvBarRight">
                <button className="bvBtn" onClick={toggleMute} title={muted ? 'Включить звук' : 'Выключить звук'}>
                  {muted
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                  }
                </button>
                <button className="bvBtn" onClick={goFullscreen} title="Полный экран">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Play/pause flash icon on tap when already started */}
        {started && !playing && (
          <div className="bvPauseHint">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        )}
      </div>
      {caption && <div className="bubbleCaption">{caption}</div>}
    </div>
  );
}

// ── Video note player (circular, Telegram-style) ──────────────────────────────
function VideoNotePlayer({
  url, msgId, isActive, onActivate, onEnded,
  isOwn, isRead, sendTime, isGroup, onViewReaders, senderName, initialDuration,
  isPending, isError, onRetry,
}: {
  url: string;
  msgId: string;
  isActive: boolean;
  onActivate: (id: string) => void;
  onEnded: (id: string) => void;
  isOwn: boolean;
  isRead: boolean;
  sendTime: number;
  isGroup: boolean;
  onViewReaders?: () => void;
  senderName: string;
  initialDuration?: number;
  isPending?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const msgRef      = useRef<HTMLDivElement>(null);   // root div for coordinate base
  const draggingRef = useRef(false);
  const movedRef    = useRef(false);
  const mediaCtx    = useMediaPlayer();

  const [playing,     setPlaying]     = useState(false);
  const [current,     setCurrent]     = useState(0);
  const [duration,    setDuration]    = useState(initialDuration ?? 0);
  const [blobUrl,     setBlobUrl]     = useState<string | null>(null);
  const [downloading, setDownloading] = useState(true);

  // Notify mini-player of stored duration immediately
  useEffect(() => {
    if (initialDuration && initialDuration > 0) {
      mediaCtx.notifyDuration(msgId, initialDuration);
    }
  }, []); // eslint-disable-line

  // Download full file to blob URL — enables reliable random-access scrubbing.
  // Skipped for cross-origin URLs (S3/CDN) where fetch() is blocked by CORS;
  // <video> handles those natively and duration comes from attachment_duration.
  useEffect(() => {
    if (!url) return;
    if (!isSameOrigin(url)) { setDownloading(false); return; }
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([buf], { type: 'video/webm' }));
        if (!cancelled) { setBlobUrl(objectUrl); setDownloading(false); }
      } catch {
        if (!cancelled) setDownloading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]); // eslint-disable-line

  const fmtT = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    const mm = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${mm}:${sec.toString().padStart(2, '0')}`;
  };

  // When isActive changes: play/unmute or pause/mute
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isActive) {
      v.muted = false;
      if (v.paused) v.play().catch(() => {});
    } else {
      v.muted = true;
      if (!v.paused) v.pause();
    }
  }, [isActive]); // eslint-disable-line

  // Scrub: map pointer screen-coords → angle → video time
  const scrubToPoint = useCallback((clientX: number, clientY: number) => {
    const v = videoRef.current;
    const el = msgRef.current;
    if (!v || !el || !duration) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    let angle = Math.atan2(clientY - cy, clientX - cx) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;
    const t = (angle / (2 * Math.PI)) * duration;
    v.currentTime = t;
    setCurrent(t);
  }, [duration]);

  const onThumbDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    movedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onThumbMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    movedRef.current = true;
    scrubToPoint(e.clientX, e.clientY);
  }, [scrubToPoint]);

  const onThumbUp = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    draggingRef.current = false;
  }, []);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (movedRef.current) { movedRef.current = false; return; }
    if (draggingRef.current || (downloading && !blobUrl)) return;
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      onActivate(msgId);
      mediaCtx.activate(v, { msgId, type: 'video_note', senderName });
      if (duration > 0) mediaCtx.notifyDuration(msgId, duration);
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [msgId, onActivate, senderName, downloading]); // eslint-disable-line

  const pct  = duration > 0 ? Math.min(1, current / duration) : 0;
  const R    = 45; // in SVG 0–100 units
  const circ = 2 * Math.PI * R;

  // Thumb position in SVG units (0–100) → CSS percentages
  const thumbAngle = pct * 2 * Math.PI - Math.PI / 2;
  const thumbSvgX  = 50 + R * Math.cos(thumbAngle); // 0–100
  const thumbSvgY  = 50 + R * Math.sin(thumbAngle);

  return (
    <div ref={msgRef}
         className={`videoNoteMsg${isActive ? ' videoNoteActive' : ''}`}
         onClick={toggle}
         title={playing ? 'Пауза' : 'Воспроизвести'}>
      <video
        ref={videoRef}
        src={blobUrl ?? url}
        className="videoNoteVideo"
        playsInline
        preload={downloading ? 'none' : 'auto'}
        loop={false}
        muted                              // start muted; unmuted when active
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); onEnded(msgId); }}
        // Skip updates while user is scrubbing to prevent jumpy ring
        onTimeUpdate={e => { if (!draggingRef.current) setCurrent(e.currentTarget.currentTime); }}
        onDurationChange={e => { const d = e.currentTarget.duration; if (isFinite(d) && d > 0) { setDuration(d); mediaCtx.notifyDuration(msgId, d); } }}
      />

      {/* Progress ring — purely visual, no pointer events */}
      <svg className="videoNoteRing" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="1.5"
          className="videoNoteRingBg" />
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="1.5"
          className="videoNoteRingFill"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
        />
        {/* Visual-only thumb dot */}
        <circle cx={thumbSvgX} cy={thumbSvgY} r={2.8}
          className="videoNoteThumbDot" />
      </svg>

      {/* HTML drag handle — reliable touch target, positioned at thumb */}
      <div
        className="videoNoteThumb"
        style={{
          left: `${thumbSvgX}%`,
          top:  `${thumbSvgY}%`,
        }}
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
      />

      {/* Loading overlay while file downloads */}
      {downloading && (
        <div className="videoNoteLoading">
          <svg className="videoNoteSpinner" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="14" strokeWidth="3" stroke="rgba(255,255,255,0.25)" />
            <circle cx="18" cy="18" r="14" strokeWidth="3" stroke="white"
              strokeDasharray="44 44" strokeLinecap="round"
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
            />
          </svg>
        </div>
      )}

      {/* Play / Pause overlay */}
      {!playing && !downloading && (
        <div className="videoNotePlayBtn">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      )}

      {/* Duration / current time badge */}
      <div className="videoNoteDur">
        {playing ? fmtT(current) : fmtT(duration)}
      </div>

      {/* Read receipt — time + status badge below the circle */}
      {isOwn && (
        <div className="videoNoteFooter">
          <span className="videoNoteFooterTime">{formatTime(sendTime)}</span>
          {isGroup && onViewReaders
            ? <button className="bubbleReadersBtn" onClick={e => { e.stopPropagation(); onViewReaders(); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            : <MsgStatus isRead={isRead} isPending={isPending} isError={isError} onRetry={onRetry} />
          }
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true only for same-origin URLs (relative paths or matching origin).
 *  Cross-origin URLs (e.g. S3) cannot be fetched without CORS headers,
 *  but <audio>/<video> elements handle them natively in opaque mode. */
function isSameOrigin(url: string): boolean {
  if (url.startsWith('/')) return true;
  try { return new URL(url).origin === window.location.origin; } catch { return false; }
}

function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : null;
}

// ── Audio player for voice messages ──────────────────────────────────────────
function AudioPlayer({
  url, isOwn, isRead, sendTime, msgId, senderName, initialDuration, waveformStr, isPending, isError, onRetry,
}: { url: string; isOwn: boolean; isRead: boolean; sendTime: number; msgId: string; senderName: string; initialDuration?: number; waveformStr?: string | null; isPending?: boolean; isError?: boolean; onRetry?: () => void }) {
  const audioRef    = useRef<HTMLAudioElement>(null);
  const trackRef    = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const mediaCtx    = useMediaPlayer();

  const [playing,     setPlaying]     = useState(false);
  const [current,     setCurrent]     = useState(0);
  const [duration,    setDuration]    = useState(initialDuration ?? 0);
  const [blobUrl,     setBlobUrl]     = useState<string | null>(null);
  const [downloading, setDownloading] = useState(true);

  // Notify mini-player of stored duration immediately (before download completes)
  useEffect(() => {
    if (initialDuration && initialDuration > 0) {
      mediaCtx.notifyDuration(msgId, initialDuration);
    }
  }, []); // eslint-disable-line

  // Download full file to blob URL — enables reliable random-access scrubbing.
  // Reuses the same ArrayBuffer to both decode accurate duration and create the blob.
  // Skipped for cross-origin URLs (S3/CDN) where fetch() is blocked by CORS;
  // <audio> handles those natively and duration comes from attachment_duration.
  useEffect(() => {
    if (!url) return;
    if (!isSameOrigin(url)) { setDownloading(false); return; }
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        // Decode accurate duration (WebM streams return Infinity from HTMLAudioElement)
        try {
          const actx = new AudioContext();
          const dec  = await actx.decodeAudioData(buf.slice(0));
          actx.close();
          if (!cancelled && dec.duration > 0) {
            setDuration(dec.duration);
            mediaCtx.notifyDuration(msgId, dec.duration);
          }
        } catch { /* keep initialDuration */ }
        if (cancelled) return;
        const mime = url.toLowerCase().includes('.ogg') ? 'audio/ogg' : 'audio/webm';
        objectUrl = URL.createObjectURL(new Blob([buf], { type: mime }));
        setBlobUrl(objectUrl);
        setDownloading(false);
      } catch {
        if (!cancelled) setDownloading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]); // eslint-disable-line

  const fmtT = (s: number) => {
    if (!isFinite(s) || isNaN(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const toggle = () => {
    const a = audioRef.current;
    // Block play only while actively downloading (not on failure — fall back to streaming)
    if (!a || (downloading && !blobUrl)) return;
    if (playing) {
      a.pause();
    } else {
      mediaCtx.activate(a, { msgId, type: 'audio', senderName });
      if (duration > 0) mediaCtx.notifyDuration(msgId, duration);
      a.play().catch(() => {});
    }
  };

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  // Parse waveform bars once (null = no waveform → render flat track)
  const waveform = useMemo<number[] | null>(() => {
    if (!waveformStr) return null;
    try {
      const arr = JSON.parse(waveformStr);
      return Array.isArray(arr) && arr.length > 0 ? (arr as number[]) : null;
    } catch { return null; }
  }, [waveformStr]);
  const playedCount = waveform ? Math.round(progress * waveform.length) : 0;

  // Scrub
  const scrubFromClientX = (clientX: number) => {
    const a = audioRef.current;
    const el = trackRef.current;
    if (!a || !el || !duration) return;
    const rect = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = p * duration;
    setCurrent(p * duration);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (downloading && !blobUrl) return;
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current) scrubFromClientX(e.clientX);
  };
  const onPointerUp = () => { draggingRef.current = false; };

  const timeLabel = current > 0 || playing
    ? `${fmtT(current)}/${fmtT(duration)}`
    : fmtT(duration);

  return (
    <div className={`voiceMsgPlayer${isOwn ? ' voiceMsgPlayerOwn' : ''}`}>
      <audio
        ref={audioRef} src={blobUrl ?? url} preload={downloading ? 'none' : 'auto'}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
      />

      {/* Play / Pause / Loading button */}
      <button className="voiceMsgPlay" onClick={toggle} aria-label={downloading ? 'Загрузка…' : playing ? 'Пауза' : 'Воспроизвести'} disabled={downloading}>
        {downloading ? (
          <svg className="voiceMsgSpinner" viewBox="0 0 24 24" fill="none" width="16" height="16">
            <circle cx="12" cy="12" r="9" strokeWidth="2.5" stroke="currentColor" strokeOpacity="0.25" />
            <circle cx="12" cy="12" r="9" strokeWidth="2.5" stroke="currentColor"
              strokeDasharray="14 42" strokeLinecap="round"
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
            />
          </svg>
        ) : playing ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="4" width="4" height="16" rx="1"/>
            <rect x="15" y="4" width="4" height="16" rx="1"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1 }}>
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      {/* Right side: track + bottom row */}
      <div className="voiceMsgRight">
        {/* Progress track — waveform bars if available, flat track otherwise */}
        <div
          className="voiceMsgTrackWrap"
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="slider"
          aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="Перемотка"
        >
          {waveform ? (
            <div className={`voiceWaveformBars${isOwn ? ' voiceWaveformBarsOwn' : ''}`}>
              {waveform.map((h, i) => (
                <div
                  key={i}
                  className={`voiceWaveformBar${i < playedCount ? ' voiceWaveformBarPlayed' : ''}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          ) : (
            <div className="voiceMsgTrackBg">
              <div className="voiceMsgTrackFill" style={{ width: `${progress * 100}%` }} />
              <div className="voiceMsgTrackThumb" style={{ left: `${progress * 100}%` }} />
            </div>
          )}
        </div>

        {/* Bottom row: time left, send-time + status right */}
        <div className="voiceMsgMeta">
          <span className="voiceMsgTime">{timeLabel}</span>
          <div className="voiceMsgSendMeta">
            <span className="voiceMsgSendTime">{formatTime(sendTime)}</span>
            {isOwn && <MsgStatus isRead={isRead} isPending={isPending} isError={isError} onRetry={onRetry} />}
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Quoted text with "показать больше" expander ──────────────────────────────
function QuotedText({ text }: { text: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 120;
  if (!text) return <span className="bubbleReplyNoText">Медиафайл</span>;
  if (text.length <= LIMIT || expanded) return <span>{text}</span>;
  return (
    <>
      <span>{text.slice(0, LIMIT)}…</span>
      <button
        className="bubbleReplyExpand"
        onClick={e => { e.stopPropagation(); setExpanded(true); }}
      >
        показать больше
      </button>
    </>
  );
}

// ── Custom emoji reaction helpers ─────────────────────────────────────────────
const CUSTOM_EMOJI_RE = /^:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):$/;

function isCustomEmoji(emoji: string): boolean {
  return CUSTOM_EMOJI_RE.test(emoji);
}

function resolveCustomEmojiUrl(emoji: string): string | null {
  const m = CUSTOM_EMOJI_RE.exec(emoji);
  if (!m) return null;
  const [, packId, itemId] = m;
  const items = useStickerStore.getState().packItems[packId];
  return items?.find(it => it.id === itemId)?.file_url ?? null;
}

// ── Reaction bar ─────────────────────────────────────────────────────────────
function ReactionBar({
  reactions, meId, isOwn, onReact,
}: {
  reactions: MessageReaction[];
  meId: string;
  isOwn: boolean;
  onReact: (emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;

  // Group by emoji
  const groups: Record<string, { count: number; isMine: boolean }> = {};
  for (const r of reactions) {
    if (!groups[r.emoji]) groups[r.emoji] = { count: 0, isMine: false };
    groups[r.emoji].count++;
    if (r.userId === meId) groups[r.emoji].isMine = true;
  }

  return (
    <div className={`reactionBar${isOwn ? ' reactionBarOwn' : ''}`}>
      {Object.entries(groups).map(([emoji, { count, isMine }]) => {
        const custom = isCustomEmoji(emoji);
        const customUrl = custom ? resolveCustomEmojiUrl(emoji) : null;
        return (
          <button
            key={emoji}
            className={`reactionChip${isMine ? ' reactionChipMine' : ''}${custom ? ' reactionChipCustom' : ''}`}
            onClick={e => { e.stopPropagation(); onReact(emoji); }}
            title={isMine ? 'Убрать реакцию' : 'Поставить реакцию'}
          >
            {custom && customUrl
              ? <img src={customUrl} className="customEmojiReaction" alt="" loading="lazy" />
              : <span>{emoji}</span>
            }
            {count > 1 && <span className="reactionCount">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  message: Message;
  isOwn: boolean;
  isRead: boolean;
  isSelected: boolean;
  isGroup: boolean;
  sender?: User;
  showAvatar: boolean;
  showName: boolean;
  hasSelection: boolean;
  highlight?: string;
  isSearchMatch?: boolean;
  meId: string;
  onContextMenu: () => void;
  onClick: (e: React.MouseEvent) => void;
  onViewUser: (id: string) => void;
  onForwardedSenderClick?: (userId: string) => void;
  onReact: (emoji: string) => void;
  onScrollToMessage: (msgId: string) => void;
  onVote?: (msgId: string, optionIds: string[]) => void;
  onRetract?: (msgId: string) => void;
  onViewVoters?: (pollId: string, optionId: string) => void;
  meUsername?: string;
  members?: User[];
  onViewReaders?: () => void;
  activeVideoNoteId?: string | null;
  onVideoNoteActivate?: (msgId: string) => void;
  onVideoNoteEnded?: (msgId: string) => void;
  onStickerPackClick?: (packId: string) => void;
  /** Called when user taps the error badge to retry a failed optimistic send. */
  onRetry?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function MessageBubble({
  message: m, isOwn, isRead, isSelected, isGroup, sender,
  showAvatar, showName, hasSelection, highlight, isSearchMatch,
  meId, onContextMenu, onClick, onViewUser, onForwardedSenderClick,
  onReact, onScrollToMessage, onVote, onRetract, onViewVoters, meUsername, members, onViewReaders,
  activeVideoNoteId, onVideoNoteActivate, onVideoNoteEnded, onStickerPackClick,
  onRetry,
}: Props) {
  const hasAttachment = !!m.attachment_url;
  const isImage     = m.attachment_type === 'image';
  const isVideo     = m.attachment_type === 'video';
  const isAudio     = m.attachment_type === 'audio';
  const isVideoNote = m.attachment_type === 'video_note';
  const isGifTenor  = m.attachment_type === 'gif_tenor';
  const isSticker   = m.attachment_type === 'sticker';
  const isFile      = hasAttachment && !isImage && !isVideo && !isAudio && !isVideoNote && !isGifTenor && !isSticker;

  // Custom emoji resolver — reads from store cache (non-reactive, uses getState)
  const { packItems } = useStickerStore();
  const emojiResolver = useCallback((packId: string, itemId: string): string | null => {
    const items = packItems[packId];
    return items?.find(it => it.id === itemId)?.file_url ?? null;
  }, [packItems]);

  // Display name used in the mini player bar
  const playerSenderName = isOwn
    ? 'Вы'
    : (sender?.display_name ?? sender?.username ?? 'Пользователь');

  // Link preview
  const firstUrl = useMemo(() => extractFirstUrl(m.text), [m.text]);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  useEffect(() => {
    if (!firstUrl) return;
    let cancelled = false;
    getLinkPreview(firstUrl).then(p => {
      if (!cancelled && p.title) setPreview(p);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [firstUrl]);

  // ✅ KEY FIX: resolve /uploads/... URLs to absolute backend URLs.
  // Without this, Vercel's SPA rewrite catches the relative path and serves index.html.
  const attachmentUrl = resolveUrl(m.attachment_url) ?? m.attachment_url ?? '';

  const caption  = hasAttachment && m.text ? m.text : undefined;
  const pureText = hasAttachment ? null : m.text;

  return (
    <div
      className={[
        'msg', isOwn ? 'out' : 'in',
        isSelected    ? 'selected'    : '',
        isGroup && !isOwn ? 'inGroup' : '',
        isSearchMatch ? 'msgSearchFocus' : '',
      ].filter(Boolean).join(' ')}
      onContextMenu={e => { if (m.is_system) return; e.preventDefault(); onContextMenu(); }}
      onClick={e => { if (!hasSelection) return; e.stopPropagation(); onClick(e); }}
      onDoubleClick={e => { if (!m.is_system && !hasSelection) { e.stopPropagation(); onReact('❤️'); } }}
    >
      {isGroup && !isOwn && (
        <div className="msgAvatarSlot">
          {showAvatar ? (
            <button className="msgSenderAvatarBtn"
                    onClick={e => { e.stopPropagation(); onViewUser(m.sender_id); }}>
              <Avatar user={sender} size={32} radius={10} />
            </button>
          ) : (
            <div style={{ width: 32 }} />
          )}
        </div>
      )}

      <div className={[
        'bubble',
        hasAttachment && !isVideoNote && !isGifTenor && !isSticker ? 'bubbleWithAttach' : '',
        isVideoNote ? 'bubbleVideoNote' : '',
        isSticker ? 'bubbleNoBackground' : '',
      ].filter(Boolean).join(' ')}>
        {/* ✅ Pin indicator — thumbtack icon */}
        {m.is_pinned && !isSelected && (
          <div className="msgPinBadge" title="Закреплённое сообщение">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M16 3a1 1 0 0 0-1 1v1H9V4a1 1 0 0 0-2 0v1a3 3 0 0 0-3 3v1l2 2v4H4a1 1 0 0 0 0 2h7v3a1 1 0 0 0 2 0v-3h7a1 1 0 0 0 0-2h-2v-4l2-2V8a3 3 0 0 0-3-3V4a1 1 0 0 0-1-1z"/>
            </svg>
          </div>
        )}
        {isSelected && (
          <div className="msgCheckmark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </div>
        )}

        {showName && (
          <button className="bubbleSenderName"
                  onClick={e => { e.stopPropagation(); onViewUser(m.sender_id); }}>
            {sender?.display_name || sender?.username || 'Пользователь'}
          </button>
        )}

        {/* ✅ Reply/Quote block */}
        {m.reply && (
          <div
            className="bubbleReply"
            onClick={e => { e.stopPropagation(); onScrollToMessage(m.reply!.id); }}
          >
            {m.reply.sender_id && (
              <button
                className="bubbleReplySender"
                onClick={e => { e.stopPropagation(); onViewUser(m.reply!.sender_id!); }}
              >
                {m.reply.sender_username || 'Пользователь'}
              </button>
            )}
            <div className="bubbleReplyText">
              <QuotedText text={m.reply.text} />
            </div>
          </div>
        )}

        {/* ✅ Forwarded-from badge */}
        {m.forwarded_from_user_id && (
          <div className="bubbleForwardedBadge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 17 20 12 15 7"/>
              <path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
            </svg>
            <span>Переслано от </span>
            <button
              className="bubbleForwardedName"
              onClick={e => {
                e.stopPropagation();
                if (onForwardedSenderClick && m.forwarded_from_user_id) {
                  onForwardedSenderClick(m.forwarded_from_user_id);
                }
              }}
            >
              {m.forwarded_from_username || 'Пользователь'}
            </button>
          </div>
        )}

        {/* ── Attachments (all use resolved URL) ── */}
        {isVideoNote && (
          <VideoNotePlayer
            url={attachmentUrl}
            msgId={m.id}
            isActive={activeVideoNoteId === m.id}
            onActivate={onVideoNoteActivate ?? (() => {})}
            onEnded={onVideoNoteEnded ?? (() => {})}
            isOwn={isOwn}
            isRead={isRead}
            sendTime={m.created_at}
            isGroup={isGroup}
            onViewReaders={onViewReaders}
            senderName={playerSenderName}
            initialDuration={m.attachment_duration ?? undefined}
            isPending={m._pending}
            isError={m._error}
            onRetry={onRetry}
          />
        )}
        {isAudio && (
          <AudioPlayer
            url={attachmentUrl}
            isOwn={isOwn}
            isRead={isRead}
            sendTime={m.created_at}
            msgId={m.id}
            senderName={playerSenderName}
            initialDuration={m.attachment_duration ?? undefined}
            waveformStr={m.voice_waveform ?? null}
            isPending={m._pending}
            isError={m._error}
            onRetry={onRetry}
          />
        )}
        {isImage && (
          <ImageAttachment
            url={attachmentUrl}
            name={m.attachment_name || 'image'}
            size={m.attachment_size}
            caption={caption}
            isOwn={isOwn}
          />
        )}
        {isVideo && (
          <VideoAttachment
            url={attachmentUrl}
            caption={caption}
            name={m.attachment_name || undefined}
          />
        )}
        {isGifTenor && (
          <img
            className="bubbleGif"
            src={attachmentUrl}
            alt="GIF"
            loading="lazy"
          />
        )}
        {isFile && (
          <FileCard
            url={attachmentUrl}
            name={m.attachment_name || 'file'}
            size={m.attachment_size}
            isOwn={isOwn}
            caption={caption}
          />
        )}
        {isSticker && (
          <ChatSticker m={m} onStickerPackClick={onStickerPackClick} />
        )}

        {/* Poll bubble */}
        {m.poll && (
          <PollBubble
            poll={m.poll}
            meId={meId}
            onVote={optionIds => onVote?.(m.id, optionIds)}
            onRetract={() => onRetract?.(m.id)}
            onViewVoters={optId => onViewVoters?.(m.poll!.id, optId)}
          />
        )}

        {/* Plain text */}
        {!m.poll && pureText && (
          <div className="bubbleText">
            {renderMarkdown(pureText, { term: highlight, meUsername, members, onMentionClick: onViewUser, emojiResolver })}
          </div>
        )}

        {/* Link preview card */}
        {preview && firstUrl && (
          <a href={firstUrl} target="_blank" rel="noopener noreferrer"
             className="linkPreviewCard" onClick={e => e.stopPropagation()}>
            {preview.image && (
              <img src={preview.image} className="linkPreviewImg" alt=""
                   onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            )}
            <div className="linkPreviewBody">
              <div className="linkPreviewDomain">
                {(() => { try { return new URL(firstUrl).hostname.replace(/^www\./, ''); } catch { return firstUrl; } })()}
              </div>
              <div className="linkPreviewTitle">{preview.title}</div>
              {preview.description && (
                <div className="linkPreviewDesc">{preview.description}</div>
              )}
            </div>
          </a>
        )}

        {!isAudio && !isVideoNote && (
          <div className="bubbleFooter">
            {(m.reactions?.length ?? 0) > 0 && (
              <ReactionBar
                reactions={m.reactions!}
                meId={meId}
                isOwn={isOwn}
                onReact={onReact}
              />
            )}
            <div className="bubbleMeta">
              {m.edited_at && <span className="bubbleEdited">(изм.)</span>}
              <span className="bubbleTime">{formatTime(m.created_at)}</span>
              {isOwn && isGroup && onViewReaders && (
                <button
                  className="bubbleReadersBtn"
                  onClick={e => { e.stopPropagation(); onViewReaders(); }}
                  title="Кто прочитал"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
              )}
              {isOwn && <MsgStatus isRead={isRead} isPending={m._pending} isError={m._error} onRetry={onRetry} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
