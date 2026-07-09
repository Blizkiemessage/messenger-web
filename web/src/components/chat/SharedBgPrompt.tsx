/**
 * SharedBgPrompt — ненавязчивая плашка «Фон чата обновлён · Применить».
 *
 * Показывается участнику, у которого выставлен СВОЙ личный фон (он перекрывает
 * общий), когда кто-то поменял общий фон «для всех» уже ПОСЛЕ выбора личного.
 * Так «для всех» не игнорируется молча, но и не затирает чужой осознанный выбор:
 *   • «Применить» — снимает личный фон, чат показывает общий.
 *   • «✕»        — оставляет любимый личный фон; плашку прячем (запоминаем).
 *
 * Дисмисс хранится локально по паре (chatId, chat_bg_updated_at): если общий фон
 * поменяют ещё раз — плашка появится снова под новую метку времени.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Chat } from '../../types';
import { cssForChatBg, parseChatBg, sharedChatBgIsNewer } from '../../utils/appBackground';
import { setChatBackground } from '../../api/chats';
import { useChatsStore } from '../../store/useChatsStore';

const DISMISS_KEY = 'blizkie.chatBgPrompt.dismissed.v1';

function readDismissed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}'); } catch { return {}; }
}
function writeDismissed(map: Record<string, number>) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(map)); } catch { /* quota — не критично */ }
}

export function SharedBgPrompt({ chat }: { chat: Chat }) {
  const { t } = useTranslation('chat');
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  const stamp = chat.chat_bg_updated_at ?? 0;
  const show = !hidden && sharedChatBgIsNewer(chat) && readDismissed()[chat.id] !== stamp;
  if (!show) return null;

  const sharedCss = cssForChatBg(parseChatBg(chat.chat_bg));

  async function apply() {
    setBusy(true);
    try {
      // forEveryone=false + bg=null → снимаем личный фон; общий станет виден.
      const updated = await setChatBackground(chat.id, null, false);
      useChatsStore.getState().updateChatPatch(chat.id, {
        chat_bg: updated.chat_bg,
        my_chat_bg: updated.my_chat_bg,
        chat_bg_updated_at: updated.chat_bg_updated_at,
        my_chat_bg_updated_at: updated.my_chat_bg_updated_at,
      });
    } catch {
      setBusy(false); // оставляем плашку — пусть попробует ещё раз
    }
  }

  function keepMine() {
    const map = readDismissed();
    map[chat.id] = stamp;
    writeDismissed(map);
    setHidden(true);
  }

  return (
    <div className="sbgPrompt" role="status">
      <span className="sbgPromptSwatch" style={sharedCss ? { background: sharedCss } : undefined} aria-hidden />
      <span className="sbgPromptText">
        {chat.type === 'direct' ? t('sharedBgPrompt.updatedDirect') : t('sharedBgPrompt.updatedGroup')}
      </span>
      <button className="sbgPromptApply" onClick={apply} disabled={busy}>
        {busy ? '…' : t('sharedBgPrompt.apply')}
      </button>
      <button className="sbgPromptClose" onClick={keepMine} disabled={busy} title={t('sharedBgPrompt.keepMine')} aria-label={t('sharedBgPrompt.keepMine')}>✕</button>
    </div>
  );
}
