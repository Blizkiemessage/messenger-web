/**
 * MessageReadersModal
 * Shows which group members have read a specific message,
 * with their avatar, name, @username, and read time + date.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMessageReaders, type MessageReader } from '../../api/messages';
import { Avatar } from '../ui/Avatar';
import { type MessageReaction } from '../../types';

interface Props {
  chatId: string;
  msgId: string;
  reactions: MessageReaction[];
  onClose: () => void;
}

function formatReadAt(ts: number, t: (k: string) => string, locale: string): { time: string; date: string | null } {
  const d   = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  if (d.toDateString() === now.toDateString()) return { time, date: null };

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return { time, date: t('common:yesterday') };

  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return { time, date };
}

export function MessageReadersModal({ chatId, msgId, reactions, onClose }: Props) {
  const { t, i18n } = useTranslation('chat');
  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
  const [readers, setReaders] = useState<MessageReader[]>([]);
  const [loading, setLoading] = useState(true);

  const reactionByUser = new Map(reactions.map(r => [r.userId, r.emoji]));

  useEffect(() => {
    let cancelled = false;
    getMessageReaders(chatId, msgId)
      .then(r => { if (!cancelled) setReaders(r); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chatId, msgId]);

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard readersModal" onClick={e => e.stopPropagation()}>
        <div className="modalHeader">
          <span className="modalTitle">
            {loading ? t('messageReaders.loading') : readers.length === 0
              ? t('messageReaders.noneRead')
              : t('messageReaders.readCount', { count: readers.length })}
          </span>
          <button className="modalClose" onClick={onClose} title={t('common:close')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="readersList">
          {loading && (
            <div className="readersLoading">
              <div className="readersSpinner" />
            </div>
          )}

          {!loading && readers.length === 0 && (
            <div className="readersEmpty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="readersEmptyIcon">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <span>{t('messageReaders.notReadYet')}</span>
            </div>
          )}

          {!loading && readers.map(({ user, read_at }) => {
            const { time, date } = formatReadAt(read_at, t, locale);
            return (
              <div key={user.id} className="readerItem">
                <Avatar user={user} size={40} radius={12} />
                <div className="readerInfo">
                  <div className="readerName">{user.display_name || user.username || t('modals:forward.unknownUser')}</div>
                  {user.username && (
                    <div className="readerUsername">@{user.username}</div>
                  )}
                </div>
                {reactionByUser.get(user.id) && (
                  <span className="readerEmoji">{reactionByUser.get(user.id)}</span>
                )}
                <div className="readerTime">
                  <span className="readerTimeVal">{time}</span>
                  {date && <span className="readerTimeDate">{date}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
