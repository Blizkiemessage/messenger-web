import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import {
  getMyPacks, createPack, updatePack, deletePack,
  uploadStickerItem, deleteStickerItem, updateStickerItem, getPackItems, getMyQuota,
  uploadPackLogo,
} from '../../api/sticker-packs';
import { type StickerPack, type StickerPackItem, type UserCreationQuota } from '../../types';
import { useStickerStore } from '../../store/useStickerStore';
import { useAppStore } from '../../store/useAppStore';
import { VideoTrimmerModal } from './VideoTrimmerModal';
import { StickerMedia } from '../ui/StickerMedia';
import { PackCover } from '../ui/PackCover';
import { type StudioTab, type WizardStep, type PendingItem } from './stickerStudio/types';
import {
  MAX_ITEMS, MAX_SECONDS, ACCEPT_TYPES,
  formatQuota, getVideoDuration, parseGifDuration,
} from './stickerStudio/helpers';

interface Props {
  onClose: () => void;
}

export function StickerStudioModal({ onClose }: Props) {
  const { t, i18n } = useTranslation('modals');
  const theme = useAppStore(s => s.theme);
  const [tab, setTab] = useState<StudioTab>('my-packs');
  // Sub-filter inside "Мои паки": show sticker packs or emoji packs
  const [myPacksFilter, setMyPacksFilter] = useState<'sticker' | 'emoji'>('sticker');
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

  // ── Emoji hint picker state ────────────────────────────────────────────────
  const [emojiPickerItemId, setEmojiPickerItemId] = useState<string | null>(null);
  const [savingEmojiItemId, setSavingEmojiItemId] = useState<string | null>(null);

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
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (emojiPickerItemId) { setEmojiPickerItemId(null); return; }
        onClose();
      }
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose, emojiPickerItemId]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!emojiPickerItemId) return;
    const handle = (e: MouseEvent) => {
      const portal = document.querySelector('.studioItemEmojiPickerPortal');
      if (portal && !portal.contains(e.target as Node)) setEmojiPickerItemId(null);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handle), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handle); };
  }, [emojiPickerItemId]);

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
      } catch (e: any) { setError(e.message || t('stickerStudio.logoUploadError')); }
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
      if (!pack?.id) throw new Error(t('stickerStudio.invalidResponse'));

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
      const msg: string = e?.message || t('stickerStudio.createError');
      setError(msg === 'quota_exceeded'
        ? t('stickerStudio.quotaExceeded')
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
      setError(e.message || t('stickerStudio.publishError'));
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

  // ── Update emoji hint for existing item ───────────────────────────────────
  async function handleSetItemEmojiHint(itemId: string, hint: string) {
    if (!itemsEditPack) return;
    setSavingEmojiItemId(itemId);
    try {
      await updateStickerItem(itemsEditPack.id, itemId, { emoji_hint: hint || null });
      setPackItemsList(prev => prev.map(it => it.id === itemId ? { ...it, emoji_hint: hint || null } : it));
      // Invalidate store cache so sidebar/notifications pick up the new hint
      useStickerStore.setState(s => {
        const next = { ...s.packItems };
        delete next[itemsEditPack.id];
        return { packItems: next };
      });
    } catch (e: any) {
      setError(e.message || t('stickerStudio.emojiSaveError'));
    } finally {
      setSavingEmojiItemId(null);
      setEmojiPickerItemId(null);
    }
  }

  // ── Delete pack ───────────────────────────────────────────────────────────
  async function handleDeletePack(pack: StickerPack) {
    if (!confirm(t('stickerStudio.deletePackConfirm', { name: pack.name }))) return;
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
        .catch(e => setError(e.message || t('stickerStudio.logoUploadError')))
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
                  <span className="studioTitle">{itemsEditPack.type === 'emoji' ? t('stickerStudio.unitEmoji') : t('stickerStudio.tabStickers')}: {itemsEditPack.name}</span>
                </>
              ) : (
                <span className="studioTitle">{t('stickerStudio.studioTitle')}</span>
              )}
              <button className="studioClose" onClick={onClose} title={t('common:close')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {!itemsEditPack && (
              <div className="studioTabs">
                <button className={`studioTab${tab === 'my-packs' ? ' active' : ''}`} onClick={() => setTab('my-packs')}>{t('stickerStudio.tabMyPacks')}</button>
                <button className={`studioTab${tab === 'create'   ? ' active' : ''}`} onClick={() => { setTab('create'); setStep(1); }}>{t('stickerStudio.tabCreatePack')}</button>
              </div>
            )}

            <div className="studioBody">
              {error && <div className="studioError">{error}<button onClick={() => setError('')}>✕</button></div>}

              {/* ── Edit items mode ── */}
              {itemsEditPack && (
                <>
                  <div className="studioItemsToolbar">
                    <div className="studioItemsCounter">
                      <span className="studioItemsCount">{totalInEdit}</span>
                      <span className="studioItemsMax">/ {MAX_ITEMS}</span>
                      <span className="studioItemsLabel">{itemsEditPack.type === 'emoji' ? t('stickerStudio.unitEmoji') : t('stickerStudio.unitStickersGenitive')}</span>
                    </div>

                    <input
                      ref={editFileInputRef}
                      type="file"
                      accept={ACCEPT_TYPES}
                      multiple
                      style={{ display: 'none' }}
                      onChange={handleEditFilePick}
                    />
                    {totalInEdit < MAX_ITEMS && (
                      <button className="studioAddItemsBtn" onClick={() => editFileInputRef.current?.click()}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        {t('stickerStudio.add')}
                      </button>
                    )}
                  </div>

                  {itemsLoading && <div className="studioLoading"><div className="gifSpinner" /></div>}

                  {!itemsLoading && (
                    <>

                      {/* Uploading queue */}
                      {uploadingItems.length > 0 && (
                        <>
                          <p className="studioHint" style={{ marginBottom: 6 }}>{t('stickerStudio.uploadQueueLabel')}</p>
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
                            {t('stickerStudio.uploadAll')}
                          </button>
                        </>
                      )}

                      {/* Existing items */}
                      {packItemsList.length === 0 && uploadingItems.length === 0 && (
                        <div className="studioEmpty"><p>{t('stickerStudio.packEmpty', { type: itemsEditPack.type === 'emoji' ? t('stickerStudio.unitEmoji') : t('stickerStudio.unitStickersPlain') })}</p></div>
                      )}
                      {packItemsList.length > 0 && (
                        <div className="studioItemGrid studioItemGridSm">
                          {packItemsList.map(item => (
                            <div key={item.id} className={`studioItemCell${emojiPickerItemId === item.id ? ' studioItemCellPickerOpen' : ''}`}>
                              <StickerMedia fileUrl={item.file_url} thumbUrl={item.thumb_url} alt={item.emoji_hint || t('stickerStudio.stickerAltFallback')} />
                              <button className="studioItemRemove" onClick={() => removeEditItem(item.id)}>✕</button>

                              {/* Emoji hint picker button */}
                              <button
                                className={`studioItemEmojiBtn${emojiPickerItemId === item.id ? ' open' : ''}`}
                                title={t('stickerStudio.assignEmojiTitle')}
                                onClick={e => {
                                  e.stopPropagation();
                                  setEmojiPickerItemId(emojiPickerItemId === item.id ? null : item.id);
                                }}
                              >
                                {savingEmojiItemId === item.id
                                  ? <span className="studioEmojiSaving">…</span>
                                  : (item.emoji_hint || <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>)
                                }
                              </button>

                              {/* Emoji picker popup — full emoji-mart */}
                              {emojiPickerItemId === item.id && createPortal(
                                <div
                                  className="studioItemEmojiPickerPortal"
                                  onClick={e => e.stopPropagation()}
                                  onMouseDown={e => e.stopPropagation()}
                                >
                                  <div className="studioItemEmojiPickerWrap">
                                    <div className="studioItemEmojiPickerToolbar">
                                      <span className="studioItemEmojiPickerLabel">{t('stickerStudio.emojiBindingLabel')}</span>
                                      <button
                                        className="studioItemEmojiPickerClear"
                                        title={t('stickerStudio.removeBindingTitle')}
                                        onClick={() => handleSetItemEmojiHint(item.id, '')}
                                      >{t('stickerStudio.removeBinding')}</button>
                                      <button
                                        className="studioItemEmojiPickerClose"
                                        onClick={() => setEmojiPickerItemId(null)}
                                      >✕</button>
                                    </div>
                                    <Picker
                                      data={data}
                                      theme={theme}
                                      locale={i18n.language === 'en' ? 'en' : 'ru'}
                                      previewPosition="none"
                                      skinTonePosition="none"
                                      maxFrequentRows={1}
                                      onEmojiSelect={(e: any) => handleSetItemEmojiHint(item.id, e.native)}
                                    />
                                  </div>
                                </div>,
                                document.body,
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
                  {/* Sub-filter: Стикеры / Эмодзи */}
                  <div className="studioPackTypeFilter">
                    <button
                      className={`studioPackTypeBtn${myPacksFilter === 'sticker' ? ' active' : ''}`}
                      onClick={() => setMyPacksFilter('sticker')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="4"/>
                        <circle cx="12" cy="10" r="3"/>
                        <path d="M7 20c0-3 2.2-5 5-5s5 2 5 5"/>
                      </svg>
                      {t('stickerStudio.tabStickers')}
                      {myPacks.filter(p => p?.id && p.type === 'sticker').length > 0 && (
                        <span className="studioPackTypeCnt">{myPacks.filter(p => p?.id && p.type === 'sticker').length}</span>
                      )}
                    </button>
                    <button
                      className={`studioPackTypeBtn${myPacksFilter === 'emoji' ? ' active' : ''}`}
                      onClick={() => setMyPacksFilter('emoji')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                        <line x1="9" y1="9" x2="9.01" y2="9"/>
                        <line x1="15" y1="9" x2="15.01" y2="9"/>
                      </svg>
                      {t('stickerStudio.tabEmoji')}
                      {myPacks.filter(p => p?.id && p.type === 'emoji').length > 0 && (
                        <span className="studioPackTypeCnt">{myPacks.filter(p => p?.id && p.type === 'emoji').length}</span>
                      )}
                    </button>
                  </div>

                  {quota && (
                    <div className="studioQuotaBadge">{t('stickerStudio.packsQuota', { quota: formatQuota(quota) })}</div>
                  )}
                  {loading && <div className="studioLoading"><div className="gifSpinner" /></div>}
                  {!loading && myPacks.filter(p => p?.id && p.type === myPacksFilter).length === 0 && (
                    <div className="studioEmpty">
                      <p>{t('stickerStudio.noPacksOfType', { type: myPacksFilter === 'emoji' ? t('stickerStudio.tabEmoji') : t('stickerStudio.tabStickers') })}</p>
                      <button className="studioBtnPrimary" onClick={() => { setTab('create'); setPackType(myPacksFilter); setStep(1); }}>
                        {myPacksFilter === 'emoji' ? t('stickerStudio.createEmojiPack') : t('stickerStudio.createStickerPack')}
                      </button>
                    </div>
                  )}
                  {myPacks.filter(p => p?.id && p.type === myPacksFilter).map(pack => (
                    <div key={pack.id} className="studioPackRow">
                      <div className="studioPackThumb">
                        <PackCover url={pack.cover_url} name={pack.name} />
                      </div>
                      <div className="studioPackInfo">
                        <div className="studioPackName">{pack.name}</div>
                        <div className="studioPackMeta">
                          {(pack as any).item_count ?? 0} {pack.type === 'emoji' ? t('stickerStudio.unitEmoji') : t('stickerStudio.unitStickersGenitive')} &bull; {pack.is_public ? t('stickerStudio.publicLabel') : t('stickerStudio.privateLabel')}
                        </div>
                      </div>
                      <div className="studioPackActions">
                        {/* Edit items */}
                        <button className="studioIconBtn" onClick={() => openItemsEdit(pack)} title={t('stickerStudio.editItemsTitle', { type: pack.type === 'emoji' ? t('stickerStudio.unitEmoji') : t('stickerStudio.unitStickersPlain') })}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                          </svg>
                        </button>
                        {/* Edit metadata */}
                        <button className="studioIconBtn" onClick={() => startEdit(pack)} title={t('stickerStudio.packSettingsTitle')}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        {/* Delete */}
                        <button className="studioIconBtn studioIconBtnDanger" onClick={() => handleDeletePack(pack)} title={t('common:delete')}>
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
                      <h4>{t('stickerStudio.packSettingsTitle')}</h4>

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
                          title={t('stickerStudio.changeLogoTitle')}
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
                        <span className="studioLogoHint">{t('stickerStudio.logoHintLabel')}<br/><small>{t('stickerStudio.logoHintDetail')}</small></span>
                      </div>

                      <input className="studioInput" value={editName} onChange={e => setEditName(e.target.value)} placeholder={t('stickerStudio.namePlaceholder')} maxLength={64} />
                      <input className="studioInput" value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder={t('stickerStudio.descPlaceholderOptional')} maxLength={256} />
                      <label className="studioToggleRow">
                        <span>{t('stickerStudio.publicLabel')}</span>
                        <input type="checkbox" checked={editPublic} onChange={e => setEditPublic(e.target.checked)} />
                      </label>
                      <div className="studioEditActions">
                        <button className="studioBtnSecondary" onClick={() => setEditingPack(null)}>{t('common:cancel')}</button>
                        <button className="studioBtnPrimary" onClick={saveEdit} disabled={editSaving}>
                          {editSaving ? t('stickerStudio.savingShort') : t('common:save')}
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
                      <h4>{t('stickerStudio.step1Heading')}</h4>

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
                          title={t('stickerStudio.uploadLogoTitle')}
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
                        <span className="studioLogoHint">{t('stickerStudio.logoHintLabel')}<br/><small>{t('stickerStudio.logoHintDetail')}</small></span>
                      </div>

                      <input className="studioInput" placeholder={t('stickerStudio.packNamePlaceholder')} value={packName}
                        onChange={e => setPackName(e.target.value)} maxLength={64} />
                      <input className="studioInput" placeholder={t('stickerStudio.descPlaceholderOptional')} value={packDesc}
                        onChange={e => setPackDesc(e.target.value)} maxLength={256} />
                      <div className="studioRadioRow">
                        <label><input type="radio" name="packType" value="sticker" checked={packType === 'sticker'} onChange={() => setPackType('sticker')} /> {t('stickerStudio.tabStickers')}</label>
                        <label><input type="radio" name="packType" value="emoji"   checked={packType === 'emoji'}   onChange={() => setPackType('emoji')} /> {t('stickerStudio.tabEmoji')}</label>
                      </div>
                      <label className="studioToggleRow">
                        <span>{t('stickerStudio.publicVisibleToAll')}</span>
                        <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
                      </label>
                      <div className="studioWizardFooter">
                        <button className="studioBtnPrimary" onClick={handleCreatePack} disabled={!packName.trim() || creating}>
                          {creating ? t('stickerStudio.creatingShort') : t('stickerStudio.next')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 2 */}
                  {step === 2 && (
                    <div className="studioStepBody">
                      <h4>{t('stickerStudio.step2Heading')}</h4>
                      <p className="studioHint">
                        {t('stickerStudio.step2Hint', { count: pendingItems.length, max: MAX_ITEMS })}
                      </p>

                      <input ref={fileInputRef} type="file" accept={ACCEPT_TYPES}
                        multiple style={{ display: 'none' }} onChange={handleFilePick} />

                      {pendingItems.length < MAX_ITEMS && (
                        <button className="studioBtnSecondary" onClick={() => fileInputRef.current?.click()}>
                          + {t('stickerStudio.addFiles')}
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
                        <button className="studioBtnSecondary" onClick={() => setStep(1)}>{t('stickerStudio.back')}</button>
                        <button className="studioBtnPrimary" onClick={handleStep2Next} disabled={pendingItems.length === 0}>
                          {t('stickerStudio.next')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 3 */}
                  {step === 3 && (
                    <div className="studioStepBody">
                      <h4>{t('stickerStudio.step3Heading')}</h4>
                      <p className="studioHint">{t('stickerStudio.step3Hint')}</p>

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
                        <span>{t('stickerStudio.publicLabel')}</span>
                        <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
                      </label>

                      <div className="studioWizardFooter">
                        <button className="studioBtnSecondary" onClick={() => setStep(2)}>{t('stickerStudio.back')}</button>
                        <button className="studioBtnPrimary" onClick={handlePublish} disabled={publishing}>
                          {publishing ? t('stickerStudio.publishing') : t('stickerStudio.publish')}
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
