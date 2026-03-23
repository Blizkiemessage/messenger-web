/**
 * ForwardModal.tsx
 * ✅ Full forward-message workflow:
 *   Step 1 (recipients): choose target chats / users + preview button
 *   Step 2 (preview):    review selected messages, remove, or add more
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useChatsStore } from '../../store/useChatsStore';
import { useSearch } from '../../hooks/useSearch';
import { forwardMessages as apiForward, createDirectChat } from '../../api/chats';
import { Avatar } from '../ui/Avatar';
import { chatTitle } from '../../utils/format';
import type { Message, User } from '../../types';

interface Props {
  messages: Message[];       // messages queued for forwarding
  meId: string;
  onClose: () => void;
  onAddMore: () => void;     // closes modal, returns to chat in selection mode
}

// helper — short attachment preview label
function attachmentLabel(m: Message): string {
  if (!m.attachment_type) return '';
  if (m.attachment_type === 'image') return '🖼 Изображение';
  if (m.attachment_type === 'video') return '🎬 Видео';
  return `📎 ${m.attachment_name || 'Файл'}`;
}

export function ForwardModal({ messages: initMessages, meId, onClose, onAddMore }: Props) {
  const chats = useChatsStore(s => s.chats);

  // ── State ────────────────────────────────────────────────────────────────
  const [step, setStep]                     = useState<'recipients' | 'preview'>('recipients');
  const [forwardMsgs, setForwardMsgs]       = useState<Message[]>(initMessages);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set()); // chatId or userId
  const [sending, setSending]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);

  // sync if parent changes the messages list (user added more)
  useEffect(() => { setForwardMsgs(initMessages); }, [initMessages]);

  // ── User search ──────────────────────────────────────────────────────────
  const { query, setQuery, results: searchResults, searching } = useSearch();

  // ── Helpers ───────────────────────────────────────────────────────────────
  const toggleTarget = useCallback((id: string) => {
    setSelectedTargets(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const removeMessage = useCallback((msgId: string) => {
    setForwardMsgs(prev => prev.filter(m => m.id !== msgId));
  }, []);

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (selectedTargets.size === 0 || forwardMsgs.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const msgIds = forwardMsgs.map(m => m.id);

      for (const target of selectedTargets) {
        let chatId = target;

        // If target is a userId (from search), get-or-create a direct chat
        const isChat = chats.some(c => c.id === target);
        if (!isChat) {
          const chat = await createDirectChat(target);
          useChatsStore.getState().upsertChat(chat);
          chatId = chat.id;
        }

        await apiForward(chatId, msgIds);
      }
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Ошибка при пересылке');
    } finally {
      setSending(false);
    }
  }, [selectedTargets, forwardMsgs, chats, onClose]);

  // ── Derived lists ─────────────────────────────────────────────────────────
  // All chats excluding self-only
  const chatList = useMemo(() =>
    chats.filter(c => c.type === 'group' || c.members.some(m => m.id !== meId)),
    [chats, meId]
  );

  // Search results filtered: exclude users who already have a direct chat selected
  const filteredSearch = useMemo(() =>
    searchResults.filter(u => u.id !== meId),
    [searchResults, meId]
  );

  const selectedCount = selectedTargets.size;

  // ── Render: preview step ──────────────────────────────────────────────────
  if (step === 'preview') {
    return (
      <div className="modalOverlay" onClick={onClose}>
        <div className="modalCard fwdModal" onClick={e => e.stopPropagation()}>
          <div className="modalHeader">
            <span className="modalTitle">Предпросмотр</span>
            <button className="modalClose" onClick={onClose} title="Закрыть">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="fwdPreviewList">
            {forwardMsgs.length === 0 ? (
              <div className="fwdPreviewEmpty">Нет сообщений для пересылки</div>
            ) : forwardMsgs.map(m => {
              const sender = chats.flatMap(c => c.members).find(u => u.id === m.sender_id);
              const senderName = sender?.display_name || sender?.username || 'Пользователь';
              return (
                <div key={m.id} className="fwdPreviewItem">
                  <div className="fwdPreviewItemInner">
                    <div className="fwdPreviewSender">{senderName}</div>
                    <div className="fwdPreviewText">
                      {m.text ? m.text : attachmentLabel(m)}
                    </div>
                  </div>
                  <button
                    className="fwdPreviewRemove"
                    onClick={() => removeMessage(m.id)}
                    title="Убрать это сообщение"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="fwdFooter">
            <button className="fwdBtnSecondary" onClick={onAddMore}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Добавить
            </button>
            <div className="fwdFooterRight">
              <button className="fwdBtnGhost" onClick={onClose}>Отмена</button>
              <button
                className="fwdBtnPrimary"
                onClick={() => setStep('recipients')}
                disabled={forwardMsgs.length === 0}
              >
                Сохранить
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: recipients step ───────────────────────────────────────────────
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard fwdModal" onClick={e => e.stopPropagation()}>
        <div className="modalHeader">
          <span className="modalTitle">Переслать сообщения</span>
          <button className="modalClose" onClick={onClose} title="Закрыть">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Preview button */}
        <div className="fwdPreviewTrigger">
          <button className="fwdPreviewToggleBtn" onClick={() => setStep('preview')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Предпросмотр сообщений
            <span className="fwdPreviewBadge">{forwardMsgs.length}</span>
          </button>
        </div>

        <div className="fwdBody">
          {/* My chats */}
          {chatList.length > 0 && (
            <>
              <div className="fwdSectionLabel">Мои чаты</div>
              <div className="fwdList">
                {chatList.map(chat => {
                  const selected = selectedTargets.has(chat.id);
                  const partner = chat.type === 'direct'
                    ? chat.members.find(m => m.id !== meId)
                    : null;
                  const avatarUser = chat.type === 'group'
                    ? { id: chat.id, display_name: chat.name, avatar_url: chat.avatar_url ?? null } as User
                    : partner ?? null;
                  return (
                    <button
                      key={chat.id}
                      className={`fwdItem${selected ? ' fwdItemSelected' : ''}`}
                      onClick={() => toggleTarget(chat.id)}
                    >
                      <div className="fwdItemCheck">
                        {selected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                          </svg>
                        )}
                      </div>
                      <Avatar user={avatarUser} size={36} radius={11} />
                      <div className="fwdItemInfo">
                        <div className="fwdItemName">{chatTitle(chat, meId)}</div>
                        {chat.type === 'group' && (
                          <div className="fwdItemSub">{chat.members.length} участн.</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* User search */}
          <div className="fwdSectionLabel">Поиск пользователей</div>
          <div className="fwdSearchWrap">
            <svg className="fwdSearchIcon" viewBox="0 0 20 20" fill="none">
              <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
              <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            <input
              className="fwdSearchInput"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Поиск по @username…"
            />
            {searching && <span className="fwdSearchSpin">…</span>}
          </div>

          {filteredSearch.length > 0 && (
            <div className="fwdList">
              {filteredSearch.map(u => {
                const selected = selectedTargets.has(u.id);
                return (
                  <button
                    key={u.id}
                    className={`fwdItem${selected ? ' fwdItemSelected' : ''}`}
                    onClick={() => toggleTarget(u.id)}
                  >
                    <div className="fwdItemCheck">
                      {selected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>
                      )}
                    </div>
                    <Avatar user={u} size={36} radius={11} />
                    <div className="fwdItemInfo">
                      <div className="fwdItemName">{u.display_name || u.username}</div>
                      {u.username && <div className="fwdItemSub">@{u.username}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {query.length >= 2 && !searching && filteredSearch.length === 0 && (
            <div className="fwdNoResults">Пользователи не найдены</div>
          )}
        </div>

        {error && <div className="fwdError">{error}</div>}

        <div className="fwdFooter">
          <button className="fwdBtnGhost" onClick={onClose}>Отмена</button>
          <button
            className="fwdBtnPrimary"
            onClick={handleSend}
            disabled={selectedCount === 0 || forwardMsgs.length === 0 || sending}
          >
            {sending ? 'Отправка…' : `Отправить${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
            {!sending && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
