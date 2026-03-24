/**
 * Composer.tsx
 * Voice messages: hold mic -> live waveform + timer -> release -> preview -> send/cancel
 * File upload with progress & cancel unchanged
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { uploadFile } from '../../api/upload';
import type { UploadResult } from '../../api/upload';

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024)               return `${bytes} B`;
  if (bytes < 1024 * 1024)        return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
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

// Live waveform canvas
function Waveform({ data, color = 'var(--accent)', height = 36 }: { data: number[]; color?: string; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (data.length === 0) return;
    const barW = 3, gap = 2;
    const bars = Math.floor(W / (barW + gap));
    const step = Math.max(1, Math.floor(data.length / bars));
    ctx.fillStyle = color;
    for (let i = 0; i < bars; i++) {
      const slice = data.slice(i * step, i * step + step);
      const avg = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
      const barH = Math.max(3, avg * H);
      const x = i * (barW + gap);
      const y = (H - barH) / 2;
      ctx.beginPath();
      // @ts-ignore
      ctx.roundRect?.(x, y, barW, barH, 1.5) ?? ctx.rect(x, y, barW, barH);
      ctx.fill();
    }
  }, [data, color, height]);

  return (
    <canvas ref={canvasRef} width={260} height={height}
      style={{ width: '100%', height, display: 'block' }} />
  );
}

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
    cancelRef.current?.();
    cancelRef.current = null;
    setUploading(false);
    clearStage();
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
      if (e?.message !== 'Загрузка отменена') {
        setUploadErr(e?.message ?? 'Ошибка загрузки');
        setProgress(0);
      }
    } finally {
      setUploading(false);
      cancelRef.current = null;
    }
  }, [staged, caption, uploading, onSendAttachment, clearStage]);

  // Voice recording
  const [voiceState,   setVoiceState]   = useState<VoiceState>('idle');
  const [recSeconds,   setRecSeconds]   = useState(0);
  const [liveWave,     setLiveWave]     = useState<number[]>([]);
  const [previewWave,  setPreviewWave]  = useState<number[]>([]);
  const [previewSecs,  setPreviewSecs]  = useState(0);
  const [voiceBlob,    setVoiceBlob]    = useState<Blob | null>(null);
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

  useEffect(() => () => { stopCleanup(); }, []); // eslint-disable-line

  function stopCleanup() {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close();
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
        setPreviewWave([...liveWaveRef.current]);
        setPreviewSecs(recSecondsRef.current);
        setVoiceState('preview');
        stopCleanup();
      };

      mr.start(80);
      recSecondsRef.current = 0;
      setRecSeconds(0);
      setLiveWave([]);
      liveWaveRef.current = [];
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
      if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setVoiceState('idle');
    setVoiceBlob(null);
    setLiveWave([]);
    setPreviewWave([]);
    setRecSeconds(0);
    setPreviewSecs(0);
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

  // Pointer hold on mic button
  const micHoldRef  = useRef(false);
  const micDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMicDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    micHoldRef.current = true;
    micDelayRef.current = setTimeout(() => {
      if (micHoldRef.current) startRecording();
    }, 120);
  }, [startRecording]);

  const onMicUp = useCallback(() => {
    micHoldRef.current = false;
    if (micDelayRef.current) { clearTimeout(micDelayRef.current); micDelayRef.current = null; }
    stopRecording();
  }, [stopRecording]);

  const isFileMode = !!staged;
  const canSend    = isFileMode ? !uploading : (!!value.trim() && !disabled);

  return (
    <div className="composerWrap">
      <input ref={fileInputRef} type="file" accept="*/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) stageFile(f); e.target.value = ''; }} />

      {/* File staging */}
      {staged && (
        <div className={`fileStagingCard${uploading ? ' fileStagingUploading' : ''}`}>
          <div className="fileStagingRow">
            <FileIconBadge name={staged.name} size={48} />
            <div className="fileStagingMeta">
              <div className="fileStagingName" title={staged.name}>{staged.name}</div>
              <div className="fileStagingSize">{formatFileSize(staged.size)}</div>
            </div>
            {uploading ? (
              <button className="fileStagingCancel" onClick={handleCancelUpload} title="Отменить загрузку">
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

      {/* Voice preview (replaces composer row) */}
      {voiceState === 'preview' && (
        <div className="voicePreviewBar">
          <button className="voiceCancelBtn" onClick={cancelVoice} title="Отмена">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <div className="voicePreviewWave">
            <Waveform data={previewWave} height={36} />
          </div>
          <span className="voicePreviewDur">{formatDuration(previewSecs)}</span>
          <button className="voiceSendBtn" onClick={sendVoice} disabled={voiceSending} title="Отправить">
            {voiceSending ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="composerSpinner">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" width="19" height="19">
                <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Normal composer row */}
      {voiceState !== 'preview' && (
        <div className="composer">
          {voiceState === 'recording' ? (
            /* Recording overlay inside composer bar */
            <div className="voiceRecordingBar">
              <span className="voiceRecDot" />
              <span className="voiceRecTimer">{formatDuration(recSeconds)}</span>
              <div className="voiceRecWaveWrap">
                <Waveform data={liveWave} height={30} />
              </div>
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

          {/* Mic button — always present right of send/recording bar */}
          {!isFileMode && (
            <button
              className={`composerMic${voiceState === 'recording' ? ' composerMicActive' : ''}`}
              onPointerDown={onMicDown}
              onPointerUp={onMicUp}
              onPointerCancel={onMicUp}
              title={voiceState === 'recording' ? 'Отпустите чтобы остановить' : 'Зажмите для записи'}
            >
              {voiceState === 'recording' ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="3"/>
                </svg>
              ) : (
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
