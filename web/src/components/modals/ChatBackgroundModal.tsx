/**
 * ChatBackgroundModal — выбор фона для конкретного чата.
 *
 * Два режима применения:
 *   - «только у меня» (личный фон, chat_backgrounds) — доступно всем участникам;
 *   - «для всех участников» (общий фон, chats.chat_bg) — в ЛС любой собеседник,
 *     в группе admin или модератор с правом edit_info.
 *
 * Типы фона: пресеты, свой цвет, свой градиент (с углом), своя картинка.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Chat } from '../../types';
import { type ChatBg, cssForChatBg, parseChatBg } from '../../utils/appBackground';
import { setChatBackground } from '../../api/chats';
import { uploadFile } from '../../api/upload';
import { useChatsStore } from '../../store/useChatsStore';

function getPresets(t: (k: string) => string): { label: string; bg: ChatBg }[] {
  return [
    { label: t('chatBackground.presetMidnight'), bg: { type: 'solid',    c1: '#0b0911' } },
    { label: t('chatBackground.presetCharcoal'), bg: { type: 'solid',    c1: '#101418' } },
    { label: t('chatBackground.presetSunset'),   bg: { type: 'gradient', c1: '#2d1b4e', c2: '#7c2d5e', angle: 160 } },
    { label: t('chatBackground.presetOcean'),    bg: { type: 'gradient', c1: '#0c1222', c2: '#1b2a4a', angle: 160 } },
    { label: t('chatBackground.presetGlow'),     bg: { type: 'gradient', c1: '#071a14', c2: '#103c4a', angle: 200 } },
    { label: t('chatBackground.presetPink'),     bg: { type: 'gradient', c1: '#ffd9e8', c2: '#ffeedd', angle: 160 } },
  ];
}

/** Может ли пользователь менять ОБЩИЙ фон этого чата. */
function canSetShared(chat: Chat, meId: string): boolean {
  if (chat.type === 'direct') return true; // в ЛС оба равны
  const me = chat.members.find(m => m.id === meId);
  if (!me) return false;
  if (me.role === 'admin') return true;
  if (me.role === 'moderator') return !!me.permissions?.edit_info;
  return false;
}

interface Props {
  chat: Chat;
  meId: string;
  onClose: () => void;
}

/**
 * ChatBackgroundSettings — содержимое выбора фона БЕЗ модальной обёртки.
 * Используется как секция в хабе «Настройки чата» и внутри ChatBackgroundModal.
 * onClose вызывается после успешного «Применить»/«Убрать».
 */
export function ChatBackgroundSettings({ chat, meId, onClose }: Props) {
  const { t } = useTranslation('modals');
  const PRESETS = getPresets(t);
  const sharedAllowed = canSetShared(chat, meId);
  const [draft, setDraft] = useState<ChatBg | null>(
    () => parseChatBg(chat.my_chat_bg) || parseChatBg(chat.chat_bg),
  );
  const [forEveryone, setForEveryone] = useState(false);
  const [mode, setMode] = useState<'solid' | 'gradient'>('gradient');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewCss = cssForChatBg(draft);

  function patchCustom(patch: Partial<ChatBg>) {
    setDraft(prev => {
      const base: ChatBg = prev && prev.type !== 'image'
        ? prev
        : { type: mode, c1: '#1a1426', c2: '#3d2b52', angle: 160 };
      return { ...base, type: mode, ...patch };
    });
  }

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError(t('chatBackground.needImageFile')); return; }
    setUploading(true); setError(null);
    try {
      const res = await uploadFile(file, () => {}).promise;
      setDraft({ type: 'image', url: res.url, dim: 0.35 });
    } catch {
      setError(t('chatBackground.uploadError'));
    } finally { setUploading(false); }
  }

  function applyResult(updated: Chat) {
    // Применяем и общий, и личный из ответа сервера напрямую (минуя upsertChat,
    // который сохраняет локальный my_chat_bg).
    useChatsStore.getState().updateChatPatch(chat.id, {
      chat_bg: updated.chat_bg,
      my_chat_bg: updated.my_chat_bg,
      chat_bg_updated_at: updated.chat_bg_updated_at,
      my_chat_bg_updated_at: updated.my_chat_bg_updated_at,
    });
  }

  async function handleApply() {
    setBusy(true); setError(null);
    try {
      const updated = await setChatBackground(chat.id, draft, forEveryone && sharedAllowed);
      applyResult(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || t('chatBackground.saveError'));
    } finally { setBusy(false); }
  }

  async function handleRemove() {
    setBusy(true); setError(null);
    try {
      const updated = await setChatBackground(chat.id, null, forEveryone && sharedAllowed);
      applyResult(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || t('chatBackground.removeError'));
    } finally { setBusy(false); }
  }

  return (
    <>
        {/* Превью */}
        <div className="cbgPreview" style={previewCss ? { background: previewCss } : undefined}>
          <div className="cbgPreviewBubble cbgPreviewIn">{t('chatBackground.previewIn')}</div>
          <div className="cbgPreviewBubble cbgPreviewOut">{t('chatBackground.previewOut')}</div>
          {!previewCss && <div className="cbgPreviewHint">{t('chatBackground.defaultBg')}</div>}
        </div>

        {/* Пресеты */}
        <div className="apBgPresets cbgPresets">
          {PRESETS.map(p => {
            const css = cssForChatBg(p.bg);
            const active = previewCss === css;
            return (
              <button key={p.label}
                className={`apBgPreset${active ? ' apBgPresetActive' : ''}`}
                onClick={() => setDraft(p.bg)} title={p.label}>
                <span className="apBgPresetFill" style={css ? { background: css } : undefined} />
                <span className="apBgPresetName">{p.label}</span>
              </button>
            );
          })}
        </div>

        {/* Свой цвет / градиент */}
        <div className="apBgModeTabs cbgModeTabs">
          <button className={`apBgModeTab${mode === 'solid' ? ' active' : ''}`}
            onClick={() => { setMode('solid'); patchCustom({ type: 'solid' }); }}>{t('chatBackground.color')}</button>
          <button className={`apBgModeTab${mode === 'gradient' ? ' active' : ''}`}
            onClick={() => { setMode('gradient'); patchCustom({ type: 'gradient' }); }}>{t('chatBackground.gradient')}</button>
          <label className="apBgModeTab cbgImageBtn">
            {uploading ? '…' : t('chatBackground.image')}
            <input type="file" accept="image/*" className="apColorInput" onChange={handleImage} disabled={uploading} />
          </label>
        </div>

        {draft && draft.type !== 'image' && (
          <div className="apBgPickers cbgPickers">
            <label className="apColorPickerLabel apBgPickerLabel">
              <span className="apColorSwatch" style={{ background: draft.c1 }} />
              <span className="apColorHex">{(draft.c1 || '').toUpperCase()}</span>
              <input type="color" className="apColorInput" value={draft.c1 || '#1a1426'}
                onChange={e => patchCustom({ c1: e.target.value })} />
            </label>
            {mode === 'gradient' && (
              <>
                <label className="apColorPickerLabel apBgPickerLabel">
                  <span className="apColorSwatch" style={{ background: draft.c2 }} />
                  <span className="apColorHex">{(draft.c2 || '').toUpperCase()}</span>
                  <input type="color" className="apColorInput" value={draft.c2 || '#3d2b52'}
                    onChange={e => patchCustom({ c2: e.target.value })} />
                </label>
                <label className="apBgAngleRow" title={t('chatBackground.gradientAngle')}>
                  <input type="range" min={0} max={360} step={5} className="apBgAngleSlider"
                    value={draft.angle ?? 160} onChange={e => patchCustom({ angle: Number(e.target.value) })} />
                  <span className="apBgAngleValue">{draft.angle ?? 160}°</span>
                </label>
              </>
            )}
          </div>
        )}

        {/* «Для всех участников» */}
        {sharedAllowed && (
          <button className={`cbgEveryone${forEveryone ? ' cbgEveryoneOn' : ''}`}
            onClick={() => setForEveryone(v => !v)} type="button">
            <span className={`giPermToggle${forEveryone ? ' giPermToggleOn' : ''}`}><span className="giPermKnob" /></span>
            <span className="cbgEveryoneText">
              <span className="cbgEveryoneLabel">{t('chatBackground.changeForEveryone')}</span>
              <span className="cbgEveryoneHint">
                {chat.type === 'direct' ? t('chatBackground.hintDirect') : t('chatBackground.hintGroup')}
              </span>
            </span>
          </button>
        )}

        {error && <div className="cbgError">{error}</div>}

        <div className="cbgActions">
          <button className="cbgRemoveBtn" onClick={handleRemove} disabled={busy}>{t('chatBackground.removeBg')}</button>
          <button className="cbgApplyBtn" onClick={handleApply} disabled={busy || uploading}>
            {busy ? '…' : t('chatBackground.apply')}
          </button>
        </div>
    </>
  );
}

/** Самостоятельная модалка фона (используется вне хаба «Настройки чата»). */
export function ChatBackgroundModal({ chat, meId, onClose }: Props) {
  const { t } = useTranslation('modals');
  return (
    <div className="modalOverlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalCard cbgCard">
        <div className="cbgHeader">
          <div className="cbgTitle">{t('chatBackground.title')}</div>
          <button className="upCloseBtn" onClick={onClose}>✕</button>
        </div>
        <ChatBackgroundSettings chat={chat} meId={meId} onClose={onClose} />
      </div>
    </div>
  );
}
