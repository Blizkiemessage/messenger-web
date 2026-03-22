/**
 * Composer.tsx
 * ✅ Composer owns upload lifecycle (progress, cancel).
 *    Calls onSendAttachment(result, caption) after upload — ChatArea sends the message.
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

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSendAttachment: (result: UploadResult, caption: string) => Promise<void>;
  externalFile?: File | null;
  onExternalFileConsumed?: () => void;
  disabled?: boolean;
}

export function Composer({ value, onChange, onSend, onSendAttachment, externalFile, onExternalFileConsumed, disabled }: Props) {
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

  const handleSendFile = useCallback(async () => {
    if (!staged || uploading) return;
    setUploading(true); setProgress(0); setUploadErr(null);

    const task = uploadFile(staged, pct => setProgress(pct));
    cancelRef.current = task.cancel;

    try {
      const result = await task.promise;
      await onSendAttachment(result, caption);
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

  const isFileMode = !!staged;
  const canSend    = isFileMode ? !uploading : (!!value.trim() && !disabled);

  return (
    <div className="composerWrap">
      <input ref={fileInputRef} type="file" accept="*/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) stageFile(f); e.target.value = ''; }} />

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

      <div className="composer">
        <button className={`composerAttach${isFileMode ? ' composerAttachActive' : ''}`}
          onClick={() => { if (!uploading) fileInputRef.current?.click(); }}
          title="Прикрепить файл" disabled={uploading}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>

        <input ref={textInputRef} className="composerInput"
          value={isFileMode ? '' : value}
          onChange={e => { if (!isFileMode) onChange(e.target.value); }}
          placeholder={uploading ? `Загрузка… ${progress}%` : isFileMode ? 'Файл готов к отправке' : 'Сообщение…'}
          disabled={isFileMode || disabled}
          onKeyDown={e => { if (!isFileMode && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (value.trim()) onSend(); } }} />

        <button className={`composerSend${uploading ? ' composerSendLoading' : ''}`}
          onClick={isFileMode ? handleSendFile : () => { if (value.trim()) onSend(); }}
          disabled={!canSend}>
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
      </div>
    </div>
  );
}
