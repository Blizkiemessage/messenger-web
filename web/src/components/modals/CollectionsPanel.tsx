/**
 * CollectionsPanel — содержимое вкладки «Коллекции» в галерее чата.
 *
 * Общие на чат «папки файлов»: список папок → детальный вид (сетка файлов).
 * Загрузка файлов НАПРЯМУЮ в папку (collection-only — в ленту не попадают).
 * Управление (создать/переименовать/удалить/загрузить/убрать) — ЛС оба;
 * группа — admin или модератор с edit_info (зеркалит фон чата). Чтение — все.
 *
 * Рендерится внутри ChatMediaModal; lightbox для картинок переиспользуется
 * через onImageClick.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listCollections, createCollection, renameCollection, deleteCollection,
  getCollectionItems, addUploadedItem, removeCollectionItem,
  type Collection, type CollectionItem,
} from '../../api/collections';
import { uploadFile } from '../../api/upload';
import { useChatsStore } from '../../store/useChatsStore';
import { useSessionStore } from '../../store/useSessionStore';
import type { Chat } from '../../types';

function formatFileSize(bytes: number | null | undefined, t: (k: string, o?: any) => string): string {
  if (!bytes) return '';
  if (bytes < 1024)        return t('collections.sizeBytes', { count: bytes });
  if (bytes < 1024 * 1024) return t('collections.sizeKB', { count: (bytes / 1024).toFixed(1) });
  return t('collections.sizeMB', { count: (bytes / (1024 * 1024)).toFixed(1) });
}

/** Может ли пользователь управлять коллекциями (как общий фон чата). */
function canManage(chat: Chat | undefined, meId: string | undefined): boolean {
  if (!chat || !meId) return false;
  if (chat.type === 'direct') return true;
  const me = chat.members.find(m => m.id === meId);
  if (!me) return false;
  if (me.role === 'admin') return true;
  if (me.role === 'moderator') return !!me.permissions?.edit_info;
  return false;
}

const IMAGE_TYPES = new Set(['image', 'gif_custom', 'gif_tenor']);
const isImage = (t: string | null) => !!t && IMAGE_TYPES.has(t);
const isVideo = (t: string | null) => t === 'video' || t === 'video_note';

interface Props {
  chatId: string;
  onImageClick: (url: string) => void;
}

export function CollectionsPanel({ chatId, onImageClick }: Props) {
  const { t } = useTranslation('modals');
  const chat = useChatsStore(s => s.chats.find(c => c.id === chatId));
  const meId = useSessionStore(s => s.me?.id);
  const editable = canManage(chat, meId);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [open, setOpen]   = useState<Collection | null>(null); // null = list view
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setLoading(true); setError(null);
    try { setCollections(await listCollections(chatId)); }
    catch { setError(t('addToCollection.loadError')); }
    finally { setLoading(false); }
  }, [chatId, t]);

  const loadItems = useCallback(async (col: Collection) => {
    setLoading(true); setError(null);
    try { const r = await getCollectionItems(chatId, col.id); setItems(r.items); }
    catch { setError(t('collections.loadItemsError')); }
    finally { setLoading(false); }
  }, [chatId, t]);

  useEffect(() => { if (!open) loadList(); }, [open, loadList]);
  useEffect(() => { if (open) loadItems(open); }, [open, loadItems]);

  // Realtime: применяем изменения от других участников (и свои — идемпотентно,
  // т.к. сервер шлёт событие всем в чате, включая автора). Источник — window-
  // событие 'blz:collection' из useSocket.
  useEffect(() => {
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        type: string; chatId: string; collectionId?: string; name?: string;
        item?: CollectionItem; itemId?: string;
      };
      if (!d || d.chatId !== chatId) return;
      if (open) {
        if (d.type === 'deleted' && d.collectionId === open.id) { setOpen(null); return; }
        if (d.type === 'updated' && d.collectionId === open.id) { setOpen(o => o ? { ...o, name: d.name! } : o); return; }
        if (d.collectionId === open.id) {
          if (d.type === 'item-added' && d.item) setItems(prev => prev.some(i => i.id === d.item!.id) ? prev : [d.item!, ...prev]);
          if (d.type === 'item-removed' && d.itemId) setItems(prev => prev.filter(i => i.id !== d.itemId));
        }
      } else {
        loadList(); // в списке — перечитать (счётчики/обложки)
      }
    };
    window.addEventListener('blz:collection', onEvent);
    return () => window.removeEventListener('blz:collection', onEvent);
  }, [chatId, open, loadList]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const col = await createCollection(chatId, name);
      setCollections(prev => [col, ...prev]);
      setNewName(''); setCreating(false);
    } catch { setError(t('addToCollection.createError')); }
  }

  async function handleRename(col: Collection) {
    const name = window.prompt(t('collections.renamePrompt'), col.name)?.trim();
    if (!name || name === col.name) return;
    try {
      await renameCollection(chatId, col.id, name);
      setCollections(prev => prev.map(c => c.id === col.id ? { ...c, name } : c));
      if (open?.id === col.id) setOpen({ ...open, name });
    } catch { setError(t('collections.renameError')); }
  }

  async function handleDelete(col: Collection) {
    if (!window.confirm(t('collections.deleteConfirm', { name: col.name }))) return;
    try {
      await deleteCollection(chatId, col.id);
      setCollections(prev => prev.filter(c => c.id !== col.id));
      if (open?.id === col.id) setOpen(null);
    } catch { setError(t('collections.deleteError')); }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length || !open) return;
    setError(null);
    for (const file of Array.from(files)) {
      try {
        setUploadPct(0);
        const task = uploadFile(file, pct => setUploadPct(pct));
        const res = await task.promise;
        const item = await addUploadedItem(chatId, open.id, {
          attachment_url: res.url, attachment_type: res.type,
          attachment_name: res.name, attachment_size: res.size,
        });
        setItems(prev => [item, ...prev]);
      } catch { setError(t('collections.uploadError', { name: file.name })); }
    }
    setUploadPct(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function handleRemoveItem(item: CollectionItem) {
    if (!open) return;
    if (!window.confirm(t('collections.removeItemConfirm'))) return;
    try {
      await removeCollectionItem(chatId, open.id, item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch { setError(t('collections.removeItemError')); }
  }

  // ── Детальный вид одной коллекции ─────────────────────────────────────────
  if (open) {
    return (
      <div className="colPanel">
        <div className="colDetailHead">
          <button className="colBack" onClick={() => setOpen(null)} title={t('common:back')}>‹ {t('confirm.folders')}</button>
          <span className="colDetailTitle">{open.name}</span>
          {editable && (
            <button className="colAddBtn" onClick={() => fileInput.current?.click()} disabled={uploadPct !== null}>
              {uploadPct !== null ? t('collections.uploadingPercent', { pct: uploadPct }) : t('collections.addFile')}
            </button>
          )}
          <input ref={fileInput} type="file" multiple hidden onChange={e => handleUpload(e.target.files)} />
        </div>
        {error && <div className="colError">{error}</div>}
        {loading ? (
          <div className="colEmpty">{t('common:loading')}</div>
        ) : items.length === 0 ? (
          <div className="colEmpty">{editable ? t('collections.emptyFolderEditable') : t('collections.emptyFolderPlain')}</div>
        ) : (
          <div className="colItemGrid">
            {items.map(item => (
              <div key={item.id} className="colItem">
                {isImage(item.attachment_type) ? (
                  <img className="colThumb" src={item.attachment_url} alt={item.attachment_name || ''}
                    loading="lazy" onClick={() => onImageClick(item.attachment_url)} />
                ) : isVideo(item.attachment_type) ? (
                  <a className="colThumb colVideoThumb" href={item.attachment_url} target="_blank" rel="noopener noreferrer">
                    <video src={item.attachment_url} preload="metadata" muted />
                    <span className="colPlay">▶</span>
                  </a>
                ) : (
                  <a className="colFileCard" href={item.attachment_url} target="_blank" rel="noopener noreferrer"
                    title={item.attachment_name || t('collections.file')}>
                    <span className="colFileIcon">📄</span>
                    <span className="colFileName">{item.attachment_name || t('collections.file')}</span>
                    {item.attachment_size != null && <span className="colFileSize">{formatFileSize(item.attachment_size, t)}</span>}
                  </a>
                )}
                {editable && (
                  <button className="colItemRemove" title={t('collections.removeItem')} onClick={() => handleRemoveItem(item)}>×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Список папок ───────────────────────────────────────────────────────────
  return (
    <div className="colPanel">
      {editable && (
        <div className="colListHead">
          {creating ? (
            <form className="colCreateRow" onSubmit={e => { e.preventDefault(); handleCreate(); }}>
              <input autoFocus className="colCreateInput" placeholder={t('collections.createPlaceholder')}
                value={newName} maxLength={80} onChange={e => setNewName(e.target.value)} />
              <button type="submit" className="colAddBtn">{t('common:create')}</button>
              <button type="button" className="colBack" onClick={() => { setCreating(false); setNewName(''); }}>{t('common:cancel')}</button>
            </form>
          ) : (
            <button className="colAddBtn" onClick={() => setCreating(true)}>+ {t('addToCollection.newCollection')}</button>
          )}
        </div>
      )}
      {error && <div className="colError">{error}</div>}
      {loading ? (
        <div className="colEmpty">{t('common:loading')}</div>
      ) : collections.length === 0 ? (
        <div className="colEmpty">{t('collections.noCollectionsPlain')}{editable ? ` ${t('collections.noCollectionsHint')}` : ''}</div>
      ) : (
        <div className="colGrid">
          {collections.map(col => (
            <div key={col.id} className="colCard" onClick={() => setOpen(col)}>
              <div className="colCover">
                {col.cover_url
                  ? <img src={col.cover_url} alt="" loading="lazy" />
                  : <span className="colCoverIcon">🗂️</span>}
              </div>
              <div className="colCardBody">
                <span className="colCardName" title={col.name}>{col.name}</span>
                <span className="colCardCount">{t('collections.fileCount', { count: col.item_count })}</span>
              </div>
              {editable && (
                <div className="colCardActions" onClick={e => e.stopPropagation()}>
                  <button title={t('common:rename')} onClick={() => handleRename(col)}>✎</button>
                  <button title={t('common:delete')} onClick={() => handleDelete(col)}>🗑</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
