import { type Chat } from '../types';
import i18n from '../i18n';

export function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function chatTitle(chat: Chat, meId: string): string {
  if (chat.type === 'saved') return i18n.t('common:savedMessagesTitle');
  if (chat.type === 'group') return chat.name || i18n.t('common:groupFallback');
  const other = chat.members.find(m => m.id !== meId);
  return other?.display_name || other?.username || i18n.t('common:dialogFallback');
}

export function chatSubtitle(chat: Chat, meId: string): string {
  if (chat.type === 'saved') return i18n.t('common:yourNotes');
  if (chat.type === 'group') return i18n.t('common:membersCount', { count: chat.members.length });
  const other = chat.members.find(m => m.id !== meId);
  return other?.username ? `@${other.username}` : '';
}

export function avatarLetter(name: string): string {
  return (name || '?').slice(0, 1).toUpperCase();
}

/** 'ru-RU' or 'en-US' Intl locale tag matching the active app language. */
function intlLocale(): string {
  return i18n.language === 'en' ? 'en-US' : 'ru-RU';
}

/** Long day+month (+year, for a different year), locale-aware; strips Russian's trailing "г." */
function formatDayMonth(d: Date, withYear: boolean): string {
  const opts: Intl.DateTimeFormatOptions = withYear
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'long' };
  return d.toLocaleDateString(intlLocale(), opts).replace(/\s*г\.$/, '');
}

export function formatLastSeen(lastSeenAt: number | null | undefined, isOnline: boolean): string {
  if (isOnline) return i18n.t('common:online');
  if (!lastSeenAt) return i18n.t('common:offline');
  const diff = Date.now() - lastSeenAt;
  if (diff < 60_000) return i18n.t('common:justNow');
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return i18n.t('common:minutesAgo', { count: m });
  }
  const d = new Date(lastSeenAt);
  const hhmm = d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return i18n.t('common:wasOnlineAt', { time: hhmm });
  if (isYesterday) return i18n.t('common:wasOnlineYesterdayAt', { time: hhmm });
  return i18n.t('common:wasOnlineOn', { date: formatDayMonth(d, false), time: hhmm });
}

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
  if (dayKey(ts) === dayKey(now.getTime())) return i18n.t('common:today');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(ts) === dayKey(yesterday.getTime())) return i18n.t('common:yesterday');
  return formatDayMonth(d, d.getFullYear() !== now.getFullYear());
}

export function formatBirthDate(d: string): string {
  try {
    const parts = d.split('-');
    if (parts.length === 3) {
      const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      return formatDayMonth(date, true);
    }
    return d;
  } catch {
    return d;
  }
}
