/**
 * MiniPlayer
 *
 * The sticky bar that appears directly below the chat header while an audio or
 * video-note message is playing. Controls: play/pause, skip ±15 s, scrub, close.
 *
 * Lives inside <MediaPlayerProvider>. Reads the active media element via the
 * context ref and attaches its own DOM event listeners to track playback state.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useMediaPlayer } from '../../contexts/MediaPlayerContext';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtT(s: number): string {
  if (!isFinite(s) || isNaN(s) || s < 0) return '0:00';
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ── component ─────────────────────────────────────────────────────────────────

export function MiniPlayer() {
  const { activeMedia, mediaElRef, deactivate } = useMediaPlayer();

  const [current,  setCurrent]  = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing,  setPlaying]  = useState(false);

  const trackRef    = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Attach DOM listeners to the active media element whenever it changes
  useEffect(() => {
    const el = mediaElRef.current;
    if (!el || !activeMedia) {
      setCurrent(0); setDuration(0); setPlaying(false);
      return;
    }

    const onTime     = () => setCurrent(el.currentTime);
    const onDur      = () => { if (isFinite(el.duration) && el.duration > 0) setDuration(el.duration); };
    const onPlay     = () => setPlaying(true);
    const onPause    = () => setPlaying(false);
    const onEnded    = () => { setPlaying(false); setCurrent(0); };

    el.addEventListener('timeupdate',     onTime);
    el.addEventListener('durationchange', onDur);
    el.addEventListener('play',           onPlay);
    el.addEventListener('pause',          onPause);
    el.addEventListener('ended',          onEnded);

    // Initialise from current element state
    setCurrent(el.currentTime);
    if (isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
    setPlaying(!el.paused);

    return () => {
      el.removeEventListener('timeupdate',     onTime);
      el.removeEventListener('durationchange', onDur);
      el.removeEventListener('play',           onPlay);
      el.removeEventListener('pause',          onPause);
      el.removeEventListener('ended',          onEnded);
    };
  }, [activeMedia?.msgId]); // eslint-disable-line

  const togglePlay = useCallback(() => {
    const el = mediaElRef.current;
    if (!el) return;
    if (el.paused) {
      if (activeMedia?.type === 'video_note') el.muted = false;
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [activeMedia?.type]); // eslint-disable-line

  const jumpToMessage = useCallback(() => {
    const msgId = activeMedia?.msgId;
    if (!msgId) return;
    const el = document.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeMedia?.msgId]); // eslint-disable-line

  const seekBy = useCallback((delta: number) => {
    const el = mediaElRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta));
  }, []); // eslint-disable-line

  const scrubFromX = useCallback((clientX: number) => {
    const el    = mediaElRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const dur = el.duration;
    if (!isFinite(dur) || dur <= 0) return;
    const rect = track.getBoundingClientRect();
    const p    = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    el.currentTime = p * dur;
    setCurrent(p * dur);
  }, []); // eslint-disable-line

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubFromX(e.clientX);
  }, [scrubFromX]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingRef.current) scrubFromX(e.clientX);
  }, [scrubFromX]);

  const onPointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  if (!activeMedia) return null;

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const isAudio  = activeMedia.type === 'audio'; // used for type label

  return (
    <div className="miniPlayer" role="region" aria-label="Мини-плеер">

      {/* ── Left: jump-to-message button ── */}
      <button
        className="miniPlayerJumpBtn"
        onClick={jumpToMessage}
        title="Перейти к сообщению"
        aria-label="Перейти к сообщению"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {/* Locate / GPS crosshair icon */}
          <circle cx="12" cy="12" r="4"/>
          <circle cx="12" cy="12" r="9"/>
          <line x1="12" y1="2"  x2="12" y2="5"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
          <line x1="2"  y1="12" x2="5"  y2="12"/>
          <line x1="19" y1="12" x2="22" y2="12"/>
        </svg>
      </button>
      <div className="miniPlayerInfo">
        <span className="miniPlayerSender">{activeMedia.senderName}</span>
        <span className="miniPlayerType">
          {isAudio ? 'Голосовое' : 'Видеосообщение'}
        </span>
      </div>

      {/* ── Controls: skip back · play/pause · skip forward ── */}
      <button
        className="miniPlayerSkip"
        onClick={() => seekBy(-15)}
        title="Назад 15 секунд"
        aria-label="Назад 15 секунд"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 .49-5.05"/>
        </svg>
        <span>15</span>
      </button>

      <button
        className="miniPlayerPlayBtn"
        onClick={togglePlay}
        aria-label={playing ? 'Пауза' : 'Воспроизвести'}
      >
        {playing ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="4" width="4" height="16" rx="1"/>
            <rect x="15" y="4" width="4" height="16" rx="1"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"
               style={{ marginLeft: 2 }}>
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      <button
        className="miniPlayerSkip"
        onClick={() => seekBy(15)}
        title="Вперёд 15 секунд"
        aria-label="Вперёд 15 секунд"
      >
        <span>15</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-.49-5.05"/>
        </svg>
      </button>

      {/* ── Progress bar ── */}
      <div
        className="miniPlayerTrackWrap"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label="Перемотка"
      >
        <div className="miniPlayerTrackBg">
          <div className="miniPlayerTrackFill" style={{ width: `${progress * 100}%` }} />
          <div className="miniPlayerTrackThumb" style={{ left: `${progress * 100}%` }} />
        </div>
      </div>

      {/* ── Time ── */}
      <div className="miniPlayerTime">
        {fmtT(current)}<span className="miniPlayerTimeSep"> / </span>{fmtT(duration)}
      </div>

      {/* ── Close ── */}
      <button
        className="miniPlayerClose"
        onClick={() => deactivate()}
        aria-label="Закрыть плеер"
        title="Закрыть"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}
