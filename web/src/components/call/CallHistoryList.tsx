/**
 * CallHistoryList — глобальная (кросс-чатная) история звонков.
 * Общий компонент для вкладки «Звонки»: десктопная колонка (Sidebar.tsx) и
 * мобильная карточка (MobileSidebar.tsx) рендерят его одинаково.
 *
 * Тап по строке открывает чат с собеседником; кнопка-трубка перезванивает
 * напрямую (создаёт/находит ЛС и сразу инициирует звонок того же типа).
 * Строки переиспользуют классы .chatItem/.ciAvatarWrap/.ciBody из списка
 * чатов — единый вид без дублирования стилей.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getGlobalCallHistory } from '../../api/calls';
import { createDirectChat } from '../../api/chats';
import type { GlobalCallHistoryEntry } from '../../types';
import { Avatar } from '../ui/Avatar';
import { formatTime, formatDateSeparator, dayKey } from '../../utils/format';
import { useChatsStore } from '../../store/useChatsStore';
import { useCallStore } from '../../store/useCallStore';
import { emitCallInvite } from '../../socket/socketClient';

const PAGE_SIZE = 30;
const SCROLL_THRESHOLD = 120;

function formatDuration(s: number): string {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function PhoneIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.24h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6.29 6.29l.95-.95a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  );
}

function VideoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
  );
}

/** Диагональная стрелка: без поворота = исходящий (вверх-вправо), 180° = входящий. */
function DirectionIcon({ direction, missed }: { direction: 'incoming' | 'outgoing'; missed: boolean }) {
  return (
    <svg
      className={`chCallDirIcon${missed ? ' callHistoryMissed' : ''}`}
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: direction === 'incoming' ? 'rotate(180deg)' : undefined }}
    >
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function getStatusText(entry: GlobalCallHistoryEntry): { text: string; missed: boolean } {
  if (entry.status === 'rejected') {
    return entry.direction === 'incoming'
      ? { text: 'Вы отклонили', missed: false }
      : { text: 'Отклонён', missed: false };
  }
  if (entry.status === 'missed') {
    return entry.direction === 'incoming'
      ? { text: 'Пропущенный', missed: true }
      : { text: 'Не ответил(а)', missed: false };
  }
  return { text: entry.duration ? formatDuration(entry.duration) : 'Звонок', missed: false };
}

export function CallHistoryList() {
  const [calls, setCalls] = useState<GlobalCallHistoryEntry[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const setActiveChatId = useChatsStore(s => s.setActiveChatId);

  const load = useCallback(async (before?: number) => {
    const page = await getGlobalCallHistory(PAGE_SIZE, before);
    setCalls(prev => (before ? [...(prev ?? []), ...page] : page));
    setHasMore(page.length === PAGE_SIZE);
  }, []);

  useEffect(() => { load().catch(() => setCalls([])); }, [load]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (loadingMore || !hasMore || !calls?.length) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD) {
        setLoadingMore(true);
        load(calls[calls.length - 1].createdAt).finally(() => setLoadingMore(false));
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [calls, hasMore, loadingMore, load]);

  async function openChat(entry: GlobalCallHistoryEntry) {
    try {
      const chat = await createDirectChat(entry.otherUser.id);
      useChatsStore.getState().upsertChat(chat);
      setActiveChatId(chat.id);
    } catch { /* ignore — chat opening best-effort */ }
  }

  async function callBack(e: React.MouseEvent, entry: GlobalCallHistoryEntry) {
    e.stopPropagation();
    if (useCallStore.getState().status !== 'idle') return;
    try {
      const chat = await createDirectChat(entry.otherUser.id);
      useChatsStore.getState().upsertChat(chat);
      setActiveChatId(chat.id);
      const callId = crypto.randomUUID();
      useCallStore.getState().startOutgoingCall({
        callId, chatId: chat.id, callType: entry.callType,
        peerId: entry.otherUser.id, peerInfo: entry.otherUser,
      });
      emitCallInvite({ callId, calleeId: entry.otherUser.id, chatId: chat.id, callType: entry.callType });
    } catch { /* ignore — call-back best-effort */ }
  }

  if (calls === null) {
    return <div className="callHistoryLoading">Загрузка…</div>;
  }

  if (calls.length === 0) {
    return (
      <div className="callHistoryEmpty">
        <div className="callHistoryEmptyIcon"><PhoneIcon size={32} /></div>
        <div className="callHistoryEmptyTitle">История звонков</div>
        <div className="callHistoryEmptySub">Здесь появятся ваши звонки</div>
      </div>
    );
  }

  let lastDay = '';
  return (
    <div className="callHistoryList" ref={containerRef}>
      {calls.map(entry => {
        const day = dayKey(entry.createdAt);
        const showHeader = day !== lastDay;
        lastDay = day;
        const { text, missed } = getStatusText(entry);
        const name = entry.otherUser.display_name || entry.otherUser.username || 'Пользователь';
        return (
          <div key={entry.id}>
            {showHeader && <div className="callHistoryDayHeader">{formatDateSeparator(entry.createdAt)}</div>}
            <button className="chatItem callHistoryItem" onClick={() => openChat(entry)}>
              <div className="ciAvatarWrap">
                <div className="ciAvatar">
                  <Avatar user={entry.otherUser} size={42} radius={13} presenceStatus={null} />
                </div>
              </div>
              <div className="ciBody">
                <div className="ciTop">
                  <span className="ciName">{name}</span>
                  <span className="ciTime">{formatTime(entry.createdAt)}</span>
                </div>
                <div className="ciBottom">
                  <span className={`ciPreview callHistoryStatus${missed ? ' callHistoryMissed' : ''}`}>
                    <DirectionIcon direction={entry.direction} missed={missed} />
                    {text}
                  </span>
                  <button
                    className="callHistoryCallBackBtn"
                    onClick={e => callBack(e, entry)}
                    title="Перезвонить"
                  >
                    {entry.callType === 'video' ? <VideoIcon /> : <PhoneIcon />}
                  </button>
                </div>
              </div>
            </button>
          </div>
        );
      })}
      {loadingMore && <div className="callHistoryLoadingMore">Загрузка…</div>}
    </div>
  );
}
