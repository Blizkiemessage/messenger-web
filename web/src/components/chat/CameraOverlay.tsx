/**
 * CameraOverlay.tsx
 * Full-screen camera UI: live viewfinder → capture → preview+caption → send
 * Supports photo (WebP snapshot) and video (WebM recording via MediaRecorder).
 *
 * Rendered via ReactDOM.createPortal(…, document.body) so it escapes any
 * ancestor stacking context (e.g. .composerWrap has backdrop-filter which
 * traps position:fixed children, making them render behind the chat UI).
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  onCapture: (file: File, caption: string) => void;
  onClose:   () => void;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function CameraOverlay({ onCapture, onClose }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const captionRef  = useRef<HTMLInputElement>(null);

  const [facingMode, setFacingMode]           = useState<'user' | 'environment'>('environment');
  const [mode, setMode]                       = useState<'photo' | 'video'>('photo');
  const [recording, setRecording]             = useState(false);
  const [recSeconds, setRecSeconds]           = useState(0);
  const [captured, setCaptured]               = useState<{ blob: Blob; url: string; isVideo: boolean } | null>(null);
  const [caption, setCaption]                 = useState('');
  const [error, setError]                     = useState<string | null>(null);
  const [hasMultipleCams, setHasMultipleCams] = useState(false);
  const [starting, setStarting]               = useState(true);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async (facing: 'user' | 'environment', needAudio = false) => {
    stopStream();
    setStarting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: needAudio,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      // Check for multiple cameras (best-effort; may not enumerate until permission granted)
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setHasMultipleCams(devices.filter(d => d.kind === 'videoinput').length > 1);
      } catch { /* ignore */ }
    } catch {
      setError('Нет доступа к камере. Проверьте разрешения браузера.');
    } finally {
      setStarting(false);
    }
  }, [stopStream]);

  // Mount: start camera
  useEffect(() => {
    startCamera('environment', false);
    return () => {
      stopStream();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []); // eslint-disable-line

  // When mode switches, restart stream (audio required for video mode)
  const switchMode = useCallback((m: 'photo' | 'video') => {
    if (recording) return;
    setMode(m);
    startCamera(facingMode, m === 'video');
  }, [recording, facingMode, startCamera]);

  const switchCamera = useCallback(async () => {
    if (recording) return;
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    await startCamera(next, mode === 'video');
  }, [facingMode, recording, mode, startCamera]);

  // ── Photo capture ──────────────────────────────────────────────────────────
  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || starting) return;
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d')!;
    // Mirror the snapshot for front camera — matches what the user saw in the viewfinder
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      stopStream();
      setCaptured({ blob, url: URL.createObjectURL(blob), isVideo: false });
      setTimeout(() => captionRef.current?.focus(), 80);
    }, 'image/webp', 0.92);
  }, [starting, stopStream, facingMode]);

  // ── Video recording ────────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || starting) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    recorderRef.current = recorder;
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      stopStream();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      setCaptured({ blob, url: URL.createObjectURL(blob), isVideo: true });
      setRecording(false);
      setRecSeconds(0);
      setTimeout(() => captionRef.current?.focus(), 80);
    };
    recorder.start(100);
    setRecording(true);
    setRecSeconds(0);
    timerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
  }, [starting, stopStream]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // ── Send ───────────────────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    if (!captured) return;
    const ext  = captured.isVideo ? '.webm' : '.webp';
    const mime = captured.isVideo ? 'video/webm' : 'image/webp';
    const file = new File([captured.blob], `camera_${Date.now()}${ext}`, { type: mime });
    URL.revokeObjectURL(captured.url);
    onCapture(file, caption);
  }, [captured, caption, onCapture]);

  // ── Retake ─────────────────────────────────────────────────────────────────
  const retake = useCallback(() => {
    if (captured) { URL.revokeObjectURL(captured.url); setCaptured(null); setCaption(''); }
    startCamera(facingMode, mode === 'video');
  }, [captured, facingMode, mode, startCamera]);

  // ── Close with cleanup ─────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    if (recording) stopRecording();
    stopStream();
    if (captured) URL.revokeObjectURL(captured.url);
    onClose();
  }, [recording, stopRecording, stopStream, captured, onClose]);

  // ── Preview screen ─────────────────────────────────────────────────────────
  if (captured) {
    return createPortal(
      <div className="cameraOverlay">
        <div className="cameraCapturePreview">
          <button className="cameraCloseBtn" onClick={handleClose} title="Закрыть">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          {captured.isVideo ? (
            <video className="cameraCaptureMedia" src={captured.url} autoPlay loop playsInline muted />
          ) : (
            <img className="cameraCaptureMedia" src={captured.url} alt="Снимок" />
          )}

          <div className="cameraCaptureBar">
            <input
              ref={captionRef}
              className="cameraCaptionInput"
              placeholder="Добавить подпись…"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              maxLength={1000}
            />
            <div className="cameraCaptureRowBtns">
              <button className="cameraRetakeBtn" onClick={retake} title="Переснять">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"/>
                  <polyline points="12 19 5 12 12 5"/>
                </svg>
                Переснять
              </button>
              <button className="cameraSendBtn" onClick={handleSend} title="Отправить">
                <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                  <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Отправить
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Viewfinder ─────────────────────────────────────────────────────────────
  return createPortal(
    <div className="cameraOverlay">
      <div className="cameraViewfinder">
        {/* Top bar */}
        <div className="cameraTopBar">
          <button className="cameraCloseBtn" onClick={handleClose} title="Закрыть">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          {recording && (
            <div className="cameraRecBadge">
              <span className="cameraRecDot" />
              {fmt(recSeconds)}
            </div>
          )}

          {/* Flip button top-right */}
          {hasMultipleCams && (
            <button className="cameraFlipBtn" onClick={switchCamera} title="Переключить камеру" disabled={recording}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 4v6h6"/>
                <path d="M23 20v-6h-6"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/>
                <path d="M3.51 15a9 9 0 0 0 14.85 3.36L23 14"/>
              </svg>
            </button>
          )}
        </div>

        {/* Camera feed or error */}
        {error ? (
          <div className="cameraError">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p>{error}</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            className={`cameraVideo${facingMode === 'user' ? ' cameraVideoMirrored' : ''}`}
            autoPlay
            playsInline
            muted
          />
        )}

        {/* Bottom controls */}
        <div className="cameraControls">
          {/* Photo / Video mode toggle */}
          {!recording && (
            <div className="cameraModeToggle">
              <button
                className={`cameraModeBtn${mode === 'photo' ? ' active' : ''}`}
                onClick={() => switchMode('photo')}
              >Фото</button>
              <button
                className={`cameraModeBtn${mode === 'video' ? ' active' : ''}`}
                onClick={() => switchMode('video')}
              >Видео</button>
            </div>
          )}

          {/* Shutter row */}
          <div className="cameraShutterRow">
            {/* Left spacer / placeholder for balance */}
            <div className="cameraShutterSide" />

            {/* Main action button */}
            {mode === 'photo' ? (
              <button
                className="cameraShutterBtn"
                onClick={takePhoto}
                disabled={!!error || starting}
                title="Сделать снимок"
              >
                <span className="cameraShutterInner" />
              </button>
            ) : recording ? (
              <button className="cameraStopBtn" onClick={stopRecording} title="Остановить запись">
                <span className="cameraStopRect" />
              </button>
            ) : (
              <button
                className="cameraRecordBtn"
                onClick={startRecording}
                disabled={!!error || starting}
                title="Начать запись"
              >
                <span className="cameraRecordInner" />
              </button>
            )}

            {/* Right: flip camera button (mobile convenience) */}
            <div className="cameraShutterSide">
              {hasMultipleCams && !recording && (
                <button className="cameraFlipBtnSmall" onClick={switchCamera} title="Переключить камеру">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 4v6h6"/>
                    <path d="M23 20v-6h-6"/>
                    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/>
                    <path d="M3.51 15a9 9 0 0 0 14.85 3.36L23 14"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
