/**
 * ScheduledMessagesModal — F1 Капсула времени
 *
 * Shows the current user's pending scheduled messages for a specific chat.
 * Each entry shows: preview text/attachment, delivery time, and a cancel button.
 */
import { useEffect, useState, useCallback } from 'react';
import type { Message } from '../../types';
import { fetchScheduledMessages, cancelScheduledMessage } from '../../api/chats';

interface Props {
  chatId: string;
  onClose: () => void;
}

function formatDeliverAt(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function msgPreview(msg: Message): string {
  if (msg.text) return msg.text.length > 80 ? msg.text.slice(0, 80) + '…' : msg.text;
  if (msg.attachment_type === 'sticker') return '🎨 Стикер';
  if (msg.attachment_type?.startsWith('gif')) return '🎬 GIF';
  if (msg.attachment_type === 'image') return '🖼 Фото';
  if (msg.attachment_type === 'video') return '🎥 Видео';
  if (msg.attachment_type === 'audio') return '🎵 Аудио';
  if (msg.attachment_type === 'video_note') return '📹 Видеосообщение';
  if (msg.attachment_name) return `📎 ${msg.attachment_name}`;
  return '📎 Вложение';
}

export function ScheduledMessagesModal({ chatId, onClose }: Props) {
  const [messages, setMessages]   = useState<Message[]>([]);
  const [loading, setLoading]     = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchScheduledMessages(chatId);
      setMessages(data);
    } catch {
      setError('Не удалось загрузить запланированные сообщения');
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => { load(); }, [load]);

  const handleCancel = async (msgId: string) => {
    setCancelling(msgId);
    try {
      await cancelScheduledMessage(chatId, msgId);
      setMessages(prev => prev.filter(m => m.id !== msgId));
    } catch {
      setError('Не удалось отменить сообщение');
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="smModal">
        <div className="smHeader">
          <div className="smTitle">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Запланированные сообщения
          </div>
          <button className="smCloseBtn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="smEmpty">Загрузка…</div>
        ) : error ? (
          <div className="smEmpty smEmptyError">{error}</div>
        ) : messages.length === 0 ? (
          <div className="smEmpty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.3 }}>
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <p>Нет запланированных сообщений</p>
          </div>
        ) : (
          <div className="smList">
            {messages.map(msg => (
              <div key={msg.id} className="smItem">
                <div className="smItemIcon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                </div>
                <div className="smItemBody">
                  <div className="smItemPreview">{msgPreview(msg)}</div>
                  <div className="smItemTime">
                    Отправится {formatDeliverAt(msg.deliver_at!)}
                  </div>
                </div>
                <button
                  className="smCancelBtn"
                  onClick={() => handleCancel(msg.id)}
                  disabled={cancelling === msg.id}
                  title="Отменить"
                >
                  {cancelling === msg.id ? (
                    <span style={{ fontSize: 12 }}>…</span>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
