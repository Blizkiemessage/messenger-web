/**
 * VideoTrimmerModal — in-browser video / GIF trimmer.
 *
 * - Shows a video preview that loops the selected IN→OUT segment.
 * - Timeline bar with two draggable handles (IN / OUT).
 * - Fine-tune inputs for precise start / end times.
 * - Uses canvas.captureStream() + MediaRecorder to produce a WebM clip.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export const TRIM_MAX_DURATION = 15; // seconds

/** Parse total GIF duration (seconds) from raw bytes */
function parseGifDuration(buffer: ArrayBuffer): number {
  const b = new Uint8Array(buffer);
  let totalCs = 0;
  const hasGct = !!(b[10] & 0x80);
  const gctSize = hasGct ? 3 * (1 << ((b[10] & 0x07) + 1)) : 0;
  let i = 13 + gctSize;
  while (i < b.length) {
    const s = b[i];
    if (s === 0x3b || s === undefined) break;
    if (s === 0x21) {
      const label = b[i + 1];
      if (label === 0xf9) { totalCs += b[i + 4] | (b[i + 5] << 8); i += 8; continue; }
      i += 2; let sub = b[i++]; while (sub > 0) { i += sub; sub = b[i++]; }
    } else if (s === 0x2c) {
      i += 10;
      const hasLct = !!(b[i - 1] & 0x80);
      if (hasLct) i += 3 * (1 << ((b[i - 1] & 0x07) + 1));
      i++; let sub = b[i++]; while (sub > 0) { i += sub; sub = b[i++]; }
    } else { i++; }
  }
  return totalCs / 100;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${sec}`;
}

interface Props {
  file: File;
  onConfirm: (trimmedFile: File) => void;
  onCancel: () => void;
}

export function VideoTrimmerModal({ file, onConfirm, onCancel }: Props) {
  const isGif = file.type === 'image/gif';
  const videoRef   = useRef<HTMLVideoElement>(null);
  const imgRef     = useRef<HTMLImageElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const objectUrl  = useRef('');
  const playheadRafRef = useRef<number>(0);

  const [duration, setDuration]   = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime]     = useState(TRIM_MAX_DURATION);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying]     = useState(false);
  const [trimming, setTrimming]   = useState(false);
  const [error, setError]         = useState('');

  // ── Load file ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const url = URL.createObjectURL(file);
    objectUrl.current = url;

    if (isGif) {
      file.arrayBuffer().then(buf => {
        const dur = parseGifDuration(buf) || TRIM_MAX_DURATION + 1;
        setDuration(dur);
        setEndTime(Math.min(dur, TRIM_MAX_DURATION));
      });
    }
    return () => URL.revokeObjectURL(url);
  }, [file, isGif]);

  const handleVideoMeta = useCallback(() => {
    const v = videoRef.current!;
    setDuration(v.duration);
    setEndTime(Math.min(v.duration, TRIM_MAX_DURATION));
  }, []);

  // ── Loop selected segment ────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const check = () => {
      if (v.currentTime >= endTime - 0.05) v.currentTime = startTime;
      setCurrentTime(v.currentTime);
    };
    v.addEventListener('timeupdate', check);
    return () => v.removeEventListener('timeupdate', check);
  }, [startTime, endTime]);

  // ── Play / pause ──────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < startTime || v.currentTime >= endTime) v.currentTime = startTime;
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }, [startTime, endTime]);

  // ── Timeline drag ──────────────────────────────────────────────────────────
  const startDrag = useCallback((
    e: React.PointerEvent,
    type: 'start' | 'end' | 'playhead',
  ) => {
    if (!duration || !timelineRef.current) return;
    e.stopPropagation();
    const timeline = timelineRef.current;

    const move = (me: PointerEvent) => {
      const rect = timeline.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
      const t    = pct * duration;

      if (type === 'start') {
        const ns = Math.min(t, endTime - 0.1);
        setStartTime(ns);
        if (endTime - ns > TRIM_MAX_DURATION) setEndTime(ns + TRIM_MAX_DURATION);
        if (videoRef.current) { videoRef.current.currentTime = ns; setCurrentTime(ns); }
      } else if (type === 'end') {
        const ne = Math.max(t, startTime + 0.1);
        setEndTime(ne);
        if (ne - startTime > TRIM_MAX_DURATION) setStartTime(ne - TRIM_MAX_DURATION);
        if (videoRef.current) { videoRef.current.currentTime = ne; setCurrentTime(ne); }
      } else {
        const nt = Math.max(startTime, Math.min(endTime, t));
        if (videoRef.current) { videoRef.current.currentTime = nt; setCurrentTime(nt); }
      }
    };

    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }, [duration, startTime, endTime]);

  // ── Trim & export ─────────────────────────────────────────────────────────
  const handleTrim = useCallback(async () => {
    setTrimming(true);
    setError('');

    try {
      const canvas = canvasRef.current!;
      if (!('captureStream' in canvas)) throw new Error('Браузер не поддерживает запись. Используй Chrome или Edge.');

      let source: HTMLVideoElement | HTMLImageElement;
      let w: number, h: number;

      if (isGif) {
        const img = imgRef.current!;
        w = img.naturalWidth  || 320;
        h = img.naturalHeight || 240;
        img.src = ''; img.src = objectUrl.current; // restart animation
        source = img;
      } else {
        const v = videoRef.current!;
        w = v.videoWidth  || 640;
        h = v.videoHeight || 480;
        v.pause();
        v.currentTime = startTime;
        await new Promise<void>((res, rej) => {
          const tid = setTimeout(() => rej(new Error('Seek timeout')), 6000);
          v.onseeked = () => { clearTimeout(tid); res(); };
        });
        source = v;
      }

      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      const stream: MediaStream = (canvas as any).captureStream(30);

      const mimeType =
        ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
          .find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      const segMs = (endTime - startTime) * 1000;
      let rafId: number;
      let t0: number;

      await new Promise<void>((resolve, reject) => {
        recorder.onerror = () => reject(new Error('Recording error'));
        recorder.onstop  = () => resolve();
        recorder.start(100);
        t0 = Date.now();
        if (!isGif) (source as HTMLVideoElement).play();

        const draw = () => {
          ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
          if (Date.now() - t0 < segMs) {
            rafId = requestAnimationFrame(draw);
          } else {
            cancelAnimationFrame(rafId);
            recorder.stop();
            if (!isGif) { (source as HTMLVideoElement).pause(); setPlaying(false); }
          }
        };
        rafId = requestAnimationFrame(draw);
      });

      const blob = new Blob(chunks, { type: 'video/webm' });
      const name = file.name.replace(/\.[^.]+$/, '') + '.webm';
      onConfirm(new File([blob], name, { type: 'video/webm' }));
    } catch (e: any) {
      setError(e.message || 'Ошибка обрезки');
    } finally {
      setTrimming(false);
    }
  }, [file, isGif, startTime, endTime, onConfirm]);

  const trimDuration  = endTime - startTime;
  const isValid       = trimDuration > 0.05 && trimDuration <= TRIM_MAX_DURATION;
  const startPct      = duration ? (startTime / duration) * 100 : 0;
  const endPct        = duration ? (endTime   / duration) * 100 : 100;
  const playheadPct   = duration ? (currentTime / duration) * 100 : 0;

  return createPortal(
    <div className="studioOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="trimmerModal">

        {/* Header */}
        <div className="studioHeader">
          <span className="studioTitle">Обрезка {isGif ? 'GIF' : 'видео'}</span>
          <button className="studioClose" onClick={onCancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="trimmerBody">
          <p className="studioHint">
            Максимум {TRIM_MAX_DURATION}с. Перетащи маркеры на шкале для выбора фрагмента.
          </p>

          {/* Preview */}
          <div className="trimmerPreview">
            {isGif
              ? <img ref={imgRef} src={objectUrl.current} alt="preview" className="trimmerMedia" />
              : <video ref={videoRef} src={objectUrl.current} onLoadedMetadata={handleVideoMeta}
                  className="trimmerMedia" muted playsInline />
            }
            {/* Play/pause overlay for video */}
            {!isGif && (
              <button className="trimmerPlayBtn" onClick={togglePlay}>
                {playing
                  ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                }
              </button>
            )}
          </div>

          {/* Time info bar */}
          <div className="trimmerTimeBar">
            <span className="trimmerTimeLabel">{fmt(currentTime)}</span>
            <span className={`trimmerDuration ${trimDuration > TRIM_MAX_DURATION ? 'trimmerOver' : 'trimmerOk'}`}>
              {fmt(trimDuration)}
              {trimDuration > TRIM_MAX_DURATION ? ` (макс. ${TRIM_MAX_DURATION}с)` : ''}
            </span>
            <span className="trimmerTimeLabel">{fmt(duration)}</span>
          </div>

          {/* Timeline */}
          <div className="trimmerTimeline" ref={timelineRef}
            onPointerDown={e => startDrag(e, 'playhead')}>

            {/* Dark overlay: before IN */}
            <div className="trimmerDimLeft"  style={{ width: `${startPct}%` }} />
            {/* Dark overlay: after OUT */}
            <div className="trimmerDimRight" style={{ width: `${100 - endPct}%` }} />

            {/* Selected range highlight */}
            <div className="trimmerRange"
              style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }} />

            {/* Playhead */}
            <div className="trimmerPlayhead"
              style={{ left: `${playheadPct}%` }}
              onPointerDown={e => startDrag(e, 'playhead')} />

            {/* IN handle */}
            <div className="trimmerHandle trimmerHandleIn"
              style={{ left: `${startPct}%` }}
              onPointerDown={e => { e.stopPropagation(); startDrag(e, 'start'); }}
              title={`Начало: ${fmt(startTime)}`}>
              <svg width="10" height="18" viewBox="0 0 10 18" fill="currentColor">
                <path d="M10 0 L10 18 L0 9 Z"/>
              </svg>
            </div>

            {/* OUT handle */}
            <div className="trimmerHandle trimmerHandleOut"
              style={{ left: `${endPct}%` }}
              onPointerDown={e => { e.stopPropagation(); startDrag(e, 'end'); }}
              title={`Конец: ${fmt(endTime)}`}>
              <svg width="10" height="18" viewBox="0 0 10 18" fill="currentColor">
                <path d="M0 0 L0 18 L10 9 Z"/>
              </svg>
            </div>

            {/* Time ticks */}
            {duration > 0 && Array.from({ length: Math.min(Math.floor(duration) + 1, 21) }, (_, i) => {
              const t = (duration / Math.min(Math.floor(duration), 20)) * i;
              if (t > duration) return null;
              return (
                <div key={i} className="trimmerTick"
                  style={{ left: `${(t / duration) * 100}%` }}>
                  <span className="trimmerTickLabel">{Math.round(t)}s</span>
                </div>
              );
            })}
          </div>

          {/* Fine-tune inputs */}
          <div className="trimmerInputRow">
            <label className="trimmerInputGroup">
              <span>Начало</span>
              <input type="number" min={0} max={endTime - 0.05} step={0.05}
                value={startTime.toFixed(2)}
                className="trimmerInput"
                readOnly={isGif}
                onChange={e => {
                  const v = Math.max(0, Math.min(+e.target.value, endTime - 0.05));
                  setStartTime(v);
                  if (endTime - v > TRIM_MAX_DURATION) setEndTime(v + TRIM_MAX_DURATION);
                  if (videoRef.current) videoRef.current.currentTime = v;
                }} />
            </label>
            <label className="trimmerInputGroup">
              <span>Конец</span>
              <input type="number" min={startTime + 0.05} max={duration} step={0.05}
                value={endTime.toFixed(2)}
                className="trimmerInput"
                onChange={e => {
                  const v = Math.max(startTime + 0.05, Math.min(+e.target.value, duration));
                  setEndTime(v);
                  if (v - startTime > TRIM_MAX_DURATION) setStartTime(v - TRIM_MAX_DURATION);
                  if (videoRef.current) videoRef.current.currentTime = v;
                }} />
            </label>
          </div>

          {error && <div className="studioError" style={{ margin: 0 }}>{error}</div>}

          {/* Hidden canvas */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          <div className="studioWizardFooter">
            <button className="studioBtnSecondary" onClick={onCancel} disabled={trimming}>Отмена</button>
            <button className="studioBtnPrimary" onClick={handleTrim} disabled={!isValid || trimming}>
              {trimming ? 'Обрезка…' : 'Применить'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
