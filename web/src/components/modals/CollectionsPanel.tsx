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
import {
  listCollections, createCollection, renameCollection, deleteCollection,
  getCollectionItems, addUploadedItem, removeCollectionItem,
  type Collection, type CollectionItem,
} from '../../api/collections';
import { uploadFile } from '../../api/upload';
import { useChatsStore } from '../../store/useChatsStore';
import { useSessionStore } from '../../store/useSessionStore';
import type { Chat } from '../../types';

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024)        return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
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
    catch { setError('Не удалось загрузить коллекции'); }
    finally { setLoading(false); }
  }, [chatId]);

  const loadItems = useCallback(async (col: Collection) => {
    setLoading(true); setError(null);
    try { const r = await getCollectionItems(chatId, col.id); setItems(r.items); }
    catch { setError('Не удалось загрузить файлы'); }
    finally { setLoading(false); }
  }, [chatId]);

  useEffect(() => { if (!open) loadList(); }, [open, loadList]);
  useEffect(() => { if (open) loadItems(open); }, [open, loadItems]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const col = await createCollection(chatId, name);
      setCollections(prev => [col, ...prev]);
      setNewName(''); setCreating(false);
    } catch { setError('Не удалось создать коллекцию'); }
  }

  async function handleRename(col: Collection) {
    const name = window.prompt('Новое название коллекции', col.name)?.trim();
    if (!name || name === col.name) return;
    try {
      await renameCollection(chatId, col.id, name);
      setCollections(prev => prev.map(c => c.id === col.id ? { ...c, name } : c));
      if (open?.id === col.id) setOpen({ ...open, name });
    } catch { setError('Не удалось переименовать'); }
  }

  async function handleDelete(col: Collection) {
    if (!window.confirm(`Удалить коллекцию «${col.name}» и все её файлы?`)) return;
    try {
      await deleteCollection(chatId, col.id);
      setCollections(prev => prev.filter(c => c.id !== col.id));
      if (open?.id === col.id) setOpen(null);
    } catch { setError('Не удалось удалить'); }
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
      } catch { setError(`Не удалось загрузить ${file.name}`); }
    }
    setUploadPct(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function handleRemoveItem(item: CollectionItem) {
    if (!open) return;
    if (!window.confirm('Убрать файл из коллекции?')) return;
    try {
      await removeCollectionItem(chatId, open.id, item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch { setError('Не удалось убрать файл'); }
  }

  // ── Детальный вид одной коллекции ─────────────────────────────────────────
  if (open) {
    return (
      <div className="colPanel">
        <div className="colDetailHead">
          <button className="colBack" onClick={() => setOpen(null)} title="Назад">‹ Папки</button>
          <span className="colDetailTitle">{open.name}</span>
          {editable && (
            <button className="colAddBtn" onClick={() => fileInput.current?.click()} disabled={uploadPct !== null}>
              {uploadPct !== null ? `Загрузка… ${uploadPct}%` : '+ Файл'}
            </button>
          )}
          <input ref={fileInput} type="file" multiple hidden onChange={e => handleUpload(e.target.files)} />
        </div>
        {error && <div className="colError">{error}</div>}
        {loading ? (
          <div className="colEmpty">Загрузка…</div>
        ) : items.length === 0 ? (
          <div className="colEmpty">В этой папке пока нет файлов{editable ? ' — нажмите «+ Файл»' : ''}.</div>
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
                    title={item.attachment_name || 'Файл'}>
                    <span className="colFileIcon">📄</span>
                    <span className="colFileName">{item.attachment_name || 'Файл'}</span>
                    {item.attachment_size != null && <span className="colFileSize">{formatFileSize(item.attachment_size)}</span>}
                  </a>
                )}
                {editable && (
                  <button className="colItemRemove" title="Убрать" onClick={() => handleRemoveItem(item)}>×</button>
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
              <input autoFocus className="colCreateInput" placeholder="Название коллекции"
                value={newName} maxLength={80} onChange={e => setNewName(e.target.value)} />
              <button type="submit" className="colAddBtn">Создать</button>
              <button type="button" className="colBack" onClick={() => { setCreating(false); setNewName(''); }}>Отмена</button>
            </form>
          ) : (
            <button className="colAddBtn" onClick={() => setCreating(true)}>+ Новая коллекция</button>
          )}
        </div>
      )}
      {error && <div className="colError">{error}</div>}
      {loading ? (
        <div className="colEmpty">Загрузка…</div>
      ) : collections.length === 0 ? (
        <div className="colEmpty">Коллекций пока нет.{editable ? ' Создайте папку для общих файлов чата — например «Конференция май 2026».' : ''}</div>
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
                <span className="colCardCount">{col.item_count} файл.</span>
              </div>
              {editable && (
                <div className="colCardActions" onClick={e => e.stopPropagation()}>
                  <button title="Переименовать" onClick={() => handleRename(col)}>✎</button>
                  <button title="Удалить" onClick={() => handleDelete(col)}>🗑</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
