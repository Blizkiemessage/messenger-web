/**
 * Composer.tsx  ✅
 * - Waveform icon (instead of mic) that pulses with accent colour
 * - Recording: clean timer + dots, NO canvas waveform
 * - Preview: mini player with real waveform bars + play-before-send
 * - Lock mode: drag-up to hands-free recording
 */
import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { uploadFile } from '../../api/upload';
import type { UploadResult } from '../../api/upload';
import { type User } from '../../types';
import { MentionPopup }   from './MentionPopup';
import { CameraOverlay }  from './CameraOverlay';
import { FormatToolbar }  from './FormatToolbar';
import { mdToHtml, htmlToMd, getTextBeforeCursor } from '../../utils/richText';
import { fmt, computeWaveformBars } from './composer/helpers';
import { FileIconBadge, WaveformIcon, VideoNoteIcon } from './composer/icons';
import { PreviewPlayer } from './composer/PreviewPlayer';
const EmojiStickerPanel = lazy(() => import('./EmojiStickerPanel').then(m => ({ default: m.EmojiStickerPanel })));


// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSendAttachment: (result: UploadResult, caption: string) => Promise<void>;
  onSendGif?: (url: string) => Promise<void>;
  externalFiles?: File[] | null;
  onExternalFileConsumed?: () => void;
  disabled?: boolean;
  isGroup?: boolean;
  onOpenPollCreator?: () => void;
  onSendSticker?: (url: string, itemId: string, packId: string) => Promise<void>;
  onOpenStudio?: () => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  editingMessageId?: string | null;
  onCancelEdit?: () => void;
  members?: User[];
  blockedByThem?: boolean;
  partnerName?: string;
  /** F1: open the schedule date picker for current text */
  onOpenSchedule?: () => void;
  /** F1: open the scheduled messages list */
  onOpenScheduledList?: () => void;
}

type VoiceState = 'idle' | 'recording' | 'preview';
const LOCK_THRESHOLD = 60;

// ── Component ─────────────────────────────────────────────────────────────────

export function Composer({ value, onChange, onSend, onSendAttachment, externalFiles, onExternalFileConsumed, disabled, isGroup, onOpenPollCreator, onSendGif, onSendSticker, onOpenStudio, onTypingStart, onTypingStop, editingMessageId, onCancelEdit, members, blockedByThem, partnerName, onOpenSchedule, onOpenScheduledList }: Props) {
  const { t } = useTranslation('chat');
  // Multi-file staging
  const [stagedFiles,  setStagedFiles]  = useState<File[]>([]);
  const [thumbUrls,    setThumbUrls]    = useState<(string | null)[]>([]);
  const [caption,      setCaption]      = useState('');
  const [progresses,   setProgresses]   = useState<number[]>([]);
  const [uploading,    setUploading]    = useState(false);
  const [uploadErr,    setUploadErr]    = useState<string | null>(null);

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);
  const editorRef       = useRef<HTMLDivElement>(null);
  const cancelRefs      = useRef<Array<() => void>>([]);
  // Track last markdown value to avoid external-value → innerHTML → onChange loops
  const lastMdRef       = useRef(value);
  // Track Range start for @mention detection
  const mentionRangeRef = useRef<Range | null>(null);

  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  const [cameraOpen, setCameraOpen] = useState(false);

  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  // ── Mention popup ─────────────────────────────────────────────────────────
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx,   setMentionIdx]   = useState(0);

  const filteredMembers = mentionQuery !== null
    ? (members ?? []).filter(m => {
        if (!m.username) return false;
        const q = mentionQuery.toLowerCase();
        return (m.username ?? '').toLowerCase().includes(q)
            || (m.display_name ?? '').toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  const selectMention = useCallback((username: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && mentionRangeRef.current) {
      try {
        // Select from start-of-@ to current cursor and replace with @username
        const endRange = sel.getRangeAt(0);
        const range = document.createRange();
        range.setStart(mentionRangeRef.current.startContainer, mentionRangeRef.current.startOffset);
        range.setEnd(endRange.endContainer, endRange.endOffset);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('insertText', false, '@' + username + ' ');
        const md = htmlToMd(editor);
        lastMdRef.current = md;
        onChange(md);
      } catch { /* ignore — just close the popup */ }
    }
    setMentionQuery(null);
    mentionRangeRef.current = null;
    setMentionIdx(0);
    setTimeout(() => editor.focus(), 0);
  }, [mentionQuery, onChange]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    function onOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [attachMenuOpen]);

  useEffect(() => {
    if (!emojiOpen) return;
    function onOutside(e: MouseEvent) {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [emojiOpen]);

  const insertEmoji = useCallback((native: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand('insertText', false, native);
    const md = htmlToMd(editor);
    lastMdRef.current = md;
    onChange(md);
  }, [onChange]);

  const insertCustomEmoji = useCallback((packId: string, itemId: string, fileUrl: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();

    // Build a non-editable inline image that serializes to :packId:itemId:
    const img = document.createElement('img');
    img.dataset.emoji = `${packId}:${itemId}`;
    img.src = fileUrl;
    img.className = 'customEmojiInline';
    img.setAttribute('contenteditable', 'false');
    img.alt = `:${packId}:${itemId}:`;
    img.draggable = false;

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.appendChild(img);
    }

    const md = htmlToMd(editor);
    lastMdRef.current = md;
    onChange(md);
  }, [onChange]);

  useEffect(() => {
    if (externalFiles && externalFiles.length > 0) { addFiles(externalFiles); onExternalFileConsumed?.(); }
  }, [externalFiles]); // eslint-disable-line

  // Sync external value changes → innerHTML (but not changes caused by typing).
  // We intentionally do NOT skip when lastMdRef.current === value here —
  // the guard only prevents loops from onInput, but draft restores must always
  // reach the DOM. We skip only when the editor itself produced the value.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (value === lastMdRef.current) return; // came from editor input, skip
    // External change (draft restore, edit-mode populate, cancel edit, send) —
    // always sync to DOM
    lastMdRef.current = value;
    editor.innerHTML = value ? mdToHtml(value) : '';
    // Place cursor at end
    try {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch { /* ignore */ }
  }, [value]);

  function addFiles(files: File[]) {
    setStagedFiles(prev => [...prev, ...files]);
    if (files.length > 0) setTimeout(() => captionInputRef.current?.focus(), 80);
  }

  function removeFile(idx: number) {
    setStagedFiles(prev => prev.filter((_, i) => i !== idx));
  }

  const clearStage = useCallback(() => {
    setStagedFiles([]); setCaption(''); setProgresses([]); setUploadErr(null);
    setTimeout(() => editorRef.current?.focus(), 60);
  }, []);

  const handleCancelUpload = useCallback(() => {
    cancelRefs.current.forEach(c => c?.());
    cancelRefs.current = [];
    setUploading(false); clearStage();
  }, [clearStage]);

  const handleSendFile = useCallback(async (fileOverride?: File, captionOverride?: string, durationHint?: number, waveformHint?: number[]) => {
    const f = fileOverride;
    const c = captionOverride !== undefined ? captionOverride : '';
    if (!f || uploading) return;
    setUploading(true); setProgresses([0]); setUploadErr(null);
    const task = uploadFile(f, pct => setProgresses([pct]));
    cancelRefs.current = [task.cancel];
    try {
      const result = await task.promise;
      const enriched = {
        ...result,
        ...(durationHint   ? { duration: durationHint }   : {}),
        ...(waveformHint?.length ? { waveform: waveformHint } : {}),
      };
      await onSendAttachment(enriched, c);
    } catch (e: any) {
      if (e?.message !== t('upload.cancelled')) { setUploadErr(e?.message ?? t('composer.uploadError')); setProgresses([0]); }
    } finally {
      setUploading(false); cancelRefs.current = [];
    }
  }, [uploading, onSendAttachment, t]);

  const handleSendFiles = useCallback(async () => {
    if (stagedFiles.length === 0 || uploading) return;
    setUploading(true); setUploadErr(null);
    const allFiles = [...stagedFiles];
    const captionText = caption.trim();
    const initProgresses = new Array(allFiles.length).fill(0);
    setProgresses(initProgresses);
    cancelRefs.current = [];
    try {
      for (let batchStart = 0; batchStart < allFiles.length; batchStart += 10) {
        const batch = allFiles.slice(batchStart, batchStart + 10);
        const tasks = batch.map((file, i) => {
          const globalIdx = batchStart + i;
          const task = uploadFile(file, pct => {
            setProgresses(prev => { const next = [...prev]; next[globalIdx] = pct; return next; });
          });
          cancelRefs.current[globalIdx] = task.cancel;
          return task.promise;
        });
        const results = await Promise.all(tasks);
        for (let i = 0; i < results.length; i++) {
          const isFirst = batchStart === 0 && i === 0;
          await onSendAttachment(results[i], isFirst ? captionText : '');
        }
      }
      clearStage();
    } catch (e: any) {
      if (e?.message !== t('upload.cancelled')) { setUploadErr(e?.message ?? t('composer.uploadError')); }
    } finally {
      setUploading(false); cancelRefs.current = [];
    }
  }, [stagedFiles, caption, uploading, onSendAttachment, clearStage, t]);

  // ── Recording mode: audio | video ─────────────────────────────────────────
  const [recordMode, setRecordMode] = useState<'audio' | 'video'>('audio');

  // Voice recording
  const [voiceState,    setVoiceState]    = useState<VoiceState>('idle');
  const [locked,        setLocked]        = useState(false);
  const [lockProgress,  setLockProgress]  = useState(0);
  const [recSeconds,    setRecSeconds]    = useState(0);
  const [, setLiveWave]      = useState<number[]>([]);
  const [voiceBlob,     setVoiceBlob]     = useState<Blob | null>(null);
  const [previewSecs,   setPreviewSecs]   = useState(0);
  const [voiceSending,  setVoiceSending]  = useState(false);
  const [voiceWaveform, setVoiceWaveform] = useState<number[]>([]);
  const [micError,      setMicError]      = useState(false);
  const waveformBarsRef = useRef<number[]>([]);

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

  // ── Video note recording state ─────────────────────────────────────────────
  const [videoState,        setVideoState]        = useState<VoiceState>('idle');
  const [videoLocked,       setVideoLocked]       = useState(false);
  const [videoLockProgress, setVideoLockProgress] = useState(0);
  const [videoRecSeconds,   setVideoRecSeconds]   = useState(0);
  const [videoBlob,         setVideoBlob]         = useState<Blob | null>(null);
  const [videoPreviewUrl,   setVideoPreviewUrl]   = useState<string | null>(null);
  const [videoPreviewSecs,  setVideoPreviewSecs]  = useState(0);
  const [videoSending,      setVideoSending]      = useState(false);
  const [videoFacing,       setVideoFacing]       = useState<'user' | 'environment'>('user');
  const [previewPlaying,    setPreviewPlaying]    = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const videoStreamRef      = useRef<MediaStream | null>(null);
  const videoAudioStreamRef = useRef<MediaStream | null>(null);
  const videoRecorderRef    = useRef<MediaRecorder | null>(null);
  const videoChunksRef      = useRef<Blob[]>([]);
  const videoCanvasRef      = useRef<HTMLCanvasElement | null>(null); // off-screen canvas, created programmatically
  const videoViewfinderRef  = useRef<HTMLVideoElement | null>(null);  // visible <video> element in DOM
  const videoDrawElemRef    = useRef<HTMLVideoElement | null>(null);  // hidden video element for canvas draw loop
  const videoDrawRafRef     = useRef<number>(0);
  const videoTimerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRecSecondsRef  = useRef(0);
  const videoFacingRef      = useRef<'user' | 'environment'>('user');
  const videoLockedRef      = useRef(false);

  useEffect(() => () => { stopCleanup(); stopVideoCleanup(); }, []); // eslint-disable-line

  function stopCleanup() {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }

  const startRecording = useCallback(async () => {
    if (voiceState !== 'idle' || stagedFiles.length > 0) return;
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
        const bars = computeWaveformBars(liveWaveRef.current);
        waveformBarsRef.current = bars;
        setVoiceWaveform(bars);
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
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name ?? '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'NotFoundError') {
        setMicError(true);
        setTimeout(() => setMicError(false), 4000);
      }
    }
  }, [voiceState, stagedFiles.length]);

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
    setVoiceWaveform([]);
    micLockedRef.current = false;
    liveWaveRef.current  = [];
    waveformBarsRef.current = [];
  }, [voiceState]);

  const sendVoice = useCallback(async () => {
    if (!voiceBlob || voiceSending) return;
    setVoiceSending(true);
    // Decode precise duration from the blob (already in memory) before uploading
    let voiceDuration: number | undefined;
    try {
      const buf = await voiceBlob.arrayBuffer();
      const actx = new AudioContext();
      const dec = await actx.decodeAudioData(buf);
      actx.close();
      voiceDuration = dec.duration > 0 ? dec.duration : undefined;
    } catch {
      voiceDuration = recSecondsRef.current > 0 ? recSecondsRef.current : undefined;
    }
    const ext = voiceBlob.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([voiceBlob], `voice_${Date.now()}.${ext}`, { type: voiceBlob.type });
    await handleSendFile(file, '', voiceDuration, waveformBarsRef.current);
    setVoiceSending(false);
    cancelVoice();
  }, [voiceBlob, voiceSending, handleSendFile, cancelVoice]);

  // ── Video note recording functions ────────────────────────────────────────

  function stopVideoCleanup() {
    cancelAnimationFrame(videoDrawRafRef.current);
    if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; }
    videoStreamRef.current?.getTracks().forEach(t => t.stop());
    videoAudioStreamRef.current?.getTracks().forEach(t => t.stop());
    videoStreamRef.current = null;
    videoAudioStreamRef.current = null;
    if (videoDrawElemRef.current) {
      videoDrawElemRef.current.srcObject = null;
      videoDrawElemRef.current = null;
    }
  }

  const startVideoRecording = useCallback(async () => {
    if (videoState !== 'idle' || voiceState !== 'idle' || stagedFiles.length > 0) return;
    try {
      // Get camera + audio as separate streams so we can switch camera without losing audio
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: videoFacingRef.current, width: { ideal: 512 }, height: { ideal: 512 } },
        audio: false,
      });
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      videoStreamRef.current = cameraStream;
      videoAudioStreamRef.current = audioStream;

      // Create off-screen canvas programmatically (not DOM-dependent)
      const canvas = document.createElement('canvas');
      canvas.width  = 512;
      canvas.height = 512;
      videoCanvasRef.current = canvas;
      const ctx = canvas.getContext('2d')!;

      // Hidden video element feeds the draw loop
      const vid = document.createElement('video');
      vid.srcObject = cameraStream;
      vid.muted = true;
      vid.playsInline = true;
      await vid.play().catch(() => {});
      videoDrawElemRef.current = vid;

      // Also connect viewfinder if already in DOM
      if (videoViewfinderRef.current) {
        videoViewfinderRef.current.srcObject = cameraStream;
        await videoViewfinderRef.current.play().catch(() => {});
      }

      // RAF draw loop: camera → canvas (mirrored for front cam)
      const draw = () => {
        if (!videoDrawElemRef.current || !videoCanvasRef.current) return;
        ctx.save();
        if (videoFacingRef.current === 'user') {
          ctx.translate(512, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(videoDrawElemRef.current, 0, 0, 512, 512);
        ctx.restore();
        videoDrawRafRef.current = requestAnimationFrame(draw);
      };
      videoDrawRafRef.current = requestAnimationFrame(draw);

      // Canvas capture stream + audio track
      const canvasStream = (canvas as any).captureStream(30) as MediaStream;
      audioStream.getAudioTracks().forEach(t => canvasStream.addTrack(t));

      // MediaRecorder on canvas stream
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';
      const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 800_000, audioBitsPerSecond: 64_000 });
      videoRecorderRef.current = recorder;
      videoChunksRef.current = [];

      recorder.ondataavailable = e => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(videoChunksRef.current, { type: 'video/webm' });
        const url  = URL.createObjectURL(blob);
        setVideoBlob(blob);
        setVideoPreviewUrl(url);
        setVideoPreviewSecs(videoRecSecondsRef.current);
        setVideoState('preview');
        setVideoLocked(false);
        setVideoLockProgress(0);
        videoLockedRef.current = false;
        stopVideoCleanup();
      };

      recorder.start(80);
      videoRecSecondsRef.current = 0;
      setVideoRecSeconds(0);
      setVideoState('recording');

      videoTimerRef.current = setInterval(() => {
        videoRecSecondsRef.current += 1;
        setVideoRecSeconds(videoRecSecondsRef.current);
      }, 1000);

    } catch { /* camera/mic denied */ }
  }, [videoState, voiceState, stagedFiles.length]); // eslint-disable-line

  const stopVideoRecording = useCallback(() => {
    if (videoState !== 'recording') return;
    if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; }
    cancelAnimationFrame(videoDrawRafRef.current);
    videoRecorderRef.current?.stop();
    videoStreamRef.current?.getTracks().forEach(t => t.stop());
  }, [videoState]);

  const cancelVideo = useCallback(() => {
    if (videoState === 'recording') {
      if (videoTimerRef.current) clearInterval(videoTimerRef.current);
      cancelAnimationFrame(videoDrawRafRef.current);
      if (videoRecorderRef.current?.state !== 'inactive') {
        videoRecorderRef.current!.onstop = null;
        videoRecorderRef.current!.stop();
      }
      stopVideoCleanup();
    }
    if (videoPreviewUrl) { URL.revokeObjectURL(videoPreviewUrl); }
    setVideoState('idle');
    setVideoBlob(null);
    setVideoPreviewUrl(null);
    setVideoRecSeconds(0);
    setVideoPreviewSecs(0);
    setVideoLocked(false);
    setVideoLockProgress(0);
    setPreviewPlaying(false);
    videoLockedRef.current = false;
    videoRecSecondsRef.current = 0;
  }, [videoState, videoPreviewUrl]); // eslint-disable-line

  const sendVideo = useCallback(async () => {
    if (!videoBlob || videoSending) return;
    setVideoSending(true);
    const file = new File([videoBlob], `video_note_${Date.now()}.webm`, { type: 'video/webm' });
    try {
      const task = uploadFile(file, () => {});
      const result = await task.promise;
      const videoDuration = videoRecSecondsRef.current > 0 ? videoRecSecondsRef.current : undefined;
      await onSendAttachment({ ...result, type: 'video_note', duration: videoDuration }, '');
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      setVideoSending(false);
      setVideoState('idle');
      setVideoBlob(null);
      setVideoPreviewUrl(null);
      setVideoPreviewSecs(0);
      setPreviewPlaying(false);
      videoRecSecondsRef.current = 0;
    } catch {
      setVideoSending(false);
    }
  }, [videoBlob, videoSending, videoPreviewUrl, onSendAttachment]);

  const flipVideoCamera = useCallback(async () => {
    const newFacing = videoFacingRef.current === 'user' ? 'environment' : 'user';
    videoFacingRef.current = newFacing;
    setVideoFacing(newFacing);
    // Stop current camera stream
    videoStreamRef.current?.getTracks().forEach(t => t.stop());
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing, width: { ideal: 512 }, height: { ideal: 512 } },
        audio: false,
      });
      videoStreamRef.current = newStream;
      // Update both the hidden draw element and the visible viewfinder
      if (videoDrawElemRef.current) {
        videoDrawElemRef.current.srcObject = newStream;
        await videoDrawElemRef.current.play().catch(() => {});
      }
      if (videoViewfinderRef.current) {
        videoViewfinderRef.current.srcObject = newStream;
        await videoViewfinderRef.current.play().catch(() => {});
      }
    } catch { /* camera switch failed, continue with existing */ }
  }, []);

  // Generate / revoke object URLs for image thumbnails
  useEffect(() => {
    const urls = stagedFiles.map(f => f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
    setThumbUrls(urls);
    return () => { urls.forEach(u => u && URL.revokeObjectURL(u)); };
  }, [stagedFiles]);

  const isFileMode = stagedFiles.length > 0;
  const canSend    = isFileMode ? !uploading : (!!value.trim() && !disabled);

  // When videoState becomes 'recording', the overlay mounts and the viewfinder <video> element appears.
  // Connect the camera stream to the viewfinder at that point.
  useEffect(() => {
    if (videoState === 'recording' && videoViewfinderRef.current && videoStreamRef.current) {
      videoViewfinderRef.current.srcObject = videoStreamRef.current;
      videoViewfinderRef.current.play().catch(() => {});
    }
  }, [videoState]);

  // Pointer hold + lock drag
  const micDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micHoldRef  = useRef(false);

  const onMicDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    micHoldRef.current = true;
    micStartYRef.current = e.clientY;
    micLockedRef.current = false;
    videoLockedRef.current = false;
    micDelayRef.current = setTimeout(() => {
      if (micHoldRef.current) {
        if (recordMode === 'audio') startRecording();
        else startVideoRecording();
      }
    }, 100);
  }, [recordMode, startRecording, startVideoRecording]);

  const onMicMove = useCallback((e: React.PointerEvent) => {
    if (voiceState === 'recording' && !micLockedRef.current) {
      const dy = micStartYRef.current - e.clientY;
      const p = Math.min(1, Math.max(0, dy / LOCK_THRESHOLD));
      setLockProgress(p);
      if (dy >= LOCK_THRESHOLD) {
        micLockedRef.current = true;
        setLocked(true);
        setLockProgress(1);
      }
    }
    if (videoState === 'recording' && !videoLockedRef.current) {
      const dy = micStartYRef.current - e.clientY;
      const p = Math.min(1, Math.max(0, dy / LOCK_THRESHOLD));
      setVideoLockProgress(p);
      if (dy >= LOCK_THRESHOLD) {
        videoLockedRef.current = true;
        setVideoLocked(true);
        setVideoLockProgress(1);
      }
    }
  }, [voiceState, videoState]);

  const onMicUp = useCallback(() => {
    const wasHolding = micHoldRef.current;
    micHoldRef.current = false;
    const timerWasPending = micDelayRef.current !== null;
    if (micDelayRef.current) { clearTimeout(micDelayRef.current); micDelayRef.current = null; }
    // Quick tap (timer hadn't fired yet) and currently idle → toggle mode
    if (wasHolding && timerWasPending && voiceState === 'idle' && videoState === 'idle' && !canSend) {
      setRecordMode(m => m === 'audio' ? 'video' : 'audio');
      return;
    }
    if (!micLockedRef.current) stopRecording();
    if (!videoLockedRef.current) stopVideoRecording();
  }, [voiceState, videoState, canSend, stopRecording, stopVideoRecording]);

  // Animated icon style driven by amplitude
  const iconScale = voiceState === 'recording' ? 1 + micAmp * 0.25 : 1;

  if (blockedByThem) {
    return (
      <div className="composerBlocked">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
        <span>{t('composer.blockedByPartner', { name: partnerName || t('composer.blockedByPartnerFallback') })}</span>
      </div>
    );
  }

  return (
    <div className="composerWrap">
      {cameraOpen && (
        <CameraOverlay
          onCapture={(file, cap) => {
            setCameraOpen(false);
            handleSendFile(file, cap);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      <input ref={fileInputRef} type="file" accept="*/*" multiple style={{ display: 'none' }}
        onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) addFiles(files); e.target.value = ''; }} />

      {/* Multi-file staging card */}
      {stagedFiles.length > 0 && (
        <div className={`fileStagingCard${uploading ? ' fileStagingUploading' : ''}`}>
          {/* Header row */}
          <div className="fileStagingHeader">
            <span className="fileStagingCount">
              {stagedFiles.length} {t('composer.filesCount', { count: stagedFiles.length })}
              {stagedFiles.length > 10 && (
                <span className="fileStagingBatchHint"> {t('composer.batchHint', { count: Math.ceil(stagedFiles.length / 10) })}</span>
              )}
            </span>
            {uploading ? (
              <button className="fileStagingCancel" onClick={handleCancelUpload} title={t('common:cancel')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>
                </svg>
                {t('common:cancel')}
              </button>
            ) : (
              <button className="fileStagingRemove" onClick={clearStage} title={t('composer.removeAll')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                {t('composer.removeAll')}
              </button>
            )}
          </div>

          {/* Scrollable thumbnails row */}
          <div className="fileStagingMultiList">
            {stagedFiles.map((file, idx) => (
              <div key={idx} className="fileStagingMultiItem">
                {thumbUrls[idx] ? (
                  <img src={thumbUrls[idx]!} className="fileStagingThumb" alt={file.name} />
                ) : (
                  <div className="fileStagingMultiIcon">
                    <FileIconBadge name={file.name} size={30} />
                  </div>
                )}
                {uploading && (
                  <div className="fileStagingThumbOverlay">
                    <div className="fileStagingThumbProgressFill" style={{ height: `${100 - (progresses[idx] ?? 0)}%` }} />
                    {(progresses[idx] ?? 0) < 100 && (
                      <span className="fileStagingThumbPct">{progresses[idx] ?? 0}%</span>
                    )}
                  </div>
                )}
                {!uploading && (
                  <button className="fileStagingMultiRemove" onClick={() => removeFile(idx)} title={t('composer.remove')}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
                <div className="fileStagingMultiName" title={file.name}>{file.name}</div>
              </div>
            ))}
            {/* Add more button */}
            {!uploading && (
              <button className="fileStagingAddMore" onClick={() => fileInputRef.current?.click()} title={t('composer.addMore')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            )}
          </div>

          {uploadErr && (
            <div className="fileStagingErr">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {uploadErr}
            </div>
          )}
          <div className="fileCaptionRow">
            <input ref={captionInputRef} className="fileCaptionInput" value={caption}
              onChange={e => setCaption(e.target.value)} placeholder={t('composer.addCaptionPlaceholder')}
              disabled={uploading} maxLength={1000}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendFiles(); }
                if (e.key === 'Escape') clearStage();
              }} />
            <button
              className="fileCaptionSendBtn"
              onClick={handleSendFiles}
              disabled={uploading}
              title={t('composer.send')}
            >
              {uploading ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="composerSpinner">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                  <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Voice PREVIEW card ── */}
      {voiceState === 'preview' && voiceBlob && (
        <div className="voicePreviewCard">
          <div className="voicePreviewCardTop">
            <span className="voicePreviewLabel">{t('composer.voiceMessage')}</span>
            <span className="voicePreviewDurLabel">{fmt(previewSecs)}</span>
          </div>
          <PreviewPlayer blob={voiceBlob} duration={previewSecs} waveform={voiceWaveform} />
          <div className="voicePreviewCardActions">
            <button className="voicePreviewDeleteBtn" onClick={cancelVoice} title={t('common:delete')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              {t('common:delete')}
            </button>
            <button className="voicePreviewSendBtn" onClick={sendVoice} disabled={voiceSending} title={t('composer.send')}>
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
                  {t('composer.send')}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Video note PREVIEW card ── */}
      {videoState === 'preview' && videoPreviewUrl && (
        <div className="videoNotePreviewCard">
          <div className="videoNotePreviewCardTop">
            <span className="voicePreviewLabel">{t('composer.videoMessage')}</span>
            <span className="voicePreviewDurLabel">{fmt(videoPreviewSecs)}</span>
          </div>
          <div className="videoNotePreviewVideoWrap" onClick={() => {
              const v = previewVideoRef.current;
              if (!v) return;
              v.paused ? v.play().catch(() => {}) : v.pause();
            }}>
            <video
              ref={previewVideoRef}
              src={videoPreviewUrl}
              className="videoNotePreviewVideo"
              playsInline
              loop
              onPlay={() => setPreviewPlaying(true)}
              onPause={() => setPreviewPlaying(false)}
              onEnded={() => setPreviewPlaying(false)}
            />
            {!previewPlaying && (
              <div className="videoNotePreviewPlayBtn">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
            )}
          </div>
          <div className="voicePreviewCardActions">
            <button className="voicePreviewDeleteBtn" onClick={cancelVideo} title={t('common:delete')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              {t('common:delete')}
            </button>
            <button className="voicePreviewSendBtn" onClick={sendVideo} disabled={videoSending} title={t('composer.send')}>
              {videoSending ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="composerSpinner">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {t('composer.send')}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Video note RECORDING overlay — portal, centered on screen ── */}
      {videoState === 'recording' && createPortal(
        <div className="videoNoteModal">
          <div className="videoNoteModalBackdrop" onClick={cancelVideo} />
          <div className="videoNoteModalContent">
            {/* Circular viewfinder */}
            <div className="videoNoteViewfinderWrap">
              <video
                ref={videoViewfinderRef}
                className={`videoNoteViewfinder${videoFacing === 'user' ? ' videoNoteViewfinderMirrored' : ''}`}
                autoPlay
                muted
                playsInline
              />
            </div>
            {/* REC badge — top-left of circle */}
            <div className="videoNoteRecBadge">
              <span className="videoNoteRecDot" />
              <span>{fmt(videoRecSeconds)}</span>
            </div>
            {/* Flip camera — top-right of circle */}
            <button className="videoNoteFlipBtn" onClick={flipVideoCamera} title={t('composer.flipCamera')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 4v6h6"/>
                <path d="M23 20v-6h-6"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/>
                <path d="M3.51 15a9 9 0 0 0 14.85 3.36L23 14"/>
              </svg>
            </button>
            {/* Send button — appears when recording is locked (hands-free mode) */}
            {videoLocked ? (
              <button
                className="videoNoteModalSendBtn"
                onClick={stopVideoRecording}
                title={t('composer.doneToPreview')}
              >
                <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                  <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2.2"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            ) : (
              <div className="videoNoteModalHint">
                {t('composer.releaseToFinishHint')}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ── Mention popup ── */}
      {mentionQuery !== null && filteredMembers.length > 0 && (
        <MentionPopup
          members={filteredMembers}
          filter={mentionQuery}
          activeIdx={mentionIdx}
          onSelect={selectMention}
        />
      )}

      {/* ── Formatting toolbar (shown on text selection) ── */}
      {!isFileMode && voiceState === 'idle' && videoState === 'idle' && (
        <FormatToolbar
          editorRef={editorRef}
          onChange={onChange}
        />
      )}

      {/* ── Editing banner ── */}
      {editingMessageId && (
        <div className="editingBanner">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          <span>{t('composer.editing')}</span>
          <button className="editingBannerClose" onClick={onCancelEdit} title={t('composer.cancelEditing')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      {/* ── Normal composer row ── */}
      {voiceState !== 'preview' && videoState !== 'preview' && (
        <div className="composer">
          {voiceState === 'recording' ? (
            /* Voice recording mode: minimal — trash | big timer + dot | mic-stop */
            <div className="voiceRecordingBar">
              <button className="voiceRecCancelBtn" onClick={cancelVoice} title={t('common:cancel')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
              <div className="voiceRecCenter">
                <span className="voiceRecDot" />
                <span className="voiceRecTimer">{fmt(recSeconds)}</span>
              </div>
              <span className="voiceRecHint">{locked ? t('composer.locked') : t('composer.pullUpToLock')}</span>
            </div>
          ) : videoState === 'recording' ? (
            /* Video recording mode: minimal bar below circular viewfinder */
            <div className="voiceRecordingBar">
              <button className="voiceRecCancelBtn" onClick={cancelVideo} title={t('common:cancel')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
              <div className="voiceRecCenter">
                <span className="voiceRecDot voiceRecDotVideo" />
                <span className="voiceRecTimer">{fmt(videoRecSeconds)}</span>
              </div>
              <span className="voiceRecHint">{videoLocked ? t('composer.locked') : t('composer.pullUpToLock')}</span>
            </div>
          ) : (
            <>
              <div style={{ position: 'relative' }} ref={attachMenuRef}>
                <button
                  className={`composerAttach${isFileMode || attachMenuOpen ? ' composerAttachActive' : ''}`}
                  onClick={() => { if (!uploading) setAttachMenuOpen(v => !v); }}
                  title={t('composer.attach')} disabled={uploading}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
                {attachMenuOpen && (
                  <div className="composerAttachMenu">
                    <button className="composerAttachMenuItem" onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                      </svg>
                      {t('composer.filesAndMedia')}
                    </button>
                    <button className="composerAttachMenuItem" onClick={() => { setAttachMenuOpen(false); setCameraOpen(true); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                      </svg>
                      {t('composer.camera')}
                    </button>
                    {isGroup && onOpenPollCreator && (
                      <button className="composerAttachMenuItem" onClick={() => { setAttachMenuOpen(false); onOpenPollCreator(); }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="8" x2="11" y2="8"/><line x1="8" y1="16" x2="14" y2="16"/>
                        </svg>
                        {t('composer.poll')}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="composerInputWrap">
                <div
                  ref={editorRef}
                  contentEditable={!isFileMode && !disabled ? 'true' : 'false'}
                  suppressContentEditableWarning
                  className="composerInput"
                  data-placeholder={uploading ? t('composer.uploading') : isFileMode ? t('composer.filesReadyPlaceholder') : t('composer.messagePlaceholder')}
                  dir="auto"
                  onContextMenu={e => e.preventDefault()}
                  onInput={() => {
                    if (isFileMode) return;
                    const editor = editorRef.current;
                    if (!editor) return;
                    const md = htmlToMd(editor);
                    lastMdRef.current = md;
                    onChange(md);
                    // Typing indicators
                    if (md.trim()) {
                      if (!isTypingRef.current) { isTypingRef.current = true; onTypingStart?.(); }
                      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                      typingTimerRef.current = setTimeout(() => {
                        isTypingRef.current = false; onTypingStop?.();
                        typingTimerRef.current = null;
                      }, 3000);
                    } else {
                      if (isTypingRef.current) { isTypingRef.current = false; onTypingStop?.(); }
                      if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
                    }
                    // Mention detection
                    if (members?.length) {
                      const textBefore = getTextBeforeCursor(editor);
                      const match = textBefore.match(/@(\w*)$/);
                      if (match) {
                        if (mentionQuery === null) {
                          // Save position of @ for later replacement
                          const sel = window.getSelection();
                          if (sel && sel.rangeCount > 0) {
                            try {
                              const r = sel.getRangeAt(0).cloneRange();
                              if (r.startContainer.nodeType === Node.TEXT_NODE) {
                                r.setStart(r.startContainer, Math.max(0, r.startOffset - match[0].length));
                              }
                              mentionRangeRef.current = r;
                            } catch { /* ignore */ }
                          }
                        }
                        setMentionQuery(match[1].toLowerCase());
                        setMentionIdx(0);
                      } else {
                        setMentionQuery(null);
                        mentionRangeRef.current = null;
                      }
                    }
                  }}
                  onKeyDown={e => {
                    // Mention popup keyboard navigation
                    if (mentionQuery !== null && filteredMembers.length > 0) {
                      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => (i - 1 + filteredMembers.length) % filteredMembers.length); return; }
                      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % filteredMembers.length); return; }
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); selectMention(filteredMembers[mentionIdx]?.username ?? ''); return; }
                      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return; }
                    }
                    const isMobile = navigator.maxTouchPoints > 0 && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                    if (!isFileMode && e.key === 'Enter') {
                      if (!e.shiftKey && !isMobile) {
                        e.preventDefault();
                        if (value.trim()) {
                          if (isTypingRef.current) { isTypingRef.current = false; onTypingStop?.(); }
                          if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
                          onSend();
                        }
                      } else {
                        // Shift+Enter or mobile: insert newline
                        e.preventDefault();
                        document.execCommand('insertLineBreak');
                      }
                    }
                  }}
                  onPaste={e => {
                    e.preventDefault();
                    // Collect all files/images from clipboard
                    const items = e.clipboardData?.items;
                    if (items) {
                      const pastedFiles: File[] = [];
                      for (const item of Array.from(items)) {
                        if (item.kind === 'file') {
                          const file = item.getAsFile();
                          if (file) pastedFiles.push(file);
                        }
                      }
                      if (pastedFiles.length > 0) { addFiles(pastedFiles); return; }
                    }
                    // Text paste — insert as plain text (strip HTML)
                    const text = e.clipboardData?.getData('text/plain');
                    if (text) document.execCommand('insertText', false, text);
                  }}
                />
              </div>{/* composerInputWrap */}
              {/* ── Emoji picker button ── */}
              {!isFileMode && voiceState === 'idle' && videoState === 'idle' && (
                <div className="composerEmojiWrap" ref={emojiWrapRef}>
                  <button
                    className={`composerEmojiBtn${emojiOpen ? ' active' : ''}`}
                    onClick={() => setEmojiOpen(v => !v)}
                    title={t('composer.emoji')}
                    tabIndex={-1}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                      <line x1="9" y1="9" x2="9.01" y2="9"/>
                      <line x1="15" y1="9" x2="15.01" y2="9"/>
                    </svg>
                  </button>
                  {emojiOpen && (
                    <div className="composerEmojiPanel">
                      <Suspense fallback={null}>
                        <EmojiStickerPanel
                          onEmojiSelect={(e: { native: string }) => insertEmoji(e.native)}
                          onSendGif={async (url) => { await onSendGif?.(url); setEmojiOpen(false); }}
                          onSendSticker={async (url, itemId, packId) => { await onSendSticker?.(url, itemId, packId); setEmojiOpen(false); }}
                          onSendCustomEmoji={(packId, itemId, fileUrl) => {
                            insertCustomEmoji(packId, itemId, fileUrl);
                            setEmojiOpen(false);
                          }}
                          onOpenStudio={() => { setEmojiOpen(false); onOpenStudio?.(); }}
                          theme={document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'}
                        />
                      </Suspense>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── F1: Schedule button — appears when text is ready to send ── */}
          {canSend && !isFileMode && voiceState === 'idle' && videoState === 'idle' && onOpenSchedule && (
            <button
              className="composerScheduleBtn"
              onClick={onOpenSchedule}
              title={t('composer.scheduleSend')}
              tabIndex={-1}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </button>
          )}

          {/* ── F1: Scheduled list button — always shown when there's a handler ── */}
          {!isFileMode && voiceState === 'idle' && videoState === 'idle' && !value.trim() && onOpenScheduledList && (
            <button
              className="composerScheduledListBtn"
              onClick={onOpenScheduledList}
              title={t('composer.scheduledMessages')}
              tabIndex={-1}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </button>
          )}

          {/* Waveform / Video-note icon button */}
          {!isFileMode && (
            <div className="composerMicWrap">
              {/* Mic / camera denied error toast */}
              {micError && (
                <div className="composerMicError">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {t('composer.micDenied')}
                </div>
              )}
              {/* Voice lock track */}
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
                <div className="voiceLockedBadge" onClick={stopRecording} title={t('composer.clickToFinish')}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 1 1 6.2 0v2z"/>
                  </svg>
                </div>
              )}
              {/* Video lock track */}
              {videoState === 'recording' && !videoLocked && (
                <div className="voiceLockTrack">
                  <div className="voiceLockIcon" style={{
                    transform: `translateY(${-(videoLockProgress * 28)}px)`,
                    opacity: 0.45 + videoLockProgress * 0.55,
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
              {videoState === 'recording' && videoLocked && (
                <div className="voiceLockedBadge" onClick={stopVideoRecording} title={t('composer.clickToFinish')}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 1 1 6.2 0v2z"/>
                  </svg>
                </div>
              )}

              {canSend && voiceState === 'idle' && videoState === 'idle' ? (
                /* ── Send button (replaces mic when text is entered) ── */
                <button
                  className="composerMic composerMicSend"
                  onClick={isFileMode ? () => handleSendFiles() : () => { if (value.trim()) onSend(); }}
                  title={t('composer.send')}
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
              ) : (
                /* ── Voice / Video-note button ── */
                <div className="composerMicGroup">
                  <button
                    className={[
                      'composerMic',
                      voiceState === 'recording' ? (locked ? 'composerMicLocked' : 'composerMicActive') : '',
                      videoState === 'recording' ? (videoLocked ? 'composerMicLocked' : 'composerMicActive') : '',
                      recordMode === 'video' && voiceState === 'idle' && videoState === 'idle' ? 'composerMicVideo' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ transform: `scale(${iconScale})` }}
                    onPointerDown={onMicDown}
                    onPointerMove={onMicMove}
                    onPointerUp={onMicUp}
                    onPointerCancel={onMicUp}
                    title={
                      voiceState === 'recording' ? (locked ? t('composer.clickToStop') : t('composer.releaseOrPullUp')) :
                      videoState === 'recording' ? (videoLocked ? t('composer.clickToStop') : t('composer.releaseOrPullUp')) :
                      recordMode === 'video' ? t('composer.holdForVideoNote') :
                      t('composer.holdToRecordHint')
                    }
                  >
                    {(voiceState === 'recording' && locked) || (videoState === 'recording' && videoLocked) ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="4" y="4" width="16" height="16" rx="3"/>
                      </svg>
                    ) : recordMode === 'video' && voiceState === 'idle' && videoState === 'idle' ? (
                      <VideoNoteIcon size={20} />
                    ) : (
                      <WaveformIcon size={20} />
                    )}
                  </button>
                  {/* Mode indicator dot */}
                  {voiceState === 'idle' && videoState === 'idle' && (
                    <span className={`composerMicModeDot${recordMode === 'video' ? ' composerMicModeDotVideo' : ''}`} />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
