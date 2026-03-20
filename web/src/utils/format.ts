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
