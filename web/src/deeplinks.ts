/**
 * deeplinks.ts — единая модель «ссылок-действий» внутри приложения.
 *
 * Действие можно:
 *   - вызвать программно: useDeepLinkStore.getState().open(action)
 *   - встроить в сообщение/карточку как ссылку `blz:<type>?k=v` (рендерится в
 *     markdown.tsx) — клик диспатчит действие.
 *
 * Глобальные действия исполняются раннером в App.tsx; чат-привязанные —
 * раннером в ChatArea (он умеет переключить чат и открыть нужную панель).
 *
 * Реестр расширяемый: новый экран = новый вариант в DeepLinkAction + ветка в
 * соответствующем раннере. Незнакомое действие безопасно игнорируется.
 */

export type DeepLinkAction =
  // ── глобальные ──
  | { type: 'open-chat'; chatId: string }
  | { type: 'open-saved' }
  | { type: 'profile-settings' }
  | { type: 'appearance' }            // вкладка «Внешний вид» в настройках профиля
  | { type: 'create-group' }
  | { type: 'find-friends' }          // фокус на поиске в сайдбаре
  | { type: 'invite' }                // поделиться приложением / ссылкой
  // ── привязанные к чату (нужен активный/целевой чат) ──
  | { type: 'chat-settings'; chatId?: string; section?: 'appearance' | 'daily' }
  | { type: 'daily-archive'; chatId?: string }
  | { type: 'notes'; chatId?: string }
  | { type: 'media'; chatId?: string };

const CHAT_SCOPED = new Set(['chat-settings', 'daily-archive', 'notes', 'media']);

/** true → действие исполняет ChatArea (требует чат); false → App (глобальное). */
export function isChatScoped(a: DeepLinkAction): boolean {
  return CHAT_SCOPED.has(a.type);
}

/** Разобрать строку `blz:<type>?k=v&k=v` в действие. null — если невалидно. */
export function parseDeepLink(href: string): DeepLinkAction | null {
  if (!href || !href.startsWith('blz:')) return null;
  const [type, query = ''] = href.slice(4).split('?');
  const p = new URLSearchParams(query);
  const chatId = p.get('chatId') || undefined;
  switch (type) {
    case 'open-chat':       return chatId ? { type, chatId } : null;
    case 'open-saved':      return { type };
    case 'profile-settings':return { type };
    case 'appearance':      return { type };
    case 'create-group':    return { type };
    case 'find-friends':    return { type };
    case 'invite':          return { type };
    case 'chat-settings': {
      const section = p.get('section');
      return { type, chatId, section: section === 'daily' || section === 'appearance' ? section : undefined };
    }
    case 'daily-archive':   return { type, chatId };
    case 'notes':           return { type, chatId };
    case 'media':           return { type, chatId };
    default:                return null;
  }
}

/**
 * Поделиться приложением. Использует Web Share API; иначе копирует ссылку.
 * Возвращает результат, чтобы UI мог показать обратную связь.
 */
export async function shareApp(): Promise<'shared' | 'copied' | 'failed'> {
  const url = window.location.origin;
  try {
    if (navigator.share) {
      await navigator.share({
        title: 'Blizkie',
        text: 'Давай общаться в Blizkie — тёплый мессенджер для близких',
        url,
      });
      return 'shared';
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
  } catch { /* пользователь отменил или ошибка — не критично */ }
  return 'failed';
}
