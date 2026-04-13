import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  getMyPacks, createPack, updatePack, deletePack,
  uploadStickerItem, deleteStickerItem, getPackItems, getMyQuota,
  uploadPackLogo,
} from '../../api/sticker-packs';
import { type StickerPack, type StickerPackItem, type UserCreationQuota } from '../../types';
import { useStickerStore } from '../../store/useStickerStore';
import { VideoTrimmerModal, TRIM_MAX_DURATION } from './VideoTrimmerModal';
import { StickerMedia } from '../ui/StickerMedia';
import { PackCover } from '../ui/PackCover';

interface Props {
  onClose: () => void;
}

type StudioTab = 'my-packs' | 'create';
type WizardStep = 1 | 2 | 3;

interface PendingItem {
  file: File;
  preview: string;
  emojiHint: string;
  keywords: string;
  uploading: boolean;
  uploaded?: StickerPackItem;
  error?: string;
}

const MAX_ITEMS = 100;
const MAX_SECONDS = TRIM_MAX_DURATION;

// Accepted formats: all raster, vector, animated and video
const ACCEPT_TYPES = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.apng',
  '.bmp', '.tiff', '.tif', '.avif', '.heic', '.svg',
  '.mp4', '.webm', '.mov', '.avi', '.mpeg',
  'image/*', 'video/*',
].join(',');

function formatQuota(q: UserCreationQuota) {
  return `${q.packs_created} / ${q.free_packs_limit + q.extra_packs}`;
}

/** Get video duration in seconds via a hidden video element */
function getVideoDuration(file: File): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    v.src = url;
  });
}

/** Parse GIF duration from binary (centiseconds → seconds) */
function parseGifDuration(buffer: ArrayBuffer): number {
  const b = new Uint8Array(buffer);
  let totalCs = 0;
  const hasGct = !!(b[10] & 0x80);
  const gctSize = hasGct ? 3 * (1 << ((b[10] & 0x07) + 1)) : 0;
  let i = 13 + gctSize;
  while (i < b.length) {
    const s = b[i];
    if (s === 0x3b || s === undefined) break;
    if (s === 0x21) {
      const label = b[i + 1];
      if (label === 0xf9) {
        totalCs += b[i + 4] | (b[i + 5] << 8);
        i += 8; continue;
      }
      i += 2;
      let sub = b[i++]; while (sub > 0) { i += sub; sub = b[i++]; }
    } else if (s === 0x2c) {
      i += 10;
      const hasLct = !!(b[i - 1] & 0x80);
      if (hasLct) i += 3 * (1 << ((b[i - 1] & 0x07) + 1));
      i++; let sub = b[i++]; while (sub > 0) { i += sub; sub = b[i++]; }
    } else { i++; }
  }
  return totalCs / 100;
}

export function StickerStudioModal({ onClose }: Props) {
  const [tab, setTab] = useState<StudioTab>('my-packs');
  const [myPacks, setMyPacks] = useState<StickerPack[]>([]);
  const [quota, setQuota] = useState<UserCreationQuota | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Wizard state ──────────────────────────────────────────────────────────
  const [step, setStep]           = useState<WizardStep>(1);
  const [packName, setPackName]   = useState('');
  const [packDesc, setPackDesc]   = useState('');
  const [packType, setPackType]   = useState<'sticker' | 'emoji'>('sticker');
  const [isPublic, setIsPublic]   = useState(false);
  const [createdPack, setCreatedPack] = useState<StickerPack | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [coverItemId, setCoverItemId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [creating, setCreating]   = useState(false);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  // ── Edit metadata state ────────────────────────────────────────────────────
  const [editingPack, setEditingPack] = useState<StickerPack | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPublic, setEditPublic] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // ── Edit items state ───────────────────────────────────────────────────────
  const [itemsEditPack, setItemsEditPack] = useState<StickerPack | null>(null);
  const [packItemsList, setPackItemsList]  = useState<StickerPackItem[]>([]);
  const [itemsLoading, setItemsLoading]   = useState(false);
  const [uploadingItems, setUploadingItems] = useState<PendingItem[]>([]);

  // ── Video trimmer state ───────────────────────────────────────────────────
  const [trimFile, setTrimFile] = useState<File | null>(null);
  const [trimTarget, setTrimTarget] = useState<'wizard' | 'edit' | 'logo-wizard' | 'logo-edit' | null>(null);

  // ── Pack logo state ───────────────────────────────────────────────────────
  const logoWizardInputRef  = useRef<HTMLInputElement>(null);
  const logoEditInputRef    = useRef<HTMLInputElement>(null);
  const [wizardLogoFile, setWizardLogoFile]       = useState<File | null>(null);
  const [wizardLogoPreview, setWizardLogoPreview] = useState<string | null>(null);
  const [editLogoUploading, setEditLogoUploading] = useState(false);

  useEffect(() => {
    Promise.all([getMyPacks(), getMyQuota()])
      .then(([packs, q]) => { setMyPacks((packs || []).filter(p => p?.id)); setQuota(q); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  // ── Check file duration, open trimmer if needed ───────────────────────────
  const checkAndQueue = useCallback(async (
    files: File[],
    target: 'wizard' | 'edit',
  ) => {
    for (const file of files) {
      let duration = 0;
      const isVideo = file.type.startsWith('video/');
      const isGif   = file.type === 'image/gif';

      if (isVideo) {
        duration = await getVideoDuration(file);
      } else if (isGif) {
        try {
          const buf = await file.arrayBuffer();
          duration = parseGifDuration(buf);
        } catch { duration = 0; }
      }

      if (duration > MAX_SECONDS) {
        setTrimFile(file);
        setTrimTarget(target);
        return; // open trimmer for the first oversized file
      }

      const preview = URL.createObjectURL(file);
      const item: PendingItem = { file, preview, emojiHint: '', keywords: '', uploading: false };
      if (target === 'wizard') {
        setPendingItems(prev => [...prev, item]);
      } else {
        setUploadingItems(prev => [...prev, item]);
      }
    }
  }, []);

  // ── Logo file handling ────────────────────────────────────────────────────
  const handleLogoFilePick = useCallback(async (
    file: File,
    target: 'logo-wizard' | 'logo-edit',
  ) => {
    let duration = 0;
    if (file.type.startsWith('video/')) {
      duration = await getVideoDuration(file);
    } else if (file.type === 'image/gif') {
      try { const buf = await file.arrayBuffer(); duration = parseGifDuration(buf); } catch {}
    }
    if (duration > MAX_SECONDS) {
      setTrimFile(file);
      setTrimTarget(target);
      return;
    }
    if (target === 'logo-wizard') {
      if (wizardLogoPreview) URL.revokeObjectURL(wizardLogoPreview);
      setWizardLogoFile(file);
      setWizardLogoPreview(URL.createObjectURL(file));
    } else {
      // Edit mode: upload immediately
      if (!editingPack) return;
      setEditLogoUploading(true);
      try {
        const { cover_url } = await uploadPackLogo(editingPack.id, file);
        setMyPacks(prev => prev.map(p => p.id === editingPack.id ? { ...p, cover_url } : p));
        setEditingPack(ep => ep ? { ...ep, cover_url } : ep);
      } catch (e: any) { setError(e.message || 'Ошибка загрузки логотипа'); }
      finally { setEditLogoUploading(false); }
    }
  }, [editingPack, wizardLogoPreview]);

  // ── Wizard: Step 1 — create pack ─────────────────────────────────────────
  async function handleCreatePack() {
    if (!packName.trim()) return;
    setCreating(true);
    setError('');
    try {
      let pack = await createPack({
        name: packName.trim(),
        description: packDesc.trim() || undefined,
        type: packType,
        is_public: isPublic,
      });
      if (!pack?.id) throw new Error('Сервер вернул некорректный ответ. Попробуй ещё раз.');

      // Upload logo if one was chosen in step 1
      if (wizardLogoFile) {
        try {
          const { cover_url } = await uploadPackLogo(pack.id, wizardLogoFile);
          pack = { ...pack, cover_url };
        } catch { /* logo upload failure is non-fatal */ }
      }

      setCreatedPack(pack);
      setMyPacks(p => [pack, ...p.filter(x => x?.id && x.id !== pack.id)]);
      setQuota(q => q ? { ...q, packs_created: q.packs_created + 1 } : q);
      setStep(2);
    } catch (e: any) {
      const msg: string = e?.message || 'Ошибка создания';
      setError(msg === 'quota_exceeded'
        ? 'Достигнут лимит паков. Удали старый или купи дополнительный слот.'
        : msg);
    } finally {
      setCreating(false);
    }
  }

  // ── Wizard: Step 2 — upload stickers ─────────────────────────────────────
  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    checkAndQueue(files, 'wizard');
  }

  async function uploadItem(index: number) {
    if (!createdPack) return;
    const item = pendingItems[index];
    if (item.uploading || item.uploaded) return;
    setPendingItems(prev => prev.map((it, i) => i === index ? { ...it, uploading: true, error: undefined } : it));
    try {
      const uploaded = await uploadStickerItem(createdPack.id, item.file, {
        emoji_hint: item.emojiHint || undefined,
        keywords:   item.keywords  || undefined,
      });
      setPendingItems(prev => prev.map((it, i) => i === index ? { ...it, uploading: false, uploaded } : it));
    } catch (e: any) {
      setPendingItems(prev => prev.map((it, i) => i === index ? { ...it, uploading: false, error: e.message } : it));
    }
  }

  async function uploadAllPending() {
    const indices = pendingItems
      .map((it, i) => (!it.uploading && !it.uploaded ? i : -1))
      .filter(i => i >= 0);
    await Promise.all(indices.map(i => uploadItem(i)));
  }

  function removeItem(index: number) {
    const it = pendingItems[index];
    if (it.uploaded) deleteStickerItem(createdPack!.id, it.uploaded.id).catch(() => {});
    URL.revokeObjectURL(it.preview);
    setPendingItems(prev => prev.filter((_, i) => i !== index));
  }

  async function handleStep2Next() {
    await uploadAllPending();
    setStep(3);
  }

  // ── Wizard: Step 3 — cover + publish ─────────────────────────────────────
  async function handlePublish() {
    if (!createdPack) return;
    setPublishing(true);
    try {
      const updates: Partial<StickerPack> = { is_public: isPublic };
      if (coverItemId) {
        const coverItem = pendingItems.find(it => it.uploaded?.id === coverItemId);
        if (coverItem?.uploaded) updates.cover_url = coverItem.uploaded.thumb_url || coverItem.uploaded.file_url;
      }
      await updatePack(createdPack.id, updates);
      useStickerStore.getState().fetchInstalledPacks();
      const packs = await getMyPacks();
      setMyPacks(packs.filter(p => p?.id));
      setStep(1);
      setPackName(''); setPackDesc(''); setPackType('sticker'); setIsPublic(false);
      setCreatedPack(null); setPendingItems([]); setCoverItemId(null);
      setWizardLogoFile(null);
      if (wizardLogoPreview) { URL.revokeObjectURL(wizardLogoPreview); setWizardLogoPreview(null); }
      setTab('my-packs');
    } catch (e: any) {
      setError(e.message || 'Ошибка публикации');
    } finally {
      setPublishing(false);
    }
  }

  // ── Edit metadata ─────────────────────────────────────────────────────────
  function startEdit(pack: StickerPack) {
    setEditingPack(pack);
    setEditName(pack.name);
    setEditDesc(pack.description || '');
    setEditPublic(pack.is_public);
  }

  async function saveEdit() {
    if (!editingPack) return;
    setEditSaving(true);
    try {
      await updatePack(editingPack.id, {
        name: editName.trim(),
        description: editDesc.trim() || undefined,
        is_public: editPublic,
      });
      setMyPacks(prev => prev.map(p =>
        p.id === editingPack.id
          ? { ...p, name: editName.trim(), description: editDesc.trim() || null, is_public: editPublic }
          : p
      ));
      setEditingPack(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEditSaving(false);
    }
  }

  // ── Edit items ────────────────────────────────────────────────────────────
  async function openItemsEdit(pack: StickerPack) {
    setItemsEditPack(pack);
    setUploadingItems([]);
    setItemsLoading(true);
    try {
      const items = await getPackItems(pack.id);
      setPackItemsList(items);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setItemsLoading(false);
    }
  }

  function handleEditFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const remaining = MAX_ITEMS - packItemsList.length - uploadingItems.length;
    checkAndQueue(files.slice(0, remaining), 'edit');
  }

  async function uploadEditItem(index: number) {
    if (!itemsEditPack) return;
    const item = uploadingItems[index];
    if (item.uploading || item.uploaded) return;
    setUploadingItems(prev => prev.map((it, i) => i === index ? { ...it, uploading: true, error: undefined } : it));
    try {
      const uploaded = await uploadStickerItem(itemsEditPack.id, item.file, {
        emoji_hint: item.emojiHint || undefined,
      });
      setPackItemsList(prev => [...prev, uploaded]);
      setUploadingItems(prev => prev.filter((_, i) => i !== index));
      // Invalidate cache
      useStickerStore.setState(s => {
        const next = { ...s.packItems };
        delete next[itemsEditPack.id];
        return { packItems: next };
      });
      // Update item_count in myPacks
      setMyPacks(prev => prev.map(p =>
        p.id === itemsEditPack.id ? { ...p, item_count: (p.item_count ?? 0) + 1 } : p
      ));
    } catch (e: any) {
      setUploadingItems(prev => prev.map((it, i) => i === index ? { ...it, uploading: false, error: e.message } : it));
    }
  }

  async function removeEditItem(itemId: string) {
    if (!itemsEditPack) return;
    try {
      await deleteStickerItem(itemsEditPack.id, itemId);
      setPackItemsList(prev => prev.filter(it => it.id !== itemId));
      useStickerStore.setState(s => {
        const next = { ...s.packItems };
        delete next[itemsEditPack.id];
        return { packItems: next };
      });
      setMyPacks(prev => prev.map(p =>
        p.id === itemsEditPack.id ? { ...p, item_count: Math.max(0, (p.item_count ?? 1) - 1) } : p
      ));
    } catch (e: any) {
      setError(e.message);
    }
  }

  function removeUploadingItem(index: number) {
    const it = uploadingItems[index];
    if (it.uploaded && itemsEditPack) deleteStickerItem(itemsEditPack.id, it.uploaded.id).catch(() => {});
    URL.revokeObjectURL(it.preview);
    setUploadingItems(prev => prev.filter((_, i) => i !== index));
  }

  // ── Delete pack ───────────────────────────────────────────────────────────
  async function handleDeletePack(pack: StickerPack) {
    if (!confirm(`Удалить пак «${pack.name}»? Это действие нельзя отменить.`)) return;
    try {
      await deletePack(pack.id);
      setMyPacks(prev => prev.filter(p => p.id !== pack.id));
      setQuota(q => q ? { ...q, packs_created: Math.max(0, q.packs_created - 1) } : q);
      useStickerStore.getState().fetchInstalledPacks();
    } catch (e: any) {
      setError(e.message);
    }
  }

  // ── Video trimmer callbacks ───────────────────────────────────────────────
  function handleTrimConfirm(trimmedFile: File) {
    const target = trimTarget;
    setTrimFile(null);
    setTrimTarget(null);

    if (target === 'logo-wizard') {
      if (wizardLogoPreview) URL.revokeObjectURL(wizardLogoPreview);
      setWizardLogoFile(trimmedFile);
      setWizardLogoPreview(URL.createObjectURL(trimmedFile));
      return;
    }
    if (target === 'logo-edit') {
      if (!editingPack) return;
      setEditLogoUploading(true);
      uploadPackLogo(editingPack.id, trimmedFile)
        .then(({ cover_url }) => {
          setMyPacks(prev => prev.map(p => p.id === editingPack.id ? { ...p, cover_url } : p));
          setEditingPack(ep => ep ? { ...ep, cover_url } : ep);
        })
        .catch(e => setError(e.message || 'Ошибка загрузки логотипа'))
        .finally(() => setEditLogoUploading(false));
      return;
    }

    const preview = URL.createObjectURL(trimmedFile);
    const item: PendingItem = { file: trimmedFile, preview, emojiHint: '', keywords: '', uploading: false };
    if (target === 'wizard') {
      setPendingItems(prev => [...prev, item]);
    } else {
      setUploadingItems(prev => [...prev, item]);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const totalInEdit = packItemsList.length + uploadingItems.length;

  return (
    <>
      {createPortal(
        <div className="studioOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="studioModal">
            {/* Header */}
            <div className="studioHeader">
              {itemsEditPack ? (
                <>
                  <button className="studioBackBtn" onClick={() => { setItemsEditPack(null); setUploadingItems([]); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                  </button>
                  <span className="studioTitle">Стикеры: {itemsEditPack.name}</span>
                </>
              ) : (
                <span className="studioTitle">Студия стикеров</span>
              )}
              <button className="studioClose" onClick={onClose} title="Закрыть">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {!itemsEditPack && (
              <div className="studioTabs">
                <button className={`studioTab${tab === 'my-packs' ? ' active' : ''}`} onClick={() => setTab('my-packs')}>Мои паки</button>
                <button className={`studioTab${tab === 'create'   ? ' active' : ''}`} onClick={() => { setTab('create'); setStep(1); }}>Создать пак</button>
              </div>
            )}

            <div className="studioBody">
              {error && <div className="studioError">{error}<button onClick={() => setError('')}>✕</button></div>}

              {/* ── Edit items mode ── */}
              {itemsEditPack && (
                <>
                  <div className="studioItemCountBadge">
                    Стикеров: {totalInEdit} / {MAX_ITEMS}
                  </div>

                  {itemsLoading && <div className="studioLoading"><div className="gifSpinner" /></div>}

                  {!itemsLoading && (
                    <>
                      <input
                        ref={editFileInputRef}
                        type="file"
                        accept={ACCEPT_TYPES}
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleEditFilePick}
                      />

                      {totalInEdit < MAX_ITEMS && (
                        <button className="studioBtnSecondary" style={{ marginBottom: 12 }}
                          onClick={() => editFileInputRef.current?.click()}>
                          + Добавить стикеры
                        </button>
                      )}

                      {/* Uploading queue */}
                      {uploadingItems.length > 0 && (
                        <>
                          <p className="studioHint" style={{ marginBottom: 6 }}>Очередь загрузки:</p>
                          <div className="studioItemGrid" style={{ marginBottom: 12 }}>
                            {uploadingItems.map((item, i) => (
                              <div key={i} className="studioItemCell">
                                <img src={item.preview} alt="preview" />
                                {item.uploading && <div className="studioItemOverlay"><div className="gifSpinner" /></div>}
                                {item.error && <div className="studioItemError" title={item.error}>!</div>}
                                {!item.uploading && !item.uploaded && (
                                  <button className="studioItemUploadBtn" onClick={() => uploadEditItem(i)}>↑</button>
                                )}
                                <button className="studioItemRemove" onClick={() => removeUploadingItem(i)}>✕</button>
                                <input className="studioItemEmoji" placeholder="😀" value={item.emojiHint}
                                  maxLength={2}
                                  onChange={e => setUploadingItems(prev => prev.map((it, j) => j === i ? { ...it, emojiHint: e.target.value } : it))} />
                              </div>
                            ))}
                          </div>
                          <button className="studioBtnPrimary" style={{ marginBottom: 16 }}
                            onClick={() => uploadingItems.forEach((_, i) => uploadEditItem(i))}>
                            Загрузить все
                          </button>
                        </>
                      )}

                      {/* Existing items */}
                      {packItemsList.length === 0 && uploadingItems.length === 0 && (
                        <div className="studioEmpty"><p>Пак пуст. Добавь стикеры.</p></div>
                      )}
                      {packItemsList.length > 0 && (
                        <div className="studioItemGrid">
                          {packItemsList.map(item => (
                            <div key={item.id} className="studioItemCell">
                              <StickerMedia fileUrl={item.file_url} thumbUrl={item.thumb_url} alt={item.emoji_hint || 'sticker'} />
                              <button className="studioItemRemove" onClick={() => removeEditItem(item.id)}>✕</button>
                              {item.emoji_hint && (
                                <span className="studioItemEmojiTag">{item.emoji_hint}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ── My packs tab ── */}
              {!itemsEditPack && tab === 'my-packs' && (
                <>
                  {quota && (
                    <div className="studioQuotaBadge">Паки: {formatQuota(quota)}</div>
                  )}
                  {loading && <div className="studioLoading"><div className="gifSpinner" /></div>}
                  {!loading && myPacks.length === 0 && (
                    <div className="studioEmpty">
                      <p>У тебя пока нет паков.</p>
                      <button className="studioBtnPrimary" onClick={() => setTab('create')}>Создать первый пак</button>
                    </div>
                  )}
                  {myPacks.filter(p => p?.id).map(pack => (
                    <div key={pack.id} className="studioPackRow">
                      <div className="studioPackThumb">
                        <PackCover url={pack.cover_url} name={pack.name} />
                      </div>
                      <div className="studioPackInfo">
                        <div className="studioPackName">{pack.name}</div>
                        <div className="studioPackMeta">
                          {(pack as any).item_count ?? 0} стикеров &bull; {pack.is_public ? 'Публичный' : 'Приватный'}
                        </div>
                      </div>
                      <div className="studioPackActions">
                        {/* Edit items */}
                        <button className="studioIconBtn" onClick={() => openItemsEdit(pack)} title="Редактировать стикеры">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                          </svg>
                        </button>
                        {/* Edit metadata */}
                        <button className="studioIconBtn" onClick={() => startEdit(pack)} title="Настройки пака">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        {/* Delete */}
                        <button className="studioIconBtn studioIconBtnDanger" onClick={() => handleDeletePack(pack)} title="Удалить">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6"/><path d="M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Edit metadata dialog */}
                  {editingPack && (
                    <div className="studioEditDialog">
                      <h4>Настройки пака</h4>

                      {/* Logo upload in edit mode */}
                      <input
                        ref={logoEditInputRef}
                        type="file"
                        accept={ACCEPT_TYPES}
                        style={{ display: 'none' }}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) handleLogoFilePick(f, 'logo-edit');
                        }}
                      />
                      <div className="studioLogoRow">
                        <button
                          className={`studioLogoBtn${editLogoUploading ? ' studioLogoBtnLoading' : ''}`}
                          onClick={() => !editLogoUploading && logoEditInputRef.current?.click()}
                          title="Изменить логотип пака"
                          type="button"
                        >
                          {editLogoUploading
                            ? <div className="gifSpinner" />
                            : <PackCover url={editingPack.cover_url} name={editingPack.name} />
                          }
                          {!editLogoUploading && (
                            <span className="studioLogoBtnOverlay">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                                <circle cx="12" cy="13" r="4"/>
                              </svg>
                            </span>
                          )}
                        </button>
                        <span className="studioLogoHint">Логотип пака<br/><small>фото · гифка · видео до 5 с</small></span>
                      </div>

                      <input className="studioInput" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Название" maxLength={64} />
                      <input className="studioInput" value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Описание (необязательно)" maxLength={256} />
                      <label className="studioToggleRow">
                        <span>Публичный</span>
                        <input type="checkbox" checked={editPublic} onChange={e => setEditPublic(e.target.checked)} />
                      </label>
                      <div className="studioEditActions">
                        <button className="studioBtnSecondary" onClick={() => setEditingPack(null)}>Отмена</button>
                        <button className="studioBtnPrimary" onClick={saveEdit} disabled={editSaving}>
                          {editSaving ? 'Сохранение…' : 'Сохранить'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Create tab (3-step wizard) ── */}
              {!itemsEditPack && tab === 'create' && (
                <>
                  <div className="studioStepBar">
                    {([1,2,3] as WizardStep[]).map(s => (
                      <div key={s} className={`studioStep${step >= s ? ' done' : ''}${step === s ? ' current' : ''}`}>{s}</div>
                    ))}
                  </div>

                  {/* Step 1 */}
                  {step === 1 && (
                    <div className="studioStepBody">
                      <h4>Шаг 1: Основное</h4>

                      {/* Logo upload */}
                      <input
                        ref={logoWizardInputRef}
                        type="file"
                        accept={ACCEPT_TYPES}
                        style={{ display: 'none' }}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) handleLogoFilePick(f, 'logo-wizard');
                        }}
                      />
                      <div className="studioLogoRow">
                        <button
                          className="studioLogoBtn"
                          onClick={() => logoWizardInputRef.current?.click()}
                          title="Загрузить логотип пака"
                          type="button"
                        >
                          {wizardLogoPreview
                            ? <PackCover url={wizardLogoPreview} name={packName || '?'} />
                            : (
                              <span className="studioLogoPlaceholder">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                                  <circle cx="12" cy="13" r="4"/>
                                </svg>
                              </span>
                            )
                          }
                          <span className="studioLogoBtnOverlay">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                              <circle cx="12" cy="13" r="4"/>
                            </svg>
                          </span>
                        </button>
                        <span className="studioLogoHint">Логотип пака<br/><small>фото · гифка · видео до 5 с</small></span>
                      </div>

                      <input className="studioInput" placeholder="Название пака *" value={packName}
                        onChange={e => setPackName(e.target.value)} maxLength={64} />
                      <input className="studioInput" placeholder="Описание (необязательно)" value={packDesc}
                        onChange={e => setPackDesc(e.target.value)} maxLength={256} />
                      <div className="studioRadioRow">
                        <label><input type="radio" name="packType" value="sticker" checked={packType === 'sticker'} onChange={() => setPackType('sticker')} /> Стикеры</label>
                        <label><input type="radio" name="packType" value="emoji"   checked={packType === 'emoji'}   onChange={() => setPackType('emoji')} /> Эмодзи</label>
                      </div>
                      <label className="studioToggleRow">
                        <span>Публичный (виден всем)</span>
                        <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
                      </label>
                      <div className="studioWizardFooter">
                        <button className="studioBtnPrimary" onClick={handleCreatePack} disabled={!packName.trim() || creating}>
                          {creating ? 'Создание…' : 'Далее →'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 2 */}
                  {step === 2 && (
                    <div className="studioStepBody">
                      <h4>Шаг 2: Добавить стикеры</h4>
                      <p className="studioHint">
                        Форматы: PNG, WebP, GIF, APNG, SVG, AVIF, JPEG, BMP, MP4, WebM, MOV и другие.
                        Макс. 50 МБ каждый. GIF/видео &gt; 5с откроют редактор обрезки.
                        Стикеров: {pendingItems.length} / {MAX_ITEMS}
                      </p>

                      <input ref={fileInputRef} type="file" accept={ACCEPT_TYPES}
                        multiple style={{ display: 'none' }} onChange={handleFilePick} />

                      {pendingItems.length < MAX_ITEMS && (
                        <button className="studioBtnSecondary" onClick={() => fileInputRef.current?.click()}>
                          + Добавить файлы
                        </button>
                      )}

                      <div className="studioItemGrid">
                        {pendingItems.map((item, i) => (
                          <div key={i} className="studioItemCell">
                            <img src={item.preview} alt="preview" />
                            {item.uploading && <div className="studioItemOverlay"><div className="gifSpinner" /></div>}
                            {item.error && <div className="studioItemError" title={item.error}>!</div>}
                            {item.uploaded && <div className="studioItemDone">✓</div>}
                            <button className="studioItemRemove" onClick={() => removeItem(i)}>✕</button>
                            <input className="studioItemEmoji" placeholder="😀" value={item.emojiHint}
                              maxLength={2}
                              onChange={e => setPendingItems(prev => prev.map((it, j) => j === i ? { ...it, emojiHint: e.target.value } : it))} />
                          </div>
                        ))}
                      </div>

                      <div className="studioWizardFooter">
                        <button className="studioBtnSecondary" onClick={() => setStep(1)}>← Назад</button>
                        <button className="studioBtnPrimary" onClick={handleStep2Next} disabled={pendingItems.length === 0}>
                          Далее →
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 3 */}
                  {step === 3 && (
                    <div className="studioStepBody">
                      <h4>Шаг 3: Обложка и публикация</h4>
                      <p className="studioHint">Выбери стикер для обложки пака (клик по стикеру):</p>

                      <div className="studioItemGrid">
                        {pendingItems.filter(it => it.uploaded).map(item => (
                          <div key={item.uploaded!.id}
                            className={`studioItemCell studioItemSelectable${coverItemId === item.uploaded!.id ? ' selected' : ''}`}
                            onClick={() => setCoverItemId(item.uploaded!.id)}>
                            <img src={item.preview} alt="sticker" />
                          </div>
                        ))}
                      </div>

                      <label className="studioToggleRow">
                        <span>Публичный</span>
                        <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
                      </label>

                      <div className="studioWizardFooter">
                        <button className="studioBtnSecondary" onClick={() => setStep(2)}>← Назад</button>
                        <button className="studioBtnPrimary" onClick={handlePublish} disabled={publishing}>
                          {publishing ? 'Публикация…' : 'Опубликовать ✓'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Video trimmer */}
      {trimFile && (
        <VideoTrimmerModal
          file={trimFile}
          onConfirm={handleTrimConfirm}
          onCancel={() => { setTrimFile(null); setTrimTarget(null); }}
        />
      )}
    </>
  );
}
