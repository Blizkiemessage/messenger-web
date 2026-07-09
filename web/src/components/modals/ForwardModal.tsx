/**
 * ForwardModal.tsx
 * ✅ Forward-message workflow:
 *   - Search at top (fixed, above scrollable list)
 *   - Chat list sorted by last-message time (mirrors sidebar order)
 *   - Scrollable recipient list with sidebar-style scrollbar
 *   - Caption textarea at bottom for optional forwarding comment
 *   - Preview step: review/remove queued messages
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatsStore } from '../../store/useChatsStore';
import { useSearch } from '../../hooks/useSearch';
import { forwardMessages as apiForward, createDirectChat, sendChatMessage } from '../../api/chats';
import { Avatar } from '../ui/Avatar';
import { chatTitle } from '../../utils/format';
import type { Message, User } from '../../types';

interface Props {
  messages: Message[];
  meId: string;
  onClose: () => void;
  onAddMore: () => void;
}

function attachmentLabel(m: Message, t: (k: string, o?: any) => string): string {
  if (!m.attachment_type) return '';
  if (m.attachment_type === 'image') return t('forward.attachImage');
  if (m.attachment_type === 'video') return t('forward.attachVideo');
  return t('forward.attachFile', { name: m.attachment_name || t('collections.file') });
}

export function ForwardModal({ messages: initMessages, meId, onClose, onAddMore }: Props) {
  const { t } = useTranslation('modals');
  const chats = useChatsStore(s => s.chats);

  const [step, setStep]                       = useState<'recipients' | 'preview'>('recipients');
  const [forwardMsgs, setForwardMsgs]         = useState<Message[]>(initMessages);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [sending, setSending]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [caption, setCaption]                 = useState('');
  const captionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setForwardMsgs(initMessages); }, [initMessages]);

  const { query, setQuery, results: searchResults, searching } = useSearch();

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

  // Auto-grow textarea up to 3 lines
  const handleCaptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCaption(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 90)}px`;
  };

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (selectedTargets.size === 0 || forwardMsgs.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const msgIds      = forwardMsgs.map(m => m.id);
      const captionText = caption.trim();

      for (const target of selectedTargets) {
        let chatId    = target;
        const isChat  = chats.some(c => c.id === target);
        if (!isChat) {
          const chat = await createDirectChat(target);
          useChatsStore.getState().upsertChat(chat);
          chatId = chat.id;
        }
        await apiForward(chatId, msgIds);
        if (captionText) {
          await sendChatMessage(chatId, { text: captionText });
        }
      }
      onClose();
    } catch (e: any) {
      setError(e?.message || t('forward.sendError'));
    } finally {
      setSending(false);
    }
  }, [selectedTargets, forwardMsgs, caption, chats, onClose, t]);

  // ── Derived lists ─────────────────────────────────────────────────────────
  // Sorted by last message time (most recent first) — same order as sidebar
  const chatList = useMemo(() =>
    chats
      .filter(c => c.type === 'saved' || c.type === 'group' || c.members.some(m => m.id !== meId))
      .sort((a, b) => (b.last_message?.created_at ?? 0) - (a.last_message?.created_at ?? 0)),
    [chats, meId],
  );

  const filteredSearch = useMemo(() =>
    searchResults.filter(u => u.id !== meId),
    [searchResults, meId],
  );

  const isSearching    = query.length >= 2;
  const selectedCount  = selectedTargets.size;

  // ── Shared: fwdItem renderer ──────────────────────────────────────────────
  function renderCheckmark() {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    );
  }

  // ── Render: preview step ──────────────────────────────────────────────────
  if (step === 'preview') {
    return (
      <div className="modalOverlay" onClick={onClose}>
        <div className="modalCard fwdModal" onClick={e => e.stopPropagation()}>
          <div className="modalHeader">
            <span className="modalTitle">{t('forward.previewTitle')}</span>
            <button className="modalClose" onClick={onClose} title={t('common:close')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="fwdPreviewList">
            {forwardMsgs.length === 0 ? (
              <div className="fwdPreviewEmpty">{t('forward.noMessages')}</div>
            ) : forwardMsgs.map(m => {
              const sender     = chats.flatMap(c => c.members).find(u => u.id === m.sender_id);
              const senderName = sender?.display_name || sender?.username || t('forward.unknownUser');
              return (
                <div key={m.id} className="fwdPreviewItem">
                  <div className="fwdPreviewItemInner">
                    <div className="fwdPreviewSender">{senderName}</div>
                    <div className="fwdPreviewText">{m.text ? m.text : attachmentLabel(m, t)}</div>
                  </div>
                  <button
                    className="fwdPreviewRemove"
                    onClick={() => removeMessage(m.id)}
                    title={t('forward.removeMessageTitle')}
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
              {t('forward.addMore')}
            </button>
            <div className="fwdFooterRight">
              <button className="fwdBtnGhost" onClick={onClose}>{t('common:cancel')}</button>
              <button
                className="fwdBtnPrimary"
                onClick={() => setStep('recipients')}
                disabled={forwardMsgs.length === 0}
              >
                {t('common:save')}
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

        {/* Header */}
        <div className="modalHeader">
          <span className="modalTitle">{t('forward.title')}</span>
          <button className="modalClose" onClick={onClose} title={t('common:close')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Preview trigger */}
        <div className="fwdPreviewTrigger">
          <button className="fwdPreviewToggleBtn" onClick={() => setStep('preview')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            {t('forward.previewTitle')}
            <span className="fwdPreviewBadge">{forwardMsgs.length}</span>
          </button>
        </div>

        {/* Search — fixed above the scrollable list */}
        <div className="fwdSearchBar">
          <svg className="fwdSearchBarIcon" viewBox="0 0 20 20" fill="none">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          <input
            className="fwdSearchBarInput"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('forward.searchPlaceholder')}
            autoComplete="off"
          />
          {searching && <span className="fwdSearchSpin">…</span>}
          {query && !searching && (
            <button className="fwdSearchClear" onClick={() => setQuery('')} title={t('forward.clear')}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        {/* Scrollable list */}
        <div className="fwdBody">
          {!isSearching ? (
            chatList.length > 0 ? (
              <div className="fwdList">
                {chatList.map(chat => {
                  const selected    = selectedTargets.has(chat.id);
                  const isSaved     = chat.type === 'saved';
                  const partner     = chat.type === 'direct'
                    ? chat.members.find(m => m.id !== meId)
                    : null;
                  const avatarUser  = chat.type === 'group'
                    ? { id: chat.id, display_name: chat.name, avatar_url: chat.avatar_url ?? null } as User
                    : isSaved ? null
                    : partner ?? null;
                  return (
                    <button
                      key={chat.id}
                      className={`fwdItem${selected ? ' fwdItemSelected' : ''}`}
                      onClick={() => toggleTarget(chat.id)}
                    >
                      <div className="fwdItemCheck">{selected && renderCheckmark()}</div>
                      {isSaved ? (
                        <div className="fwdItemAvatarSaved">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                          </svg>
                        </div>
                      ) : (
                        <Avatar user={avatarUser} size={36} radius={11} />
                      )}
                      <div className="fwdItemInfo">
                        <div className="fwdItemName">{chatTitle(chat, meId)}</div>
                        {chat.type === 'group' && (
                          <div className="fwdItemSub">{t('forward.membersAbbrev', { count: chat.members.length })}</div>
                        )}
                        {isSaved && <div className="fwdItemSub">{t('common:yourNotes')}</div>}
                        {chat.type === 'direct' && partner?.username && (
                          <div className="fwdItemSub">@{partner.username}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="fwdNoResults">{t('forward.noChatsAvailable')}</div>
            )
          ) : (
            /* Search results */
            filteredSearch.length > 0 ? (
              <div className="fwdList">
                {filteredSearch.map(u => {
                  const selected = selectedTargets.has(u.id);
                  return (
                    <button
                      key={u.id}
                      className={`fwdItem${selected ? ' fwdItemSelected' : ''}`}
                      onClick={() => toggleTarget(u.id)}
                    >
                      <div className="fwdItemCheck">{selected && renderCheckmark()}</div>
                      <Avatar user={u} size={36} radius={11} />
                      <div className="fwdItemInfo">
                        <div className="fwdItemName">{u.display_name || u.username}</div>
                        {u.username && <div className="fwdItemSub">@{u.username}</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : !searching ? (
              <div className="fwdNoResults">{t('addGroupMembers.noUsersFound')}</div>
            ) : null
          )}
        </div>

        {/* Caption field */}
        <div className="fwdCaptionWrap">
          <svg className="fwdCaptionIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <textarea
            ref={captionRef}
            className="fwdCaptionInput"
            value={caption}
            onChange={handleCaptionChange}
            placeholder={t('forward.captionPlaceholder')}
            rows={1}
          />
        </div>

        {error && <div className="fwdError">{error}</div>}

        <div className="fwdFooter">
          <button className="fwdBtnGhost" onClick={onClose}>{t('common:cancel')}</button>
          <button
            className="fwdBtnPrimary"
            onClick={handleSend}
            disabled={selectedCount === 0 || forwardMsgs.length === 0 || sending}
          >
            {sending ? t('forward.sending') : (selectedCount > 0 ? t('forward.sendWithCount', { count: selectedCount }) : t('common:send'))}
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
