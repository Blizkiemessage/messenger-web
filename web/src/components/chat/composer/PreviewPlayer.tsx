/**
 * composer/PreviewPlayer.tsx — voice-message preview mini-player shown inside the
 * Composer before sending. Self-contained: owns its audio element and playback
 * state; receives the recorded blob, duration and waveform bars as props.
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { fmt } from './helpers';

export function PreviewPlayer({ blob, duration, waveform }: { blob: Blob; duration: number; waveform: number[] }) {
  const { t } = useTranslation('chat');
  const audioRef  = useRef<HTMLAudioElement>(null);
  const trackRef  = useRef<HTMLDivElement>(null);
  const urlRef    = useRef<string>('');
  const dragging  = useRef(false);
  const [playing,  setPlaying]  = useState(false);
  const [current,  setCurrent]  = useState(0);

  useEffect(() => {
    urlRef.current = URL.createObjectURL(blob);
    if (audioRef.current) audioRef.current.src = urlRef.current;
    return () => URL.revokeObjectURL(urlRef.current);
  }, [blob]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => {}); setPlaying(true); }
  };

  const progress    = duration > 0 ? current / duration : 0;
  const bars        = waveform.length > 0 ? waveform : null;
  const playedCount = bars ? Math.round(progress * bars.length) : 0;

  const scrub = (clientX: number) => {
    const a = audioRef.current;
    const el = trackRef.current;
    if (!a || !el || !duration) return;
    const rect = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = p * duration;
    setCurrent(p * duration);
  };

  return (
    <div className="voicePreviewPlayer">
      <audio ref={audioRef} preload="auto"
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
        onEnded={() => { setPlaying(false); setCurrent(0); }} />
      <button className="voicePreviewPlayBtn" onClick={toggle} title={playing ? t('media.pause') : t('media.play')}>
        {playing ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="4" width="4" height="16" rx="1"/>
            <rect x="15" y="4" width="4" height="16" rx="1"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      <div
        ref={trackRef}
        className="voicePreviewTrackWrap"
        onPointerDown={e => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); scrub(e.clientX); }}
        onPointerMove={e => { if (dragging.current) scrub(e.clientX); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        style={{ cursor: 'pointer' }}
      >
        {bars ? (
          <div className="voiceWaveformBars voiceWaveformBarsPreview">
            {bars.map((h, i) => (
              <div
                key={i}
                className={`voiceWaveformBar${i < playedCount ? ' voiceWaveformBarPlayed' : ''}`}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        ) : (
          <div className="voicePreviewTrackBg">
            <div className="voicePreviewTrackFill" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
      <span className="voicePreviewTime">{fmt(current)}/{fmt(duration)}</span>
    </div>
  );
}
