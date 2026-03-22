/**
 * MessageBubble.tsx
 * ✅ Fixed: image fallback to file card on error, custom video player with play button.
 */
import { useState } from 'react';
import { type Message, type User } from '../../types';
import { formatTime } from '../../utils/format';
import { Avatar } from '../ui/Avatar';
import { MsgStatus } from '../ui/icons/MsgStatus';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024)               return `${bytes} B`;
  if (bytes < 1024 * 1024)        return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

// ── File icon (reused by bubbles and fallback) ────────────────────────────────
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

// ── Download helper ───────────────────────────────────────────────────────────
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

// ── File card (used for real files AND as image error fallback) ───────────────
function FileCard({
  url, name, size, isOwn, caption,
}: { url: string; name: string; size?: number | null; isOwn: boolean; caption?: string }) {
  const sizeStr = size ? formatFileSize(size) : '';
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
          {sizeStr && <div className="bubbleFileSize">{sizeStr}</div>}
        </div>
        <div className="bubbleFileDownloadBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

  // If image fails to load → fall back to a file card so the user can still download
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
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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

// ── Video attachment — custom play button, native controls on demand ──────────
function VideoAttachment({
  url, caption,
}: { url: string; caption?: string }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="bubbleAttachVideo">
        <video
          src={url}
          controls
          autoPlay
          className="bubbleVideo"
          preload="metadata"
        />
        {caption && <div className="bubbleCaption">{caption}</div>}
      </div>
    );
  }

  // Show poster with big play button until user clicks
  return (
    <div className="bubbleAttachVideo">
      <div className="bubbleVideoPoster" onClick={() => setPlaying(true)}>
        <video
          src={url}
          className="bubbleVideo bubbleVideoPosterVideo"
          preload="metadata"
          muted
        />
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

// ── Search highlight ──────────────────────────────────────────────────────────
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
}

// ── Component ─────────────────────────────────────────────────────────────────
export function MessageBubble({
  message: m, isOwn, isRead, isSelected, isGroup, sender,
  showAvatar, showName, hasSelection, highlight, isSearchMatch,
  onContextMenu, onClick, onViewUser,
}: Props) {
  const hasAttachment = !!m.attachment_url;
  const isImage = m.attachment_type === 'image';
  const isVideo = m.attachment_type === 'video';
  const isFile  = hasAttachment && !isImage && !isVideo;

  // When there's an attachment, text becomes caption; otherwise it's the main content
  const caption  = hasAttachment && m.text ? m.text : undefined;
  const pureText = hasAttachment ? null : m.text;

  return (
    <div
      className={[
        'msg', isOwn ? 'out' : 'in',
        isSelected ? 'selected' : '',
        isGroup && !isOwn ? 'inGroup' : '',
        isSearchMatch ? 'msgSearchFocus' : '',
      ].filter(Boolean).join(' ')}
      onContextMenu={e => { if (!isOwn) return; e.preventDefault(); onContextMenu(); }}
      onClick={e => { if (!isOwn || !hasSelection) return; e.stopPropagation(); onClick(e); }}
    >
      {isGroup && !isOwn && (
        <div className="msgAvatarSlot">
          {showAvatar ? (
            <button className="msgSenderAvatarBtn" onClick={e => { e.stopPropagation(); onViewUser(m.sender_id); }}>
              <Avatar user={sender} size={32} radius={10} />
            </button>
          ) : (
            <div style={{ width: 32 }} />
          )}
        </div>
      )}

      <div className={`bubble${hasAttachment ? ' bubbleWithAttach' : ''}`}>
        {isSelected && (
          <div className="msgCheckmark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </div>
        )}

        {showName && (
          <button className="bubbleSenderName" onClick={e => { e.stopPropagation(); onViewUser(m.sender_id); }}>
            {sender?.display_name || sender?.username || 'Пользователь'}
          </button>
        )}

        {/* Attachments */}
        {isImage && (
          <ImageAttachment
            url={m.attachment_url!}
            name={m.attachment_name || 'image'}
            size={m.attachment_size}
            caption={caption}
            isOwn={isOwn}
          />
        )}
        {isVideo && (
          <VideoAttachment url={m.attachment_url!} caption={caption} />
        )}
        {isFile && (
          <FileCard
            url={m.attachment_url!}
            name={m.attachment_name || 'file'}
            size={m.attachment_size}
            isOwn={isOwn}
            caption={caption}
          />
        )}

        {/* Plain text (no attachment) */}
        {pureText && (
          <div className="bubbleText">
            <HighlightText text={pureText} term={highlight || ''} />
          </div>
        )}

        <div className="bubbleMeta">
          <span className="bubbleTime">{formatTime(m.created_at)}</span>
          {isOwn && <MsgStatus isRead={isRead} />}
        </div>
      </div>
    </div>
  );
}
