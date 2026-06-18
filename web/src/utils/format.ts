import { type Chat } from '../types';

export function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function chatTitle(chat: Chat, meId: string): string {
  if (chat.type === 'saved') return 'Сохранённые сообщения';
  if (chat.type === 'group') return chat.name || 'Группа';
  const other = chat.members.find(m => m.id !== meId);
  return other?.display_name || other?.username || 'Диалог';
}

export function chatSubtitle(chat: Chat, meId: string): string {
  if (chat.type === 'saved') return 'Ваши заметки';
  if (chat.type === 'group') return `${chat.members.length} участников`;
  const other = chat.members.find(m => m.id !== meId);
  return other?.username ? `@${other.username}` : '';
}

export function avatarLetter(name: string): string {
  return (name || '?').slice(0, 1).toUpperCase();
}

export function formatLastSeen(lastSeenAt: number | null | undefined, isOnline: boolean): string {
  if (isOnline) return 'Онлайн';
  if (!lastSeenAt) return 'не в сети';
  const diff = Date.now() - lastSeenAt;
  if (diff < 60_000) return 'только что';
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return `был(а) ${m} мин. назад`;
  }
  const d = new Date(lastSeenAt);
  const hhmm = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return `был(а) в ${hhmm}`;
  if (isYesterday) return `был(а) вчера в ${hhmm}`;
  return `был(а) ${d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })} в ${hhmm}`;
}

const RU_MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** Локальный «ключ дня» (YYYY-MM-DD в часовом поясе пользователя) для группировки. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Человекочитаемая дата для разделителя в переписке:
 *   «Сегодня», «Вчера», «17 января» (текущий год) или «11 июля 2025» (прошлые годы).
 */
export function formatDateSeparator(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (dayKey(ts) === dayKey(now.getTime())) return 'Сегодня';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(ts) === dayKey(yesterday.getTime())) return 'Вчера';
  const day = d.getDate();
  const month = RU_MONTHS_GEN[d.getMonth()];
  return d.getFullYear() === now.getFullYear()
    ? `${day} ${month}`
    : `${day} ${month} ${d.getFullYear()}`;
}

export function formatBirthDate(d: string): string {
  try {
    const parts = d.split('-');
    if (parts.length === 3) {
      const months = [
        'января','февраля','марта','апреля','мая','июня',
        'июля','августа','сентября','октября','ноября','декабря',
      ];
      return `${parseInt(parts[2])} ${months[parseInt(parts[1]) - 1]} ${parts[0]}`;
    }
    return d;
  } catch {
    return d;
  }
}
