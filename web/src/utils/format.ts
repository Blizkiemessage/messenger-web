import { type Chat } from '../types';

export function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function chatTitle(chat: Chat, meId: string): string {
  if (chat.type === 'group') return chat.name || 'Группа';
  const other = chat.members.find(m => m.id !== meId);
  return other?.display_name || other?.username || 'Диалог';
}

export function chatSubtitle(chat: Chat, meId: string): string {
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
