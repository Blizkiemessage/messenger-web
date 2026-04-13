import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const MAX_DURATION = 5; // seconds

interface Props {
  file: File;
  onConfirm: (trimmedFile: File) => void;
  onCancel: () => void;
}

/** Parse total GIF duration (seconds) from raw bytes */
function parseGifDuration(buffer: ArrayBuffer): number {
  const b = new Uint8Array(buffer);
  let totalCs = 0;
  let i = 6; // skip GIF header
  // Logical screen descriptor
  const hasGct = !!(b[10] & 0x80);
  const gctSize = hasGct ? 3 * (1 << ((b[10] & 0x07) + 1)) : 0;
  i = 13 + gctSize;

  while (i < b.length) {
    const sentinel = b[i];
    if (sentinel === 0x3b || sentinel === undefined) break; // Trailer
    if (sentinel === 0x21) {
      const label = b[i + 1];
      if (label === 0xf9) {
        // Graphic Control Extension — delay is bytes [i+4, i+5] in centiseconds
        totalCs += b[i + 4] | (b[i + 5] << 8);
        i += 8; // fixed size block
        continue;
      }
      // Skip other extensions
      i += 2;
      let sub = b[i++];
      while (sub > 0) { i += sub; sub = b[i++]; }
    } else if (sentinel === 0x2c) {
      // Image descriptor
      i += 10;
      const hasLct = !!(b[i - 1] & 0x80);
      if (hasLct) i += 3 * (1 << ((b[i - 1] & 0x07) + 1));
      i++; // LZW min code size
      let sub = b[i++];
      while (sub > 0) { i += sub; sub = b[i++]; }
    } else {
      i++;
    }
  }
  return totalCs / 100;
}

export function VideoTrimmerModal({ file, onConfirm, onCancel }: Props) {
  const isGif = file.type === 'image/gif';
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef   = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectUrl = useRef('');

  const [duration, setDuration]   = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime]     = useState(MAX_DURATION);
  const [trimming, setTrimming]   = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    const url = URL.createObjectURL(file);
    objectUrl.current = url;

    if (isGif) {
      // Parse GIF duration from binary
      file.arrayBuffer().then(buf => {
        const dur = parseGifDuration(buf);
        setDuration(dur > 0 ? dur : MAX_DURATION + 1);
        setEndTime(Math.min(dur > 0 ? dur : MAX_DURATION + 1, MAX_DURATION));
      });
    }

    return () => URL.revokeObjectURL(url);
  }, [file, isGif]);

  const handleVideoMeta = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    setEndTime(Math.min(v.duration, MAX_DURATION));
  }, []);

  const handleStartChange = (v: number) => {
    const clamped = Math.min(v, endTime - 0.1);
    setStartTime(clamped);
    if (endTime - clamped > MAX_DURATION) setEndTime(clamped + MAX_DURATION);
    if (videoRef.current) videoRef.current.currentTime = clamped;
  };

  const handleEndChange = (v: number) => {
    const clamped = Math.max(v, startTime + 0.1);
    setEndTime(clamped);
    if (clamped - startTime > MAX_DURATION) setStartTime(clamped - MAX_DURATION);
    if (videoRef.current) videoRef.current.currentTime = clamped;
  };

  const handleTrim = useCallback(async () => {
    setTrimming(true);
    setError('');
    try {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas unavailable');

      let source: HTMLVideoElement | HTMLImageElement;
      let width: number;
      let height: number;

      if (isGif) {
        const img = imgRef.current!;
        width  = img.naturalWidth  || 320;
        height = img.naturalHeight || 240;
        // Restart animation by resetting src
        img.src = '';
        img.src = objectUrl.current;
        source = img;
      } else {
        const video = videoRef.current!;
        width  = video.videoWidth  || 640;
        height = video.videoHeight || 480;
        video.currentTime = startTime;
        await new Promise<void>((res, rej) => {
          const tid = setTimeout(() => rej(new Error('Seek timeout')), 6000);
          video.onseeked = () => { clearTimeout(tid); res(); };
        });
        source = video;
      }

      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;

      if (!('captureStream' in canvas)) {
        throw new Error('Браузер не поддерживает запись. Используй Chrome или Edge.');
      }
      const stream: MediaStream = (canvas as any).captureStream(30);

      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      const segmentDuration = (endTime - startTime) * 1000; // ms
      let rafId: number;
      let recordStart: number;

      await new Promise<void>((resolve, reject) => {
        recorder.onerror = () => reject(new Error('Recording error'));
        recorder.onstop  = () => resolve();

        const drawFrame = () => {
          ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);

          if (!isGif) {
            const elapsed = Date.now() - recordStart;
            if (elapsed >= segmentDuration) {
              recorder.stop();
              (source as HTMLVideoElement).pause();
              return;
            }
          }
          rafId = requestAnimationFrame(drawFrame);
        };

        recorder.start(100);
        recordStart = Date.now();

        if (!isGif) {
          (source as HTMLVideoElement).play();
        }
        rafId = requestAnimationFrame(drawFrame);

        if (isGif) {
          setTimeout(() => {
            cancelAnimationFrame(rafId);
            recorder.stop();
          }, segmentDuration);
        }
      });

      const blob = new Blob(chunks, { type: 'video/webm' });
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const trimmedFile = new File([blob], `${baseName}.webm`, { type: 'video/webm' });
      onConfirm(trimmedFile);
    } catch (e: any) {
      setError(e.message || 'Ошибка обрезки');
    } finally {
      setTrimming(false);
    }
  }, [file, isGif, startTime, endTime, onConfirm]);

  const trimDuration = endTime - startTime;
  const isValid = trimDuration > 0 && trimDuration <= MAX_DURATION;

  return createPortal(
    <div className="studioOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="trimmerModal">
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
            Длительность превышает {MAX_DURATION}с. Выбери нужный фрагмент.
          </p>

          {/* Preview */}
          <div className="trimmerPreview">
            {isGif
              ? <img ref={imgRef} src={objectUrl.current} alt="preview" className="trimmerMedia" />
              : <video ref={videoRef} src={objectUrl.current} onLoadedMetadata={handleVideoMeta}
                  className="trimmerMedia" muted playsInline controls={false} />
            }
          </div>

          {/* Hidden canvas for capture */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Info */}
          <div className="trimmerInfo">
            <span>Фрагмент: <b>{trimDuration.toFixed(1)}с</b></span>
            <span className={trimDuration > MAX_DURATION ? 'trimmerOver' : 'trimmerOk'}>
              {trimDuration > MAX_DURATION ? `Превышает ${MAX_DURATION}с` : '✓ Подходит'}
            </span>
          </div>

          {/* Sliders */}
          <div className="trimmerSliders">
            {!isGif && (
              <label className="trimmerLabel">
                <span>Начало: {startTime.toFixed(1)}с</span>
                <input type="range" min={0} max={duration} step={0.05} value={startTime}
                  onChange={e => handleStartChange(+e.target.value)} className="trimmerRange" />
              </label>
            )}
            <label className="trimmerLabel">
              <span>{isGif ? 'Первые секунды' : 'Конец'}: {endTime.toFixed(1)}с</span>
              <input type="range" min={isGif ? 0.5 : 0} max={duration || MAX_DURATION}
                step={0.05} value={endTime}
                onChange={e => handleEndChange(+e.target.value)} className="trimmerRange" />
            </label>
          </div>

          {error && <div className="studioError" style={{ margin: 0 }}>{error}</div>}

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
