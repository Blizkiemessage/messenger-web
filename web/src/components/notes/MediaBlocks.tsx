/**
 * notes/MediaBlocks.tsx — presentational renderers for non-text note blocks:
 *   FileIcon, DeleteBlockBtn, Lightbox, NoteVideoBlock, MediaBlock, UploadBar
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { NoteBlock, VideoBlock_, ImageBlock } from './types';
import { fmtSize, fmtSec, fileColor, fileLabel } from './helpers';

export function FileIcon({ name }: { name: string }) {
  const c = fileColor(name);
  const l = fileLabel(name);
  return (
    <div className="nfIcon" style={{ background: c + '22', borderColor: c + '55' }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
          fill={c + '33'} stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
        <polyline points="14 2 14 8 20 8" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
      <span style={{ color: c, fontSize: l.length > 3 ? 8 : 9 }}>{l}</span>
    </div>
  );
}

export function DeleteBlockBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="noteBlockDel" onClick={onClick} title="Удалить">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="noteLightbox" onClick={e => { e.stopPropagation(); onClose(); }}>
      <button className="noteLightboxClose" onClick={e => { e.stopPropagation(); onClose(); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <img src={src} className="noteLightboxImg" onClick={e => e.stopPropagation()} alt="" draggable={false} />
    </div>,
    document.body,
  );
}

// ─── Inline video player ──────────────────────────────────────────────────────

export function NoteVideoBlock({ block, onDelete, readOnly }: { block: VideoBlock_; onDelete: () => void; readOnly?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dur, setDur] = useState(0);

  function toggle() {
    const v = ref.current; if (!v) return;
    v.paused ? v.play().then(() => setPlaying(true)).catch(() => {}) : (v.pause(), setPlaying(false));
  }
  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const v = ref.current; if (!v || !v.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
  }

  return (
    <div className="noteVideoWrap">
      {!readOnly && <DeleteBlockBtn onClick={onDelete} />}
      <video
        ref={ref} src={block.url} className="noteVideoEl" preload="metadata" playsInline
        onLoadedMetadata={() => setDur(ref.current?.duration ?? 0)}
        onTimeUpdate={() => {
          const v = ref.current;
          if (v?.duration) setProgress((v.currentTime / v.duration) * 100);
        }}
        onEnded={() => setPlaying(false)}
      />
      <div className="noteVideoControls">
        <button className="noteVideoPlayBtn" onClick={toggle}>
          {playing
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          }
        </button>
        <div className="noteVideoSeek" onClick={seek}>
          <div className="noteVideoFill" style={{ width: `${progress}%` }} />
        </div>
        <span className="noteVideoDur">{fmtSec(dur)}</span>
      </div>
      <div className="noteVideoName">{block.name}</div>
    </div>
  );
}

// ─── Media block renderer ─────────────────────────────────────────────────────

export function MediaBlock({ block, onDelete, readOnly }: { block: NoteBlock; onDelete: () => void; readOnly?: boolean }) {
  const [lb, setLb] = useState<string | null>(null);
  if (block.type === 'text') return null;
  if (block.type === 'video') return <NoteVideoBlock block={block} onDelete={onDelete} readOnly={readOnly} />;

  if (block.type === 'sticker') return (
    <div className="noteStickerWrap">
      {!readOnly && <DeleteBlockBtn onClick={onDelete} />}
      <img src={block.url} className="noteStickerImg" alt="sticker" />
    </div>
  );

  if (block.type === 'image' || block.type === 'gif') return (
    <div className="noteImgWrap" onClick={() => setLb(block.url)}>
      {!readOnly && <DeleteBlockBtn onClick={() => { onDelete(); }} />}
      <img
        src={block.url}
        className={`noteBlockImg${block.type === 'gif' ? ' noteBlockGif' : ''}`}
        alt={block.type === 'gif' ? 'GIF' : (block as ImageBlock).name}
      />
      {lb && <Lightbox src={lb} onClose={() => setLb(null)} />}
    </div>
  );

  if (block.type === 'file') return (
    <div className="noteFileWrap">
      {!readOnly && <DeleteBlockBtn onClick={onDelete} />}
      <FileIcon name={block.name} />
      <div className="nfInfo">
        <div className="nfName">{block.name}</div>
        <div className="nfSize">{fmtSize(block.size)}</div>
      </div>
      <a href={block.url} download={block.name} className="nfDown" title="Скачать" onClick={e => e.stopPropagation()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </a>
    </div>
  );
  return null;
}

// ─── Upload progress bar ──────────────────────────────────────────────────────

export function UploadBar({ pct }: { pct: number }) {
  return (
    <div className="noteUploadBar">
      <div className="noteUploadFill" style={{ width: `${Math.max(pct, 2)}%` }} />
      <span className="noteUploadLabel">
        {pct <= 1 ? 'Подготовка…' : `Загрузка ${pct}%`}
      </span>
    </div>
  );
}
