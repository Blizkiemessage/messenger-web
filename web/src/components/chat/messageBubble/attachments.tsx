/**
 * messageBubble/attachments.tsx — non-player attachment renderers:
 *   BubbleFileIcon, FileCard, ImageAttachment, VideoAttachment
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { formatFileSize, getFileCategory, downloadFile } from './helpers';

export function BubbleFileIcon({ name }: { name: string }) {
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

// ── File card ─────────────────────────────────────────────────────────────────
export function FileCard({
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
export function ImageAttachment({
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
export function VideoAttachment({ url, caption }: { url: string; caption?: string; name?: string }) {
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
