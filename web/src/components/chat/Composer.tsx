/**
 * Composer.tsx  ✅
 * - Waveform icon (instead of mic) that pulses with accent colour
 * - Recording: clean timer + dots, NO canvas waveform
 * - Preview: mini player with real waveform bars + play-before-send
 * - Lock mode: drag-up to hands-free recording
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { uploadFile } from '../../api/upload';
import type { UploadResult } from '../../api/upload';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024)               return `${bytes} B`;
  if (bytes < 1024 * 1024)        return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmt(sec: number): string {
  if (!isFinite(sec) || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getFileCategory(name: string): { color: string; label: string } {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','heic','bmp','tiff'].includes(ext)) return { color: '#9b59b6', label: ext.toUpperCase() };
  if (ext === 'pdf')  return { color: '#e74c3c', label: 'PDF' };
  if (['doc','docx','odt'].includes(ext))  return { color: '#2980b9', label: 'DOC' };
  if (['xls','xlsx','ods','csv'].includes(ext)) return { color: '#27ae60', label: 'XLS' };
  if (['ppt','pptx','odp'].includes(ext))  return { color: '#e67e22', label: 'PPT' };
  if (['txt','md','rtf'].includes(ext))    return { color: '#7f8c8d', label: 'TXT' };
  if (['js','ts','jsx','tsx','py','java','c','cpp','cs','go','rb','php','html','css','json','xml','yaml','yml','sh','sql','swift','kt','rs'].includes(ext)) return { color: '#16a085', label: ext.toUpperCase() };
  if (['zip','rar','7z','tar','gz','bz2'].includes(ext)) return { color: '#f39c12', label: 'ZIP' };
  if (['mp3','wav','aac','flac','ogg','m4a'].includes(ext)) return { color: '#e91e63', label: 'AUD' };
  if (['mp4','avi','mov','mkv','wmv','webm'].includes(ext)) return { color: '#c0392b', label: 'VID' };
  return { color: '#95a5a6', label: ext.toUpperCase() || 'FILE' };
}

function FileIconBadge({ name, size = 44 }: { name: string; size?: number }) {
  const { color, label } = getFileCategory(name);
  const fontSize = label.length > 3 ? size * 0.22 : size * 0.26;
  return (
    <div className="fileIconBadge" style={{ width: size, height: size, background: color + '22', borderColor: color + '55' }}>
      <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill={color + '33'} stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
        <polyline points="14 2 14 8 20 8" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
      <span className="fileIconLabel" style={{ color, fontSize }}>{label}</span>
    </div>
  );
}

// ── Waveform icon SVG (replaces mic icon) ─────────────────────────────────────
function WaveformIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="1"  y="9"  width="2.5" height="6"  rx="1.2"/>
      <rect x="5"  y="5"  width="2.5" height="14" rx="1.2"/>
      <rect x="9"  y="2"  width="2.5" height="20" rx="1.2"/>
      <rect x="13" y="5"  width="2.5" height="14" rx="1.2"/>
      <rect x="17" y="7"  width="2.5" height="10" rx="1.2"/>
      <rect x="21" y="9"  width="2.5" height="6"  rx="1.2"/>
    </svg>
  );
}

// ── Preview mini-player (inside composer before sending) ──────────────────────
const PREVIEW_BARS = 40;

function seededBars(wave: number[]): number[] {
  if (wave.length === 0) return Array(PREVIEW_BARS).fill(0.35);
  const out: number[] = [];
  const step = Math.max(1, Math.floor(wave.length / PREVIEW_BARS));
  for (let i = 0; i < PREVIEW_BARS; i++) {
    const slice = wave.slice(i * step, i * step + step);
    const avg = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
    out.push(Math.max(0.07, avg));
  }
  const max = Math.max(...out, 0.001);
  return out.map(v => v / max);
}

function PreviewPlayer({ blob, duration }: { blob: Blob; duration: number }) {
  const audioRef  = useRef<HTMLAudioElement>(null);
  const urlRef    = useRef<string>('');
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

  const progress = duration > 0 ? current / duration : 0;

  return (
    <div className="voicePreviewPlayer">
      <audio ref={audioRef} preload="auto"
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
        onEnded={() => { setPlaying(false); setCurrent(0); }} />
      <button className="voicePreviewPlayBtn" onClick={toggle} title={playing ? 'Пауза' : 'Воспроизвести'}>
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
      <div className="voicePreviewTrackWrap">
        <div className="voicePreviewTrackBg">
          <div className="voicePreviewTrackFill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <span className="voicePreviewTime">{fmt(current)}/{fmt(duration)}</span>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSendAttachment: (result: UploadResult, caption: string) => Promise<void>;
  externalFile?: File | null;
  onExternalFileConsumed?: () => void;
  disabled?: boolean;
}

type VoiceState = 'idle' | 'recording' | 'preview';
const LOCK_THRESHOLD = 60;

// ── Component ─────────────────────────────────────────────────────────────────

export function Composer({ value, onChange, onSend, onSendAttachment, externalFile, onExternalFileConsumed, disabled }: Props) {
  // File staging
  const [staged,    setStaged]    = useState<File | null>(null);
  const [caption,   setCaption]   = useState('');
  const [progress,  setProgress]  = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);
  const textInputRef    = useRef<HTMLInputElement>(null);
  const cancelRef       = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (externalFile) { stageFile(externalFile); onExternalFileConsumed?.(); }
  }, [externalFile]); // eslint-disable-line

  function stageFile(file: File) {
    setStaged(file); setCaption(''); setProgress(0); setUploadErr(null);
    setTimeout(() => captionInputRef.current?.focus(), 80);
  }

  const clearStage = useCallback(() => {
    setStaged(null); setCaption(''); setProgress(0); setUploadErr(null);
    setTimeout(() => textInputRef.current?.focus(), 60);
  }, []);

  const handleCancelUpload = useCallback(() => {
    cancelRef.current?.(); cancelRef.current = null;
    setUploading(false); clearStage();
  }, [clearStage]);

  const handleSendFile = useCallback(async (fileOverride?: File, captionOverride?: string) => {
    const f = fileOverride ?? staged;
    const c = captionOverride !== undefined ? captionOverride : caption;
    if (!f || uploading) return;
    setUploading(true); setProgress(0); setUploadErr(null);
    const task = uploadFile(f, pct => setProgress(pct));
    cancelRef.current = task.cancel;
    try {
      const result = await task.promise;
      await onSendAttachment(result, c);
      clearStage();
    } catch (e: any) {
      if (e?.message !== 'Загрузка отменена') { setUploadErr(e?.message ?? 'Ошибка загрузки'); setProgress(0); }
    } finally {
      setUploading(false); cancelRef.current = null;
    }
  }, [staged, caption, uploading, onSendAttachment, clearStage]);

  // Voice recording
  const [voiceState,   setVoiceState]   = useState<VoiceState>('idle');
  const [locked,       setLocked]       = useState(false);
  const [lockProgress, setLockProgress] = useState(0);
  const [recSeconds,   setRecSeconds]   = useState(0);
  const [liveWave,     setLiveWave]     = useState<number[]>([]);
  const [voiceBlob,    setVoiceBlob]    = useState<Blob | null>(null);
  const [previewSecs,  setPreviewSecs]  = useState(0);
  const [voiceSending, setVoiceSending] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const analyserRef      = useRef<AnalyserNode | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const rafRef           = useRef<number>(0);
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveWaveRef      = useRef<number[]>([]);
  const recSecondsRef    = useRef(0);
  const micStartYRef     = useRef(0);
  const micLockedRef     = useRef(false);

  // Animated mic icon: amplitude drives the icon's bars while recording
  const [micAmp, setMicAmp] = useState(0);

  useEffect(() => () => { stopCleanup(); }, []); // eslint-disable-line

  function stopCleanup() {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }

  const startRecording = useCallback(async () => {
    if (voiceState !== 'idle' || staged) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyserRef.current = analyser;
      audioCtx.createMediaStreamSource(stream).connect(analyser);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';

      const mr = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setVoiceBlob(blob);
        setPreviewSecs(recSecondsRef.current);
        setVoiceState('preview');
        setLocked(false);
        setLockProgress(0);
        micLockedRef.current = false;
        setMicAmp(0);
        stopCleanup();
      };

      mr.start(80);
      recSecondsRef.current = 0;
      setRecSeconds(0);
      liveWaveRef.current = [];
      setLiveWave([]);
      setVoiceState('recording');

      timerRef.current = setInterval(() => {
        recSecondsRef.current += 1;
        setRecSeconds(recSecondsRef.current);
      }, 1000);

      const draw = () => {
        if (!analyserRef.current) return;
        const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteTimeDomainData(buf);
        const amp = buf.reduce((a, b) => a + Math.abs(b - 128), 0) / buf.length / 128;
        liveWaveRef.current.push(amp);
        setLiveWave([...liveWaveRef.current]);
        setMicAmp(amp);
        rafRef.current = requestAnimationFrame(draw);
      };
      rafRef.current = requestAnimationFrame(draw);
    } catch { /* mic denied */ }
  }, [voiceState, staged]);

  const stopRecording = useCallback(() => {
    if (voiceState !== 'recording') return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    cancelAnimationFrame(rafRef.current);
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, [voiceState]);

  const cancelVoice = useCallback(() => {
    if (voiceState === 'recording') {
      if (timerRef.current) clearInterval(timerRef.current);
      cancelAnimationFrame(rafRef.current);
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current!.onstop = null;
        mediaRecorderRef.current!.stop();
      }
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setVoiceState('idle');
    setVoiceBlob(null);
    setLiveWave([]);
    setRecSeconds(0);
    setPreviewSecs(0);
    setLocked(false);
    setLockProgress(0);
    setMicAmp(0);
    micLockedRef.current = false;
    liveWaveRef.current = [];
  }, [voiceState]);

  const sendVoice = useCallback(async () => {
    if (!voiceBlob || voiceSending) return;
    setVoiceSending(true);
    const ext = voiceBlob.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([voiceBlob], `voice_${Date.now()}.${ext}`, { type: voiceBlob.type });
    await handleSendFile(file, '');
    setVoiceSending(false);
    cancelVoice();
  }, [voiceBlob, voiceSending, handleSendFile, cancelVoice]);

  // Pointer hold + lock drag
  const micDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micHoldRef  = useRef(false);

  const onMicDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    micHoldRef.current = true;
    micStartYRef.current = e.clientY;
    micLockedRef.current = false;
    micDelayRef.current = setTimeout(() => {
      if (micHoldRef.current) startRecording();
    }, 100);
  }, [startRecording]);

  const onMicMove = useCallback((e: React.PointerEvent) => {
    if (voiceState !== 'recording' || micLockedRef.current) return;
    const dy = micStartYRef.current - e.clientY;
    const p = Math.min(1, Math.max(0, dy / LOCK_THRESHOLD));
    setLockProgress(p);
    if (dy >= LOCK_THRESHOLD) {
      micLockedRef.current = true;
      setLocked(true);
      setLockProgress(1);
    }
  }, [voiceState]);

  const onMicUp = useCallback(() => {
    micHoldRef.current = false;
    if (micDelayRef.current) { clearTimeout(micDelayRef.current); micDelayRef.current = null; }
    if (!micLockedRef.current) stopRecording();
  }, [stopRecording]);

  const isFileMode = !!staged;
  const canSend    = isFileMode ? !uploading : (!!value.trim() && !disabled);

  // Animated icon style driven by amplitude
  const iconScale = voiceState === 'recording' ? 1 + micAmp * 0.25 : 1;

  return (
    <div className="composerWrap">
      <input ref={fileInputRef} type="file" accept="*/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) stageFile(f); e.target.value = ''; }} />

      {/* File staging card */}
      {staged && (
        <div className={`fileStagingCard${uploading ? ' fileStagingUploading' : ''}`}>
          <div className="fileStagingRow">
            <FileIconBadge name={staged.name} size={48} />
            <div className="fileStagingMeta">
              <div className="fileStagingName" title={staged.name}>{staged.name}</div>
              <div className="fileStagingSize">{formatFileSize(staged.size)}</div>
            </div>
            {uploading ? (
              <button className="fileStagingCancel" onClick={handleCancelUpload} title="Отменить">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>
                </svg>
              </button>
            ) : (
              <button className="fileStagingRemove" onClick={clearStage} title="Убрать файл">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
          {uploading && (
            <div className="fileProgressTrack">
              <div className="fileProgressFill" style={{ width: `${progress}%` }} />
              <span className="fileProgressPct">{progress}%</span>
            </div>
          )}
          {uploadErr && (
            <div className="fileStagingErr">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {uploadErr}
            </div>
          )}
          <input ref={captionInputRef} className="fileCaptionInput" value={caption}
            onChange={e => setCaption(e.target.value)} placeholder="Добавить подпись…"
            disabled={uploading} maxLength={1000}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendFile(); }
              if (e.key === 'Escape') clearStage();
            }} />
        </div>
      )}

      {/* ── Voice PREVIEW card ── */}
      {voiceState === 'preview' && voiceBlob && (
        <div className="voicePreviewCard">
          <div className="voicePreviewCardTop">
            <span className="voicePreviewLabel">Голосовое сообщение</span>
            <span className="voicePreviewDurLabel">{fmt(previewSecs)}</span>
          </div>
          <PreviewPlayer blob={voiceBlob} duration={previewSecs} />
          <div className="voicePreviewCardActions">
            <button className="voicePreviewDeleteBtn" onClick={cancelVoice} title="Удалить">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              Удалить
            </button>
            <button className="voicePreviewSendBtn" onClick={sendVoice} disabled={voiceSending} title="Отправить">
              {voiceSending ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="composerSpinner">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Отправить
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Normal composer row ── */}
      {voiceState !== 'preview' && (
        <div className="composer">
          {voiceState === 'recording' ? (
            /* Recording mode: minimal — trash | big timer + dot | mic-stop */
            <div className="voiceRecordingBar">
              <button className="voiceRecCancelBtn" onClick={cancelVoice} title="Отменить">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
              </button>
              <div className="voiceRecCenter">
                <span className="voiceRecDot" />
                <span className="voiceRecTimer">{fmt(recSeconds)}</span>
              </div>
              <span className="voiceRecHint">{locked ? '🔒 Зафиксировано' : 'Потяните вверх для фиксации'}</span>
            </div>
          ) : (
            <>
              <button
                className={`composerAttach${isFileMode ? ' composerAttachActive' : ''}`}
                onClick={() => { if (!uploading) fileInputRef.current?.click(); }}
                title="Прикрепить файл" disabled={uploading}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
              <input
                ref={textInputRef}
                className="composerInput"
                value={isFileMode ? '' : value}
                onChange={e => { if (!isFileMode) onChange(e.target.value); }}
                placeholder={uploading ? `Загрузка… ${progress}%` : isFileMode ? 'Файл готов к отправке' : 'Сообщение…'}
                disabled={isFileMode || disabled}
                onKeyDown={e => { if (!isFileMode && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (value.trim()) onSend(); } }}
              />
              <button
                className={`composerSend${uploading ? ' composerSendLoading' : ''}`}
                onClick={isFileMode ? () => handleSendFile() : () => { if (value.trim()) onSend(); }}
                disabled={!canSend}
              >
                {uploading ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="composerSpinner">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            </>
          )}

          {/* Waveform icon button (replaces mic) */}
          {!isFileMode && (
            <div className="composerMicWrap">
              {/* Lock track */}
              {voiceState === 'recording' && !locked && (
                <div className="voiceLockTrack">
                  <div className="voiceLockIcon" style={{
                    transform: `translateY(${-(lockProgress * 28)}px)`,
                    opacity: 0.45 + lockProgress * 0.55,
                  }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <rect x="3" y="11" width="18" height="11" rx="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </div>
                  <svg className="voiceLockArrow" width="10" height="16" viewBox="0 0 10 16">
                    <path d="M5 14 L5 2 M2 4 L5 1 L8 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.45"/>
                  </svg>
                </div>
              )}
              {voiceState === 'recording' && locked && (
                <div className="voiceLockedBadge" onClick={stopRecording} title="Нажмите для завершения">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 1 1 6.2 0v2z"/>
                  </svg>
                </div>
              )}

              <button
                className={`composerMic${voiceState === 'recording' ? (locked ? ' composerMicLocked' : ' composerMicActive') : ''}`}
                style={{ transform: `scale(${iconScale})` }}
                onPointerDown={onMicDown}
                onPointerMove={onMicMove}
                onPointerUp={onMicUp}
                onPointerCancel={onMicUp}
                title={voiceState === 'recording' ? (locked ? 'Нажмите для остановки' : 'Отпустите или потяните вверх') : 'Зажмите для записи'}
              >
                {voiceState === 'recording' && locked ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="3"/>
                  </svg>
                ) : (
                  <WaveformIcon size={20} />
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
