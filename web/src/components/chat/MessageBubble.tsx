/**
 * MessageBubble.tsx
 * ✅ FIXED: resolveUrl applied to attachment URLs so /uploads/ paths resolve
 *           to the backend (Railway) instead of the frontend (Vercel).
 */
import { useState, useRef, useEffect } from 'react';
import { type Message, type User } from '../../types';
import { formatTime } from '../../utils/format';
import { Avatar, resolveUrl } from '../ui/Avatar';
import { MsgStatus } from '../ui/icons/MsgStatus';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024)                return `${bytes} B`;
  if (bytes < 1024 * 1024)         return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface FileCategory { color: string; bgColor: string; label: string }

function getFileCategory(name: string): FileCategory {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','heic','bmp','tiff'].includes(ext))
    return { color: '#9b59b6', bgColor: '#9b59b622', label: ext.toUpperCase() };
  if (ext === 'pdf')
    return { color: '#e74c3c', bgColor: '#e74c3c22', label: 'PDF' };
  if (['doc','docx','odt'].includes(ext))
    return { color: '#2980b9', bgColor: '#2980b922', label: 'DOC' };
  if (['xls','xlsx','ods','csv'].includes(ext))
    return { color: '#27ae60', bgColor: '#27ae6022', label: 'XLS' };
  if (['ppt','pptx','odp'].includes(ext))
    return { color: '#e67e22', bgColor: '#e67e2222', label: 'PPT' };
  if (['txt','md','markdown','rtf'].includes(ext))
    return { color: '#7f8c8d', bgColor: '#7f8c8d22', label: 'TXT' };
  if (['js','ts','jsx','tsx','py','java','c','cpp','cs','go','rb','php',
       'html','css','json','xml','yaml','yml','sh','sql','swift','kt','rs'].includes(ext))
    return { color: '#16a085', bgColor: '#16a08522', label: ext.toUpperCase() };
  if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext))
    return { color: '#f39c12', bgColor: '#f39c1222', label: 'ZIP' };
  if (['mp3','wav','aac','flac','ogg','m4a','wma'].includes(ext))
    return { color: '#e91e63', bgColor: '#e91e6322', label: 'AUD' };
  if (['mp4','avi','mov','mkv','wmv','webm','flv','m4v'].includes(ext))
    return { color: '#c0392b', bgColor: '#c0392b22', label: 'VID' };
  return { color: '#95a5a6', bgColor: '#95a5a622', label: ext.toUpperCase() || 'FILE' };
}

function BubbleFileIcon({ name }: { name: string }) {
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

function downloadFile(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── File card ─────────────────────────────────────────────────────────────────
function FileCard({
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
function ImageAttachment({
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

// ── Video attachment ─────────────────────────────────────────────────────────
// ✅ FIXED: poster is a plain dark div (no nested <video> to avoid double load)
function VideoAttachment({
  url, caption, name,
}: { url: string; caption?: string; name?: string }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="bubbleAttachVideo">
        <video
          src={url}
          controls
          autoPlay
          className="bubbleVideo"
          preload="auto"
          playsInline
        />
        {caption && <div className="bubbleCaption">{caption}</div>}
      </div>
    );
  }

  return (
    <div className="bubbleAttachVideo">
      <div className="bubbleVideoPoster" onClick={() => setPlaying(true)}>
        {/* Plain dark background — no nested <video> that triggers a second request */}
        <div className="bubbleVideoPosterBg">
          {name && <span className="bubbleVideoPosterName">{name}</span>}
        </div>
        <div className="bubbleVideoPlayBtn">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>
      {caption && <div className="bubbleCaption">{caption}</div>}
    </div>
  );
}

// ── Highlight ─────────────────────────────────────────────────────────────────
function HighlightText({ text, term }: { text: string; term: string }) {
  if (!term || !text) return <>{text}</>;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase()
          ? <mark key={i} className="msgHighlight">{part}</mark>
          : part
      )}
    </>
  );
}

// ── Audio player for voice messages ──────────────────────────────────────────
function AudioPlayer({
  url, isOwn, isRead, sendTime,
}: { url: string; isOwn: boolean; isRead: boolean; sendTime: number }) {
  const audioRef    = useRef<HTMLAudioElement>(null);
  const trackRef    = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const [playing,  setPlaying]  = useState(false);
  const [current,  setCurrent]  = useState(0);
  const [duration, setDuration] = useState(0);

  // Decode duration via Web Audio for accuracy (HTMLAudio can return Infinity for webm)
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    (async () => {
      try {
        const res  = await fetch(url);
        const buf  = await res.arrayBuffer();
        const actx = new AudioContext();
        const dec  = await actx.decodeAudioData(buf);
        actx.close();
        if (!cancelled && dec.duration > 0) setDuration(dec.duration);
      } catch { /* fallback to onLoadedMetadata */ }
    })();
    return () => { cancelled = true; };
  }, [url]);

  const handleMeta = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const d = e.currentTarget.duration;
    if (isFinite(d) && d > 0) setDuration(prev => prev > 0 ? prev : d);
  };

  const fmtT = (s: number) => {
    if (!isFinite(s) || isNaN(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => {}); setPlaying(true); }
  };

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

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
        ref={audioRef} src={url} preload="auto"
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={handleMeta}
        onDurationChange={handleMeta}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
      />

      {/* Play / Pause button */}
      <button className="voiceMsgPlay" onClick={toggle} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>
        {playing ? (
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
        {/* Progress track with draggable thumb */}
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
          <div className="voiceMsgTrackBg">
            <div className="voiceMsgTrackFill" style={{ width: `${progress * 100}%` }} />
            <div className="voiceMsgTrackThumb" style={{ left: `${progress * 100}%` }} />
          </div>
        </div>

        {/* Bottom row: time left, send-time + status right */}
        <div className="voiceMsgMeta">
          <span className="voiceMsgTime">{timeLabel}</span>
          <div className="voiceMsgSendMeta">
            <span className="voiceMsgSendTime">{formatTime(sendTime)}</span>
            {isOwn && <MsgStatus isRead={isRead} />}
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  message: Message;
  isOwn: boolean;
  isRead: boolean;
  isSelected: boolean;
  isGroup: boolean;
  sender?: User;
  showAvatar: boolean;
  showName: boolean;
  hasSelection: boolean;
  highlight?: string;
  isSearchMatch?: boolean;
  onContextMenu: () => void;
  onClick: (e: React.MouseEvent) => void;
  onViewUser: (id: string) => void;
  onForwardedSenderClick?: (userId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function MessageBubble({
  message: m, isOwn, isRead, isSelected, isGroup, sender,
  showAvatar, showName, hasSelection, highlight, isSearchMatch,
  onContextMenu, onClick, onViewUser, onForwardedSenderClick,
}: Props) {
  const hasAttachment = !!m.attachment_url;
  const isImage = m.attachment_type === 'image';
  const isVideo = m.attachment_type === 'video';
  const isAudio = m.attachment_type === 'audio';
  const isFile  = hasAttachment && !isImage && !isVideo && !isAudio;

  // ✅ KEY FIX: resolve /uploads/... URLs to absolute backend URLs.
  // Without this, Vercel's SPA rewrite catches the relative path and serves index.html.
  const attachmentUrl = resolveUrl(m.attachment_url) ?? m.attachment_url ?? '';

  const caption  = hasAttachment && m.text ? m.text : undefined;
  const pureText = hasAttachment ? null : m.text;

  return (
    <div
      className={[
        'msg', isOwn ? 'out' : 'in',
        isSelected    ? 'selected'    : '',
        isGroup && !isOwn ? 'inGroup' : '',
        isSearchMatch ? 'msgSearchFocus' : '',
      ].filter(Boolean).join(' ')}
      onContextMenu={e => { if (m.is_system) return; e.preventDefault(); onContextMenu(); }}
      onClick={e => { if (!hasSelection) return; e.stopPropagation(); onClick(e); }}
    >
      {isGroup && !isOwn && (
        <div className="msgAvatarSlot">
          {showAvatar ? (
            <button className="msgSenderAvatarBtn"
                    onClick={e => { e.stopPropagation(); onViewUser(m.sender_id); }}>
              <Avatar user={sender} size={32} radius={10} />
            </button>
          ) : (
            <div style={{ width: 32 }} />
          )}
        </div>
      )}

      <div className={`bubble${hasAttachment ? ' bubbleWithAttach' : ''}`}>
        {/* ✅ Pin indicator — thumbtack icon */}
        {m.is_pinned && !isSelected && (
          <div className="msgPinBadge" title="Закреплённое сообщение">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M16 3a1 1 0 0 0-1 1v1H9V4a1 1 0 0 0-2 0v1a3 3 0 0 0-3 3v1l2 2v4H4a1 1 0 0 0 0 2h7v3a1 1 0 0 0 2 0v-3h7a1 1 0 0 0 0-2h-2v-4l2-2V8a3 3 0 0 0-3-3V4a1 1 0 0 0-1-1z"/>
            </svg>
          </div>
        )}
        {isSelected && (
          <div className="msgCheckmark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </div>
        )}

        {showName && (
          <button className="bubbleSenderName"
                  onClick={e => { e.stopPropagation(); onViewUser(m.sender_id); }}>
            {sender?.display_name || sender?.username || 'Пользователь'}
          </button>
        )}

        {/* ✅ Forwarded-from badge */}
        {m.forwarded_from_user_id && (
          <div className="bubbleForwardedBadge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 17 20 12 15 7"/>
              <path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
            </svg>
            <span>Переслано от </span>
            <button
              className="bubbleForwardedName"
              onClick={e => {
                e.stopPropagation();
                if (onForwardedSenderClick && m.forwarded_from_user_id) {
                  onForwardedSenderClick(m.forwarded_from_user_id);
                }
              }}
            >
              {m.forwarded_from_username || 'Пользователь'}
            </button>
          </div>
        )}

        {/* ── Attachments (all use resolved URL) ── */}
        {isAudio && (
          <AudioPlayer url={attachmentUrl} isOwn={isOwn} isRead={isRead} sendTime={m.created_at} />
        )}
        {isImage && (
          <ImageAttachment
            url={attachmentUrl}
            name={m.attachment_name || 'image'}
            size={m.attachment_size}
            caption={caption}
            isOwn={isOwn}
          />
        )}
        {isVideo && (
          <VideoAttachment
            url={attachmentUrl}
            caption={caption}
            name={m.attachment_name || undefined}
          />
        )}
        {isFile && (
          <FileCard
            url={attachmentUrl}
            name={m.attachment_name || 'file'}
            size={m.attachment_size}
            isOwn={isOwn}
            caption={caption}
          />
        )}

        {/* Plain text */}
        {pureText && (
          <div className="bubbleText">
            <HighlightText text={pureText} term={highlight || ''} />
          </div>
        )}

        {!isAudio && (
          <div className="bubbleMeta">
            <span className="bubbleTime">{formatTime(m.created_at)}</span>
            {isOwn && <MsgStatus isRead={isRead} />}
          </div>
        )}
      </div>
    </div>
  );
}
