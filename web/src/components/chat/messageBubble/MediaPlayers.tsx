/**
 * messageBubble/MediaPlayers.tsx — heavy media players:
 *   VideoNotePlayer (circular, Telegram-style) and AudioPlayer (voice messages)
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { formatTime } from '../../../utils/format';
import { MsgStatus } from '../../ui/icons/MsgStatus';
import { useMediaPlayer } from '../../../contexts/MediaPlayerContext';
import { isSameOrigin } from './helpers';

// ── Video note player (circular, Telegram-style) ──────────────────────────────
export function VideoNotePlayer({
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

// ── Audio player for voice messages ──────────────────────────────────────────
export function AudioPlayer({
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
