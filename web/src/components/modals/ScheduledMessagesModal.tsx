/**
 * ScheduledMessagesModal — F1 Капсула времени
 *
 * Shows pending scheduled messages for a chat.
 * Each entry can be cancelled or edited (text + delivery time).
 */
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../types';
import { fetchScheduledMessages, cancelScheduledMessage, updateScheduledMessage } from '../../api/chats';
import { ScheduleDatePicker } from '../chat/ScheduleDatePicker';

interface Props {
  chatId: string;
  onClose: () => void;
}

function formatDeliverAt(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function msgPreview(msg: Message, t: (k: string, o?: any) => string): string {
  if (msg.text) return msg.text.length > 80 ? msg.text.slice(0, 80) + '…' : msg.text;
  if (msg.attachment_type === 'sticker') return t('scheduledMessages.previewSticker');
  if (msg.attachment_type?.startsWith('gif')) return t('scheduledMessages.previewGif');
  if (msg.attachment_type === 'image') return t('scheduledMessages.previewPhoto');
  if (msg.attachment_type === 'video') return t('scheduledMessages.previewVideo');
  if (msg.attachment_type === 'audio') return t('scheduledMessages.previewAudio');
  if (msg.attachment_type === 'video_note') return t('scheduledMessages.previewVideoNote');
  if (msg.attachment_name) return t('scheduledMessages.previewFile', { name: msg.attachment_name });
  return t('scheduledMessages.previewAttachment');
}

/** Single message item — view or edit mode */
function ScheduledItem({
  msg,
  chatId,
  onUpdated,
  onRemoved,
}: {
  msg: Message;
  chatId: string;
  onUpdated: (m: Message) => void;
  onRemoved: (id: string) => void;
}) {
  const { t, i18n } = useTranslation('modals');
  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
  const [editing,       setEditing]       = useState(false);
  const [editText,      setEditText]      = useState(msg.text ?? '');
  const [editDeliverAt, setEditDeliverAt] = useState<number>(msg.deliver_at!);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [cancelling,    setCancelling]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  const hasText = !!msg.text;

  function startEdit() {
    setEditText(msg.text ?? '');
    setEditDeliverAt(msg.deliver_at!);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
    setShowTimePicker(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: { text?: string; deliver_at?: number } = {};
      if (hasText) payload.text = editText.trim();
      payload.deliver_at = editDeliverAt;
      const updated = await updateScheduledMessage(chatId, msg.id, payload);
      onUpdated(updated);
      setEditing(false);
    } catch (e: any) {
      setError(e?.message ?? t('scheduledMessages.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelScheduledMessage(chatId, msg.id);
      onRemoved(msg.id);
    } catch {
      setError(t('scheduledMessages.cancelError'));
    } finally {
      setCancelling(false);
    }
  }

  /* ── View mode ── */
  if (!editing) {
    return (
      <div className="smItem">
        <div className="smItemIcon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div className="smItemBody">
          <div className="smItemPreview">{msgPreview(msg, t)}</div>
          <div className="smItemTime">{t('scheduledMessages.willSendAt', { date: formatDeliverAt(msg.deliver_at!, locale) })}</div>
        </div>
        {/* Edit button */}
        <button className="smEditBtn" onClick={startEdit} title={t('scheduledMessages.edit')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        {/* Cancel button */}
        <button
          className="smCancelBtn"
          onClick={handleCancel}
          disabled={cancelling}
          title={t('scheduledMessages.cancelSend')}
        >
          {cancelling
            ? <span style={{ fontSize: 12 }}>…</span>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
          }
        </button>
      </div>
    );
  }

  /* ── Edit mode ── */
  return (
    <>
      {showTimePicker && (
        <ScheduleDatePicker
          initialDeliverAt={editDeliverAt}
          onConfirm={ts => { setEditDeliverAt(ts); setShowTimePicker(false); }}
          onClose={() => setShowTimePicker(false)}
        />
      )}
      <div className="smEditCard">
        {/* Text field (only for text messages) */}
        {hasText && (
          <div className="smEditField">
            <label className="smEditLabel">{t('scheduledMessages.messageTextLabel')}</label>
            <textarea
              className="smEditTextarea"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder={t('scheduledMessages.messageTextPlaceholder')}
            />
          </div>
        )}
        {/* Delivery time */}
        <div className="smEditField">
          <label className="smEditLabel">{t('scheduledMessages.sendTimeLabel')}</label>
          <button className="smEditTimeBtn" onClick={() => setShowTimePicker(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            {formatDeliverAt(editDeliverAt, locale)}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>

        {error && <div className="smEditError">{error}</div>}

        <div className="smEditActions">
          <button className="smEditSaveBtn" onClick={save} disabled={saving || (hasText && !editText.trim())}>
            {saving ? '…' : t('common:save')}
          </button>
          <button className="smEditCancelBtn" onClick={cancelEdit} disabled={saving}>
            {t('common:cancel')}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── Modal ──────────────────────────────────────────────────────────── */
export function ScheduledMessagesModal({ chatId, onClose }: Props) {
  const { t } = useTranslation('modals');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setMessages(await fetchScheduledMessages(chatId));
    } catch {
      setError(t('scheduledMessages.loadError'));
    } finally {
      setLoading(false);
    }
  }, [chatId, t]);

  useEffect(() => { load(); }, [load]);

  const handleUpdated = useCallback((updated: Message) => {
    setMessages(prev => prev.map(m => m.id === updated.id ? updated : m));
  }, []);

  const handleRemoved = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="smModal">
        <div className="smHeader">
          <div className="smTitle">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            {t('scheduledMessages.title')}
          </div>
          <button className="smCloseBtn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="smEmpty">{t('common:loading')}</div>
        ) : error ? (
          <div className="smEmpty smEmptyError">{error}</div>
        ) : messages.length === 0 ? (
          <div className="smEmpty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.3 }}>
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <p>{t('scheduledMessages.noScheduled')}</p>
          </div>
        ) : (
          <div className="smList">
            {messages.map(msg => (
              <ScheduledItem
                key={msg.id}
                msg={msg}
                chatId={chatId}
                onUpdated={handleUpdated}
                onRemoved={handleRemoved}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
