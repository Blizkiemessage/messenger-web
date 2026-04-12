import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  getMyPacks, createPack, updatePack, deletePack,
  uploadStickerItem, deleteStickerItem, getMyQuota,
} from '../../api/sticker-packs';
import { type StickerPack, type StickerPackItem, type UserCreationQuota } from '../../types';
import { useStickerStore } from '../../store/useStickerStore';

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

function formatQuota(q: UserCreationQuota) {
  return `${q.packs_created} / ${q.free_packs_limit + q.extra_packs}`;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Edit state ────────────────────────────────────────────────────────────
  const [editingPack, setEditingPack] = useState<StickerPack | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPublic, setEditPublic] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    Promise.all([getMyPacks(), getMyQuota()])
      .then(([packs, q]) => { setMyPacks(packs); setQuota(q); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Trap ESC
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  // ── Wizard: Step 1 — create pack ─────────────────────────────────────────
  async function handleCreatePack() {
    if (!packName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const pack = await createPack({ name: packName.trim(), description: packDesc.trim() || undefined, type: packType, is_public: isPublic });
      setCreatedPack(pack);
      setMyPacks(p => [pack, ...p]);
      setQuota(q => q ? { ...q, packs_created: q.packs_created + 1 } : q);
      setStep(2);
    } catch (e: any) {
      if (e?.response?.data?.error === 'quota_exceeded') {
        setError('Достигнут лимит паков. Удали старый или купи дополнительный слот.');
      } else {
        setError(e.message || 'Ошибка создания');
      }
    } finally {
      setCreating(false);
    }
  }

  // ── Wizard: Step 2 — upload stickers ─────────────────────────────────────
  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const newItems: PendingItem[] = files.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      emojiHint: '',
      keywords: '',
      uploading: false,
    }));
    setPendingItems(prev => [...prev, ...newItems]);
  }

  async function uploadItem(index: number) {
    if (!createdPack) return;
    const item = pendingItems[index];
    if (item.uploading || item.uploaded) return;

    setPendingItems(prev => prev.map((it, i) => i === index ? { ...it, uploading: true, error: undefined } : it));
    try {
      const uploaded = await uploadStickerItem(createdPack.id, item.file, {
        emoji_hint: item.emojiHint || undefined,
        keywords: item.keywords || undefined,
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
    if (it.uploaded) {
      deleteStickerItem(createdPack!.id, it.uploaded.id).catch(() => {});
    }
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
      // Refresh installed packs so the new pack shows in the sticker panel
      useStickerStore.getState().fetchInstalledPacks();
      // Reset wizard
      setStep(1);
      setPackName(''); setPackDesc(''); setPackType('sticker'); setIsPublic(false);
      setCreatedPack(null); setPendingItems([]); setCoverItemId(null);
      setTab('my-packs');
      // Refresh my packs list
      const packs = await getMyPacks();
      setMyPacks(packs);
    } catch (e: any) {
      setError(e.message || 'Ошибка публикации');
    } finally {
      setPublishing(false);
    }
  }

  // ── Edit pack ─────────────────────────────────────────────────────────────
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
      await updatePack(editingPack.id, { name: editName.trim(), description: editDesc.trim() || undefined, is_public: editPublic });
      setMyPacks(prev => prev.map(p => p.id === editingPack.id ? { ...p, name: editName.trim(), description: editDesc.trim() || null, is_public: editPublic } : p));
      setEditingPack(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeletePack(pack: StickerPack) {
    if (!confirm(`Удалить пак «${pack.name}»? Это действие нельзя отменить.`)) return;
    try {
      await deletePack(pack.id);
      setMyPacks(prev => prev.filter(p => p.id !== pack.id));
      useStickerStore.getState().fetchInstalledPacks();
    } catch (e: any) {
      setError(e.message);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return createPortal(
    <div className="studioOverlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="studioModal">
        {/* Header */}
        <div className="studioHeader">
          <span className="studioTitle">Студия стикеров</span>
          <button className="studioClose" onClick={onClose} title="Закрыть">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="studioTabs">
          <button className={`studioTab${tab === 'my-packs' ? ' active' : ''}`} onClick={() => setTab('my-packs')}>Мои паки</button>
          <button className={`studioTab${tab === 'create'   ? ' active' : ''}`} onClick={() => { setTab('create'); setStep(1); }}>Создать пак</button>
        </div>

        {/* Body */}
        <div className="studioBody">
          {error && <div className="studioError">{error}<button onClick={() => setError('')}>✕</button></div>}

          {/* ── My packs tab ── */}
          {tab === 'my-packs' && (
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
              {myPacks.map(pack => (
                <div key={pack.id} className="studioPackRow">
                  <div className="studioPackThumb">
                    {pack.cover_url
                      ? <img src={pack.cover_url} alt={pack.name} />
                      : <span>{pack.name[0]}</span>
                    }
                  </div>
                  <div className="studioPackInfo">
                    <div className="studioPackName">{pack.name}</div>
                    <div className="studioPackMeta">
                      {(pack as any).item_count ?? 0} стикеров &bull; {pack.is_public ? 'Публичный' : 'Приватный'}
                    </div>
                  </div>
                  <div className="studioPackActions">
                    <button className="studioIconBtn" onClick={() => startEdit(pack)} title="Редактировать">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                    <button className="studioIconBtn studioIconBtnDanger" onClick={() => handleDeletePack(pack)} title="Удалить">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6"/>
                        <path d="M14 11v6"/>
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}

              {/* Edit dialog */}
              {editingPack && (
                <div className="studioEditDialog">
                  <h4>Редактировать пак</h4>
                  <input className="studioInput" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Название" maxLength={64} />
                  <input className="studioInput" value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Описание (необязательно)" maxLength={256} />
                  <label className="studioToggleRow">
                    <span>Публичный</span>
                    <input type="checkbox" checked={editPublic} onChange={e => setEditPublic(e.target.checked)} />
                  </label>
                  <div className="studioEditActions">
                    <button className="studioBtnSecondary" onClick={() => setEditingPack(null)}>Отмена</button>
                    <button className="studioBtnPrimary" onClick={saveEdit} disabled={editSaving}>{editSaving ? 'Сохранение…' : 'Сохранить'}</button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Create tab (3-step wizard) ── */}
          {tab === 'create' && (
            <>
              {/* Step indicator */}
              <div className="studioStepBar">
                {([1,2,3] as WizardStep[]).map(s => (
                  <div key={s} className={`studioStep${step >= s ? ' done' : ''}${step === s ? ' current' : ''}`}>{s}</div>
                ))}
              </div>

              {/* Step 1 */}
              {step === 1 && (
                <div className="studioStepBody">
                  <h4>Шаг 1: Основное</h4>
                  <input
                    className="studioInput"
                    placeholder="Название пака *"
                    value={packName}
                    onChange={e => setPackName(e.target.value)}
                    maxLength={64}
                  />
                  <input
                    className="studioInput"
                    placeholder="Описание (необязательно)"
                    value={packDesc}
                    onChange={e => setPackDesc(e.target.value)}
                    maxLength={256}
                  />
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
                  <p className="studioHint">Форматы: PNG, WebP, GIF (анимированный). Макс. 5 МБ каждый.</p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.webp,.gif,image/png,image/webp,image/gif"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFilePick}
                  />
                  <button className="studioBtnSecondary" onClick={() => fileInputRef.current?.click()}>
                    + Добавить файлы
                  </button>

                  <div className="studioItemGrid">
                    {pendingItems.map((item, i) => (
                      <div key={i} className="studioItemCell">
                        <img src={item.preview} alt="preview" />
                        {item.uploading && <div className="studioItemOverlay"><div className="gifSpinner" /></div>}
                        {item.error && <div className="studioItemError" title={item.error}>!</div>}
                        {item.uploaded && <div className="studioItemDone">✓</div>}
                        <button className="studioItemRemove" onClick={() => removeItem(i)}>✕</button>
                        <input
                          className="studioItemEmoji"
                          placeholder="😀"
                          value={item.emojiHint}
                          maxLength={2}
                          onChange={e => setPendingItems(prev => prev.map((it, j) => j === i ? { ...it, emojiHint: e.target.value } : it))}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="studioWizardFooter">
                    <button className="studioBtnSecondary" onClick={() => setStep(1)}>← Назад</button>
                    <button
                      className="studioBtnPrimary"
                      onClick={handleStep2Next}
                      disabled={pendingItems.length === 0}
                    >
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
                      <div
                        key={item.uploaded!.id}
                        className={`studioItemCell studioItemSelectable${coverItemId === item.uploaded!.id ? ' selected' : ''}`}
                        onClick={() => setCoverItemId(item.uploaded!.id)}
                      >
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
  );
}
